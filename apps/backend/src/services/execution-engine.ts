import { blockExecutor } from './block-executor';
import { traceService } from './trace-service';
import { wsService } from './websocket-service';
import { broadcastNodePortUpdated } from './ws-flow-events-service';
import { deleteObject, getPublicUrl, publicUrlFromS3Uri, putObject } from '../adapters/aws/s3';
import { env } from '../config/env';
import { assetRepo } from '../repositories/asset-repository';
import { runRepo } from '../repositories/run-repository';
import { generateNumericId } from '../utils/id-generator';

import type { BlockExecutorResult } from '../modules/blocks/types';
import type { Asset } from '@flows/contracts';

/**
 * Execution engine — handles async run/node execution.
 * Replaces fake-executor with proper idempotency + cancel propagation.
 *
 * Called by the queue adapter (local: inline; prod: Lambda/SQS worker).
 */

const NODE_CANCEL_POLL_MS = 1000;

type PersistedNodeAsset = {
    assetId: string;
    assetType: string;
    publicUrl: string;
    s3Key?: string;
};

const getAssetS3Key = (asset: NonNullable<BlockExecutorResult['assets']>[number]): string | undefined =>
    typeof asset.metadata?.['s3Key'] === 'string' ? asset.metadata['s3Key'] : undefined;

function createExecutionCancelledError(message = 'Run cancelled during node execution'): Error {
    const error = new Error(message);
    error.name = 'ExecutionCancelledError';
    return error;
}

function isExecutionCancelledError(err: unknown): boolean {
    return err instanceof Error && (err.name === 'ExecutionCancelledError' || /cancelled/i.test(err.message));
}

function createExecutionTimeoutError(blockType: string, timeoutMs: number): Error {
    const error = new Error(`${blockType} execution timed out after ${Math.round(timeoutMs / 1000)} seconds`);
    error.name = 'ExecutionTimeoutError';
    return error;
}

function isExecutionTimeoutError(err: unknown): boolean {
    return err instanceof Error && err.name === 'ExecutionTimeoutError';
}

function isStepReviewStopNode(blockType: string): boolean {
    return (
        blockType === 'content' ||
        blockType === 'longform-review' ||
        blockType === 'countryball-angle-lab' ||
        blockType === 'blog-outline'
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isApprovedLongformReviewOutput(value: unknown): boolean {
    if (!isRecord(value)) return false;
    const approvedArtifactId = value['approvedArtifactId'];
    return (
        value['mediaExecutionAllowed'] === true ||
        value['gateBApproved'] === true ||
        value['reviewStatus'] === 'approved' ||
        (typeof approvedArtifactId === 'string' && approvedArtifactId.trim().length > 0)
    );
}

function isSelectedCountryballAngleOutput(value: unknown): boolean {
    if (!isRecord(value)) return false;
    const selectedAngleId = value['selectedAngleId'];
    return (
        value['angleSelectionStatus'] === 'selected' ||
        (typeof selectedAngleId === 'string' && selectedAngleId.trim().length > 0) ||
        isRecord(value['selectedAngle'])
    );
}

function isSelectedBlogOutlineOutput(value: unknown): boolean {
    if (!isRecord(value)) return false;
    return value['outlineSelectionStatus'] === 'selected';
}

function shouldStopAtStepReviewNode(node: { blockType: string; status: string; outputPayload?: unknown }): boolean {
    if (node.status !== 'COMPLETED' || !isStepReviewStopNode(node.blockType)) return false;
    if (node.blockType === 'longform-review') {
        return !isApprovedLongformReviewOutput(node.outputPayload);
    }
    if (node.blockType === 'countryball-angle-lab') {
        return !isSelectedCountryballAngleOutput(node.outputPayload);
    }
    if (node.blockType === 'blog-outline') {
        return !isSelectedBlogOutlineOutput(node.outputPayload);
    }
    return true;
}

function createTimeoutWatchdog(
    blockType: string,
    timeoutMs: number,
    onTimeout: (error: Error) => void | Promise<void>
): { promise: Promise<never>; cancel: () => void } {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const promise = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
            if (cancelled) return;
            const error = createExecutionTimeoutError(blockType, timeoutMs);
            void onTimeout(error);
            reject(error);
        }, timeoutMs);
    });
    void promise.catch(() => {
        /* consumed by the node execution race */
    });

    return {
        promise,
        cancel: () => {
            cancelled = true;
            if (timeout) clearTimeout(timeout);
        },
    };
}

