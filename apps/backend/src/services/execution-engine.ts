import { blockExecutor } from './block-executor';
import { traceService } from './trace-service';
import { wsService } from './websocket-service';
import { getPublicUrl, publicUrlFromS3Uri, putObject } from '../adapters/aws/s3';
import { assetRepo } from '../repositories/asset-repository';
import { flowRepo } from '../repositories/flow-repository';
import { runRepo } from '../repositories/run-repository';
import { generateNumericId } from '../utils/id-generator';

import type { BlockExecutorResult } from '../modules/blocks/types';

/**
 * Execution engine — handles async run/node execution.
 * Replaces fake-executor with proper idempotency + cancel propagation.
 *
 * Called by the queue adapter (local: inline; prod: Lambda/SQS worker).
 */

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

    if (node.inputPayload && typeof node.inputPayload === 'object') {
        Object.assign(merged, node.inputPayload);
    }

    for (const parentId of node.parentNodeIds) {
        const parent = await runRepo.getRunNode(runId, parentId);
        if (parent?.outputPayload && typeof parent.outputPayload === 'object') {
            Object.assign(merged, parent.outputPayload);
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

            if (hasFailed) break;
        }

        // Re-check cancellation
        const finalRun = await runRepo.getRun(runId);
        if (finalRun?.status === 'CANCELLED') return;

        if (hasFailed) {
            // Mark all remaining PENDING nodes as SKIPPED
            const remainingNodes = await runRepo.listRunNodes(runId);
            for (const node of remainingNodes) {
                if (node.status === 'PENDING') {
                    // PENDING → SKIPPED: not a defined transition, so we do a direct put
                    await runRepo.putRunNode({
                        ...node,
                        status: 'SKIPPED',
                        updatedAt: new Date().toISOString(),
                    });
                }
            }

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
        let lastProgress = 0;

        const broadcastProgress = async (progress: number, message?: string): Promise<void> => {
            if (!runForNode) return;
            const boundedProgress = Math.max(lastProgress, Math.max(0, Math.min(99, Math.round(progress))));
            const progressResult = await runRepo.updateRunNodeStatus(runId, nodeId, 'RUNNING', {
                progress: boundedProgress,
            });
            if (!progressResult.ok) {
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

        const persistAsset = async (asset: NonNullable<BlockExecutorResult['assets']>[number]): Promise<void> => {
            if (!runForNode) return;

            const metadataKey = typeof asset.metadata?.['s3Key'] === 'string' ? asset.metadata['s3Key'] : undefined;
            const dataKey = typeof asset.data === 'string' ? asset.data : undefined;
            const dedupeKey = metadataKey ?? dataKey;
            if (dedupeKey && persistedAssetKeys.has(dedupeKey)) return;

            const assetId = generateNumericId();
            const publicUrl = await resolveAssetPublicUrl(asset, runId, nodeId);

            await assetRepo.put({
                assetId,
                runId,
                runNodeId: nodeId,
                flowId: runForNode.flowId,
                assetType: asset.assetType,
                mimeType: asset.mimeType,
                publicUrl,
                metadata: asset.metadata ?? {},
                createdAt: new Date().toISOString(),
            });

            if (dedupeKey) persistedAssetKeys.add(dedupeKey);

            try {
                await wsService.broadcastToFlow(runForNode.flowId, {
                    type: 'asset.created',
                    id: assetId,
                    runId,
                    flowId: runForNode.flowId,
                    nodeId,
                    assetId,
                    assetType: asset.assetType.toLowerCase(),
                    url: publicUrl,
                    publicUrl,
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
            const result = await blockExecutor.execute(node.blockType, resolvedInput, node.inputPayload ?? undefined, {
                runId,
                nodeId,
                flowId: runForNode?.flowId,
                onProgress: broadcastProgress,
                onAsset: persistAsset,
            });
            const { output, durationMs, assets } = result;

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

                await runRepo.updateRunNodeStatus(runId, nodeId, 'FAILED', {
                    errorCode: 'ANALYSIS_REJECTED',
                    errorMessage,
                    outputPayload: { ...output, durationMs },
                });

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
            if (assets && assets.length > 0 && runForNode) {
                for (const asset of assets) {
                    await persistAsset(asset);
                }
            }

            await runRepo.updateRunNodeStatus(runId, nodeId, 'COMPLETED', {
                completedAt: new Date().toISOString(),
                progress: 100,
                outputPayload: { ...output, durationMs },
            });

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
            try {
                await traceService.record(runId, nodeId, 'STATUS', `Node ${nodeId} completed`);
            } catch {
                /* non-fatal */
            }

            // Update output port data in flow.nodes[] and broadcast node/port events.
            // This allows other tabs to re-fetch updated port data via GET /nodes/{portId}/port.
            if (runForNode && Object.keys(output).length > 0) {
                try {
                    const flow = await flowRepo.get(runForNode.flowId);
                    if (flow) {
                        const now = Date.now();
                        const updatedPortNames: string[] = [];
                        const updatedNodes = (flow.nodes as Array<Record<string, unknown>>).map(node => {
                            if (
                                node['stereo'] === 'port' &&
                                node['parentId'] === nodeId &&
                                node['direction'] === 'out'
                            ) {
                                updatedPortNames.push((node['name'] as string) || 'out');
                                return { ...node, data$: { value: output, type: 'object', timestamp: now } };
                            }
                            return node;
                        });
                        if (updatedPortNames.length > 0) {
                            await flowRepo.updateCanvas(runForNode.flowId, { nodes: updatedNodes, edges: flow.edges });
                            for (const portName of updatedPortNames) {
                                await wsService.broadcastToFlow(runForNode.flowId, {
                                    type: 'node/port',
                                    id: `${nodeId}:${portName}@out`,
                                    flowId: runForNode.flowId,
                                    timestamp: now,
                                });
                            }
                        }
                    }
                } catch {
                    /* non-fatal */
                }
            }
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            console.error(`[execution-engine] node ${nodeId} failed:`, errorMessage);

            await runRepo.updateRunNodeStatus(runId, nodeId, 'FAILED', {
                errorCode: 'EXECUTION_ERROR',
                errorMessage,
            });

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
                        errorCode: 'EXECUTION_ERROR',
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
        }
    },
};