function resolveNodeExecutionTimeoutMs(
    blockType: string,
    resolvedInput: Record<string, unknown> | null,
    config?: Record<string, unknown> | null
): number {
    if (blockType === 'media-image' || blockType === 'countryball-image') {
        const sceneCount =
            arrayLength(resolvedInput?.['normalizedScenes']) ??
            arrayLength(resolvedInput?.['scenes']) ??
            positiveNumber(config?.['count']) ??
            1;
        const waveCount = Math.ceil(sceneCount / Math.max(1, env.openaiImageSceneConcurrency));
        return Math.max(
            env.nodeExecutionTimeoutMs,
            waveCount * env.openaiImageSceneTimeoutMs * env.openaiImageSceneMaxAttempts +
                env.openaiImageBatchTimeoutBufferMs +
                30000
        );
    }

    if (blockType === 'media-tts' || blockType === 'longform-tts' || blockType === 'countryball-tts') {
        return Math.max(env.nodeExecutionTimeoutMs, env.elevenLabsTtsTimeoutMs + 30000);
    }

    if (blockType === 'media-video' || blockType === 'longform-render' || blockType === 'countryball-video') {
        return Math.max(env.nodeExecutionTimeoutMs, 900000);
    }

    return env.nodeExecutionTimeoutMs;
}

function arrayLength(value: unknown): number | undefined {
    return Array.isArray(value) && value.length > 0 ? value.length : undefined;
}

function positiveNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

async function skipPendingNodes(runId: string): Promise<void> {
    const remainingNodes = await runRepo.listRunNodes(runId);
    for (const node of remainingNodes) {
        if (node.status === 'PENDING') {
            await runRepo.putRunNode({
                ...node,
                status: 'SKIPPED',
                updatedAt: new Date().toISOString(),
            });
        }
    }
}

// ============================================================================
// Topological sort (Kahn's algorithm) — waves of parallel-executable nodes
// ============================================================================

export function computeWaves(nodes: { nodeId: string; parentNodeIds: string[] }[]): string[][] {
    const inDegree = new Map<string, number>();
    const children = new Map<string, string[]>();
    const nodeIds = new Set(nodes.map(n => n.nodeId));

    for (const node of nodes) {
        if (!inDegree.has(node.nodeId)) inDegree.set(node.nodeId, 0);
        if (!children.has(node.nodeId)) children.set(node.nodeId, []);

        for (const parentId of node.parentNodeIds) {
            if (!nodeIds.has(parentId)) continue; // ignore missing parents
            inDegree.set(node.nodeId, (inDegree.get(node.nodeId) ?? 0) + 1);
            if (!children.has(parentId)) children.set(parentId, []);
            const parentChildren = children.get(parentId);
            if (parentChildren) parentChildren.push(node.nodeId);
        }
    }

    const waves: string[][] = [];
    let queue = [...inDegree.entries()].filter(([, deg]) => deg === 0).map(([id]) => id);

    while (queue.length > 0) {
        waves.push(queue);
        const nextQueue: string[] = [];
        for (const id of queue) {
            for (const childId of children.get(id) ?? []) {
                const newDeg = (inDegree.get(childId) ?? 0) - 1;
                inDegree.set(childId, newDeg);
                if (newDeg === 0) nextQueue.push(childId);
            }
        }
        queue = nextQueue;
    }

    return waves;
}

async function resolveAssetPublicUrl(
    asset: NonNullable<BlockExecutorResult['assets']>[number],
    runId: string,
    nodeId: string
): Promise<string> {
    if (typeof asset.data === 'string') {
        if (asset.data.startsWith('s3://')) return publicUrlFromS3Uri(asset.data);
        return asset.data;
    }

    const existingKey = typeof asset.metadata?.['s3Key'] === 'string' ? asset.metadata['s3Key'] : undefined;
    if (existingKey) return getPublicUrl(existingKey);

    const key = `runs/${runId}/${nodeId}/${generateNumericId()}-${asset.assetType.toLowerCase()}`;
    await putObject(key, asset.data, asset.mimeType);
    if (asset.metadata) asset.metadata['s3Key'] = key;
    return getPublicUrl(key);
}

async function resolveNodeInput(
    runId: string,
    node: { inputPayload?: Record<string, unknown> | null; parentNodeIds: string[] }
): Promise<Record<string, unknown> | null> {
    const merged: Record<string, unknown> = {};

    for (const parentId of node.parentNodeIds) {
        const parent = await runRepo.getRunNode(runId, parentId);
        if (parent?.outputPayload && typeof parent.outputPayload === 'object') {
            Object.assign(merged, parent.outputPayload);
        }
    }

    if (node.inputPayload && typeof node.inputPayload === 'object') {
        for (const [key, value] of Object.entries(node.inputPayload)) {
            const current = merged[key];
            const currentIsStructured = Array.isArray(current) || (current != null && typeof current === 'object');
            const nextIsScalar = value == null || typeof value !== 'object';

            if (key in merged && currentIsStructured && nextIsScalar) {
                continue;
            }

            merged[key] = value;
        }
    }

    return Object.keys(merged).length > 0 ? merged : null;
}

// ============================================================================
// Execution engine
// ============================================================================

export const executionEngine = {
    /**
     * Handle EXECUTE_RUN queue message.
     *
     * Idempotency: if run is already COMPLETED/FAILED/CANCELLED, skip.
     * Flow:
     *   1. QUEUED → RUNNING, or continue a retry that is already RUNNING
     *   2. Compute waves from topological sort
     *   3. Execute wave by wave — check cancel between each wave
     *   4. If any node FAILED: mark remaining PENDING as SKIPPED, run → FAILED
     *   5. After all waves pass: run → COMPLETED
     */
    async handleRunExecution(runId: string, _executionId: string): Promise<void> {
        const run = await runRepo.getRun(runId);
        if (!run) {
            console.warn(`[execution-engine] handleRunExecution: run ${runId} not found — skipping`);
            return;
        }

        // Idempotency: only start from QUEUED or continue an explicit retry from RUNNING.
        if (run.status !== 'QUEUED' && run.status !== 'RUNNING') {
            console.info(
                `[execution-engine] handleRunExecution: run ${runId} already ${run.status} — skipping (idempotent)`
            );
            return;
        }

        if (run.status === 'QUEUED') {
            const startResult = await runRepo.updateRunStatus(runId, 'RUNNING', {
                startedAt: new Date().toISOString(),
            });
            if (!startResult.ok) {
                console.warn(`[execution-engine] handleRunExecution: transition failed — ${startResult.error}`);
                return;
            }
        }

        // Broadcast run.started + record trace
        try {
            await wsService.broadcastToFlow(run.flowId, {
                type: 'run.started',
                id: runId,
                runId,
                flowId: run.flowId,
                status: 'RUNNING',
                timestamp: Date.now(),
            });
        } catch {
            /* non-fatal */
        }
        try {
            await traceService.record(runId, null, 'STATUS', 'Run started');
        } catch {
            /* non-fatal */
        }

        const allNodes = await runRepo.listRunNodes(runId);
        const waves = computeWaves(allNodes.map(n => ({ nodeId: n.nodeId, parentNodeIds: n.parentNodeIds })));

        let hasFailed = false;

        for (const wave of waves) {
            // Check cancellation before each wave
            const currentRun = await runRepo.getRun(runId);
            if (currentRun?.status === 'CANCELLED') {
                console.info(`[execution-engine] run ${runId} cancelled — stopping before wave`);
                return;
            }

            // Execute all nodes in this wave concurrently. Nodes in the same
            // wave have no dependencies on each other, so image/TTS branches
            // should run at the same time after analysis completes.
            const waveResults = await Promise.all(
                wave.map(async nodeId => {
                    const nodeCheck = await runRepo.getRunNode(runId, nodeId);
                    if (!nodeCheck || nodeCheck.status === 'CANCELLED') return null;

                    await this.handleNodeExecution(runId, nodeId, _executionId);

                    return runRepo.getRunNode(runId, nodeId);
                })
            );

            if (waveResults.some(nodeAfter => nodeAfter?.status === 'FAILED')) {
                hasFailed = true;
            }

            const reviewNode = waveResults.find(
                nodeAfter => run.executionMode === 'step' && nodeAfter !== null && shouldStopAtStepReviewNode(nodeAfter)
            );
            if (reviewNode) {
                const reviewMessage =
                    reviewNode.blockType === 'countryball-angle-lab'
                        ? 'Countryball angle selection step completed'
                        : reviewNode.blockType === 'blog-outline'
                          ? 'Blog outline selection step completed'
                          : 'Script review step completed';
                await skipPendingNodes(runId);
                await runRepo.updateRunStatus(runId, 'COMPLETED', {
                    completedAt: new Date().toISOString(),
                    finalOutputSummary: {
                        stoppedForReview: true,
                        reviewNodeId: reviewNode.nodeId,
                        message: reviewMessage,
                    },
                });

                try {
                    await wsService.broadcastToFlow(run.flowId, {
                        type: 'run.completed',
                        id: runId,
                        runId,
                        flowId: run.flowId,
                        status: 'COMPLETED',
                        reviewNodeId: reviewNode.nodeId,
                        message:
                            reviewNode.blockType === 'countryball-angle-lab'
                                ? '컨트리볼 앵글 선택 단계가 완료되었습니다.'
                                : reviewNode.blockType === 'blog-outline'
                                  ? '블로그 목차 설계 단계가 완료되었습니다.'
                                  : '대본 검수 단계가 완료되었습니다.',
                        timestamp: Date.now(),
                    });
                } catch {
                    /* non-fatal */
                }
                try {
                    await traceService.record(runId, reviewNode.nodeId, 'STATUS', reviewMessage);
                } catch {
                    /* non-fatal */
                }
                return;
            }

            if (hasFailed) break;
        }

        // Re-check cancellation
        const finalRun = await runRepo.getRun(runId);
        if (finalRun?.status === 'CANCELLED') return;

        if (hasFailed) {
            // Mark all remaining PENDING nodes as SKIPPED
            await skipPendingNodes(runId);

            const failedNode = (await runRepo.listRunNodes(runId)).find(n => n.status === 'FAILED');
            const failedNodeId = failedNode?.nodeId ?? 'unknown';
            const failedErrorCode = failedNode?.errorCode ?? null;
            const failedErrorMessage = failedNode?.errorMessage ?? `Run failed at node ${failedNodeId}`;
            await runRepo.updateRunStatus(runId, 'FAILED', {
                finalOutputSummary: {
                    failedNodeId,
                    errorCode: failedErrorCode,
                    errorMessage: failedErrorMessage,
                    failedAt: new Date().toISOString(),
                },
            });

            // Broadcast run.failed + record trace
            try {
                await wsService.broadcastToFlow(run.flowId, {
                    type: 'run.failed',
                    id: runId,
                    runId,
                    flowId: run.flowId,
                    status: 'FAILED',
                    failedNodeId,
                    errorCode: failedErrorCode,
                    errorMessage: failedErrorMessage,
                    error: failedErrorMessage,
                    timestamp: Date.now(),
                });
            } catch {
                /* non-fatal */
            }
            try {
                await traceService.record(runId, null, 'STATUS', `Run failed at node ${failedNodeId}`);
            } catch {
                /* non-fatal */
            }
            return;
        }

        await runRepo.updateRunStatus(runId, 'COMPLETED', {
            completedAt: new Date().toISOString(),
        });

        // Broadcast run.completed + record trace
        try {
            await wsService.broadcastToFlow(run.flowId, {
                type: 'run.completed',
                id: runId,
                runId,
                flowId: run.flowId,
                status: 'COMPLETED',
                timestamp: Date.now(),
            });
        } catch {
            /* non-fatal */
        }
        try {
            await traceService.record(runId, null, 'STATUS', 'Run completed');
        } catch {
            /* non-fatal */
        }

        // Notify webhook if configured
        if (run.notifyWebhook) {
            try {
                const signal = AbortSignal.timeout(5000);
                await fetch(run.notifyWebhook, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        event: 'run.completed',
                        runId,
                        flowId: run.flowId,
                        status: 'COMPLETED',
                        completedAt: new Date().toISOString(),
                    }),
                    signal,
                });
            } catch {
                console.warn(`[execution-engine] webhook notify failed for run ${runId} (non-fatal)`);
            }
        }
    },

    /**
     * Handle EXECUTE_NODE queue message.
     *
     * Idempotency: if node is already RUNNING/COMPLETED/FAILED/CANCELLED/SKIPPED, skip.
     * Flow:
     *   1. PENDING → RUNNING (conditional; bail if fails)
     *   2. Execute block logic (fake for now)
     *   3. RUNNING → COMPLETED with outputPayload
     *   4. On error: RUNNING → FAILED with errorCode/errorMessage
     */
    async handleNodeExecution(runId: string, nodeId: string, _executionId: string): Promise<void> {
        const node = await runRepo.getRunNode(runId, nodeId);
        if (!node) {
            console.warn(`[execution-engine] handleNodeExecution: node ${runId}#${nodeId} not found — skipping`);
            return;
        }

        // Idempotency: only execute PENDING nodes
        if (node.status !== 'PENDING') {
            console.info(
                `[execution-engine] handleNodeExecution: node ${nodeId} already ${node.status} — skipping (idempotent)`
            );
            return;
        }

        // PENDING → RUNNING
        const startResult = await runRepo.updateRunNodeStatus(runId, nodeId, 'RUNNING', {
            startedAt: new Date().toISOString(),
            progress: 0,
        });
        if (!startResult.ok) {
            console.warn(`[execution-engine] handleNodeExecution: transition failed — ${startResult.error}`);
            return;
        }

        // Broadcast node.started + record trace
        const runForNode = await runRepo.getRun(runId);
        if (runForNode) {
            try {
                await wsService.broadcastToFlow(runForNode.flowId, {
                    type: 'node.started',
                    id: nodeId,
                    runId,
                    flowId: runForNode.flowId,
                    nodeId,
                    status: 'RUNNING',
                    timestamp: Date.now(),
                });
            } catch {
                /* non-fatal */
            }
        }
        try {
            await traceService.record(runId, nodeId, 'STATUS', `Node ${nodeId} started`);
        } catch {
            /* non-fatal */
        }

        const persistedAssetKeys = new Set<string>();
        const persistedAssets: PersistedNodeAsset[] = [];
        const pendingReportedAssets: NonNullable<BlockExecutorResult['assets']> = [];
        let assetsToPublish: NonNullable<BlockExecutorResult['assets']> = [];
        let lastProgress = 0;
        const abortController = new AbortController();
        let cancelPoller: ReturnType<typeof setInterval> | undefined;
        let cancelPromiseReject: ((error: Error) => void) | undefined;

        const isCancelled = async (): Promise<boolean> => {
            const [currentRun, currentNode] = await Promise.all([
                runRepo.getRun(runId),
                runRepo.getRunNode(runId, nodeId),
            ]);
            return currentRun?.status === 'CANCELLED' || currentNode?.status === 'CANCELLED';
        };

        const abortAsCancelled = (): void => {
            if (!abortController.signal.aborted) {
                abortController.abort(createExecutionCancelledError());
            }
            cancelPromiseReject?.(createExecutionCancelledError());
        };

        const ensureNodeActive = async (): Promise<void> => {
            if (abortController.signal.aborted) {
                const reason = abortController.signal.reason;
                if (isExecutionTimeoutError(reason)) throw reason;
                abortAsCancelled();
                throw createExecutionCancelledError();
            }
            if (await isCancelled()) {
                abortAsCancelled();
                throw createExecutionCancelledError();
            }
        };

        const markNodeCancelled = async (): Promise<void> => {
            abortAsCancelled();
            const currentNode = await runRepo.getRunNode(runId, nodeId);
            if (!currentNode || currentNode.status === 'CANCELLED') return;
            if (currentNode.status === 'PENDING' || currentNode.status === 'RUNNING') {
                await runRepo.updateRunNodeStatus(runId, nodeId, 'CANCELLED', {
                    errorCode: 'RUN_CANCELLED',
                    errorMessage: 'Run was cancelled by user',
                });
            }
        };

        const cancelPromise = new Promise<never>((_, reject) => {
            cancelPromiseReject = reject;
            cancelPoller = setInterval(() => {
                void isCancelled()
                    .then(cancelled => {
                        if (cancelled) abortAsCancelled();
                    })
                    .catch(() => {
                        /* cancellation polling is best-effort */
                    });
            }, NODE_CANCEL_POLL_MS);
        });
        void cancelPromise.catch(() => {
            /* cancellation is consumed by the active node execution race */
        });

        const broadcastProgress = async (progress: number, message?: string): Promise<void> => {
            if (!runForNode) return;
            await ensureNodeActive();
            const boundedProgress = Math.max(lastProgress, Math.max(0, Math.min(99, Math.round(progress))));
            const progressResult = await runRepo.updateRunNodeStatus(runId, nodeId, 'RUNNING', {
                progress: boundedProgress,
            });
            if (!progressResult.ok) {
                if (await isCancelled()) throw createExecutionCancelledError();
                throw new Error(progressResult.error);
            }
            lastProgress = boundedProgress;

            try {
                await wsService.broadcastToFlow(runForNode.flowId, {
                    type: 'node.progress',
                    id: nodeId,
                    runId,
                    flowId: runForNode.flowId,
                    nodeId,
                    progress: boundedProgress,
                    message: message ?? `${node.blockType} 실행 중...`,
                    timestamp: Date.now(),
                });
            } catch {
                /* non-fatal */
            }
        };

        const persistAsset = async (
            asset: NonNullable<BlockExecutorResult['assets']>[number]
        ): Promise<PersistedNodeAsset | null> => {
            if (!runForNode) return null;
            await ensureNodeActive();

            const metadataKey = typeof asset.metadata?.['s3Key'] === 'string' ? asset.metadata['s3Key'] : undefined;
            const dataKey = typeof asset.data === 'string' ? asset.data : undefined;
            const dedupeKey = metadataKey ?? dataKey;
            if (dedupeKey && persistedAssetKeys.has(dedupeKey)) return null;

            const assetId = generateNumericId();
            const publicUrl = await resolveAssetPublicUrl(asset, runId, nodeId);
            await ensureNodeActive();

            const assetRecord: Asset = {
                assetId,
                runId,
                runNodeId: nodeId,
                flowId: runForNode.flowId,
                assetType: asset.assetType,
                mimeType: asset.mimeType,
                publicUrl,
                metadata: asset.metadata ?? {},
                status: 'PENDING',
                createdAt: new Date().toISOString(),
            };
            await assetRepo.put(assetRecord);

            const persisted: PersistedNodeAsset = {
                assetId,
                assetType: asset.assetType.toLowerCase(),
                publicUrl,
                ...(typeof assetRecord.metadata?.['s3Key'] === 'string'
                    ? { s3Key: assetRecord.metadata['s3Key'] }
                    : {}),
            };
            persistedAssets.push(persisted);

            if (dedupeKey) persistedAssetKeys.add(dedupeKey);
            await ensureNodeActive();

            return persisted;
        };

        const rollbackAssets = async (assets: PersistedNodeAsset[]): Promise<void> => {
            for (const asset of [...assets].reverse()) {
                try {
                    await assetRepo.delete(asset.assetId);
                    if (asset.s3Key) await deleteObject(asset.s3Key);
                } catch (err) {
                    try {
                        await traceService.record(
                            runId,
                            nodeId,
                            'ERROR',
                            `Asset rollback failed for ${asset.assetId}: ${err instanceof Error ? err.message : String(err)}`
                        );
                    } catch {
                        /* non-fatal */
                    }
                }
            }
        };

        const cleanupUnpublishedAssetStorage = async (
            assets: NonNullable<BlockExecutorResult['assets']>,
            persisted: PersistedNodeAsset[]
        ): Promise<void> => {
            const persistedKeys = new Set(persisted.map(asset => asset.s3Key).filter(Boolean));
            const cleanedKeys = new Set<string>();

            for (const asset of [...assets].reverse()) {
                const s3Key = getAssetS3Key(asset);
                if (!s3Key || persistedKeys.has(s3Key) || cleanedKeys.has(s3Key)) continue;

                try {
                    await deleteObject(s3Key);
                    cleanedKeys.add(s3Key);
                } catch (err) {
                    try {
                        await traceService.record(
                            runId,
                            nodeId,
                            'ERROR',
                            `Unpublished asset cleanup failed for ${s3Key}: ${
                                err instanceof Error ? err.message : String(err)
                            }`
                        );
                    } catch {
                        /* non-fatal */
                    }
                }
            }
        };

        const broadcastAssetCreated = async (asset: PersistedNodeAsset): Promise<void> => {
            if (!runForNode) return;
            try {
                await wsService.broadcastToFlow(runForNode.flowId, {
                    type: 'asset.created',
                    id: asset.assetId,
                    runId,
                    flowId: runForNode.flowId,
                    nodeId,
                    assetId: asset.assetId,
                    assetType: asset.assetType,
                    url: asset.publicUrl,
                    publicUrl: asset.publicUrl,
                    timestamp: Date.now(),
                });
            } catch {
                /* non-fatal — websocket delivery is best-effort */
            }
        };

        try {
            // Broadcast node.progress at 25% before execution
            await broadcastProgress(25, `${node.blockType} 실행 준비 중...`);

            const resolvedInput = await resolveNodeInput(runId, node);
            await ensureNodeActive();
            const nodeTimeoutMs = resolveNodeExecutionTimeoutMs(node.blockType, resolvedInput, node.inputPayload);
            const nodeTimeout = createTimeoutWatchdog(node.blockType, nodeTimeoutMs, async error => {
                if (!abortController.signal.aborted) abortController.abort(error);
                try {
                    await traceService.record(runId, nodeId, 'ERROR', `Node ${nodeId} timed out`, {
                        event: 'node.timeout',
                        blockType: node.blockType,
                        timeoutMs: nodeTimeoutMs,
                    });
                } catch {
                    /* non-fatal */
                }
            });
            try {
                await traceService.record(runId, nodeId, 'STATUS', `Node ${nodeId} executing`, {
                    event: 'node.execution.started',
                    blockType: node.blockType,
                    timeoutMs: nodeTimeoutMs,
                });
            } catch {
                /* non-fatal */
            }
            const executionPromise = blockExecutor.execute(
                node.blockType,
                resolvedInput,
                node.inputPayload ?? undefined,
                {
                    runId,
                    nodeId,
                    flowId: runForNode?.flowId,
                    abortSignal: abortController.signal,
                    isCancelled,
                    onProgress: broadcastProgress,
                    onAsset: async asset => {
                        pendingReportedAssets.push(asset);
                    },
                }
            );
            void executionPromise.catch(() => {
                /* handled by Promise.race below */
            });
            let result: BlockExecutorResult;
            try {
                result = await Promise.race([executionPromise, cancelPromise, nodeTimeout.promise]);
            } finally {
                nodeTimeout.cancel();
            }
            const { output, durationMs, assets } = result;
            assetsToPublish = [...pendingReportedAssets, ...(assets ?? [])];

            await ensureNodeActive();
            // Broadcast node.progress at 75% after execution, before save
            await broadcastProgress(75, `${node.blockType} 결과 저장 중...`);

            if (node.blockType === 'analysis' && output['approved'] === false) {
                const issueSummary = Array.isArray(output['issues'])
                    ? output['issues']
                          .slice(0, 3)
                          .map(issue => {
                              if (!issue || typeof issue !== 'object') return String(issue);
                              const issueObj = issue as Record<string, unknown>;
                              return String(issueObj['message'] ?? JSON.stringify(issueObj));
                          })
                          .join(' / ')
                    : 'analysis rejected the content';
                const errorMessage = `Analysis rejected content: ${issueSummary}`;

                await ensureNodeActive();
                const analysisFailedResult = await runRepo.updateRunNodeStatus(runId, nodeId, 'FAILED', {
                    errorCode: 'ANALYSIS_REJECTED',
                    errorMessage,
                    outputPayload: { ...output, durationMs },
                });
                if (!analysisFailedResult.ok) {
                    if (await isCancelled()) throw createExecutionCancelledError();
                    throw new Error(analysisFailedResult.error);
                }
                await ensureNodeActive();

                if (runForNode) {
                    try {
                        await wsService.broadcastToFlow(runForNode.flowId, {
                            type: 'node.failed',
                            id: nodeId,
                            runId,
                            flowId: runForNode.flowId,
                            nodeId,
                            status: 'FAILED',
                            errorCode: 'ANALYSIS_REJECTED',
                            errorMessage,
                            timestamp: Date.now(),
                        });
                    } catch {
                        /* non-fatal */
                    }
                }
                try {
                    await traceService.record(runId, nodeId, 'ERROR', `Node ${nodeId} failed: ${errorMessage}`);
                } catch {
                    /* non-fatal */
                }
                return;
            }

            // Save assets produced by this node before reporting completion.
            // If persistence fails, the node must fail instead of emitting a
            // completed event with missing downloadable outputs.
            if (assetsToPublish.length > 0 && runForNode) {
                try {
                    for (const asset of assetsToPublish) {
                        await ensureNodeActive();
                        await persistAsset(asset);
                    }
                    for (const asset of persistedAssets) {
                        await ensureNodeActive();
                        await assetRepo.updateStatus(asset.assetId, 'PUBLISHED');
                    }
                } catch (err) {
                    await rollbackAssets(persistedAssets);
                    await cleanupUnpublishedAssetStorage(assetsToPublish, persistedAssets);
                    throw err;
                }
            }

            await ensureNodeActive();
            try {
                const completedResult = await runRepo.updateRunNodeStatus(runId, nodeId, 'COMPLETED', {
                    completedAt: new Date().toISOString(),
                    progress: 100,
                    outputPayload: { ...output, durationMs },
                });
                if (!completedResult.ok) {
                    if (await isCancelled()) throw createExecutionCancelledError();
                    throw new Error(completedResult.error);
                }
            } catch (err) {
                await rollbackAssets(persistedAssets);
                await cleanupUnpublishedAssetStorage(assetsToPublish, persistedAssets);
                throw err;
            }

            // Broadcast node.completed + record trace
            if (runForNode) {
                try {
                    await wsService.broadcastToFlow(runForNode.flowId, {
                        type: 'node.completed',
                        id: nodeId,
                        runId,
                        flowId: runForNode.flowId,
                        nodeId,
                        status: 'COMPLETED',
                        timestamp: Date.now(),
                    });
                } catch {
                    /* non-fatal */
                }
            }
            for (const asset of persistedAssets) {
                await broadcastAssetCreated(asset);
            }
            try {
                await traceService.record(runId, nodeId, 'STATUS', `Node ${nodeId} completed`);
            } catch {
                /* non-fatal */
            }
            if (runForNode) {
                await broadcastNodePortUpdated(runForNode.flowId, nodeId, output);
            }
        } catch (err: unknown) {
            if (
                isExecutionCancelledError(err) ||
                isExecutionCancelledError(abortController.signal.reason) ||
                (await isCancelled())
            ) {
                await rollbackAssets(persistedAssets);
                await cleanupUnpublishedAssetStorage([...pendingReportedAssets, ...assetsToPublish], persistedAssets);
                await markNodeCancelled();
                try {
                    await traceService.record(runId, nodeId, 'STATUS', `Node ${nodeId} cancelled`);
                } catch {
                    /* non-fatal */
                }
                return;
            }

            const errorMessage = err instanceof Error ? err.message : String(err);
            console.error(`[execution-engine] node ${nodeId} failed:`, errorMessage);
            await rollbackAssets(persistedAssets);
            await cleanupUnpublishedAssetStorage([...pendingReportedAssets, ...assetsToPublish], persistedAssets);

            const errorCode = isExecutionTimeoutError(err) ? 'NODE_TIMEOUT' : 'EXECUTION_ERROR';
            const failedResult = await runRepo.updateRunNodeStatus(runId, nodeId, 'FAILED', {
                errorCode,
                errorMessage,
            });
            if (!failedResult.ok) {
                if (await isCancelled()) {
                    await markNodeCancelled();
                    return;
                }
                throw new Error(failedResult.error);
            }

            // Broadcast node.failed + record trace
            if (runForNode) {
                try {
                    await wsService.broadcastToFlow(runForNode.flowId, {
                        type: 'node.failed',
                        id: nodeId,
                        runId,
                        flowId: runForNode.flowId,
                        nodeId,
                        status: 'FAILED',
                        errorCode,
                        errorMessage,
                        timestamp: Date.now(),
                    });
                } catch {
                    /* non-fatal */
                }
            }
            try {
                await traceService.record(runId, nodeId, 'ERROR', `Node ${nodeId} failed: ${errorMessage}`);
            } catch {
                /* non-fatal */
            }
        } finally {
            if (cancelPoller) clearInterval(cancelPoller);
        }
    },
};
