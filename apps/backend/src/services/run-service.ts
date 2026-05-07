import { settingsService } from './settings-service';
import { PAID_OPENAI_DISABLED, isPaidOpenAIAllowed } from '../adapters/ai/paid-openai-guard';
import { queue } from '../adapters/aws/queue';
import { env } from '../config/env';
import { flowRepo } from '../repositories/flow-repository';
import { runRepo } from '../repositories/run-repository';
import { generateNumericId } from '../utils/id-generator';

import type { ApiKeyProvider, Run, RunNode } from '@flows/contracts';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Parse flow edges to build parentNodeIds for each node.
 * Edge format can come from the legacy canvas ({ source, target }) or from
 * proposal approval ({ sourceNodeId, targetNodeId }).
 */
function buildParentMap(nodeIds: string[], edges: Array<Record<string, unknown>>): Map<string, string[]> {
    const parentMap = new Map<string, string[]>(nodeIds.map(id => [id, []]));

    for (const edge of edges) {
        const source = (edge['source'] ?? edge['sourceNodeId']) as string | undefined;
        const target = (edge['target'] ?? edge['targetNodeId']) as string | undefined;
        if (source && target && parentMap.has(target)) {
            const parents = parentMap.get(target);
            if (parents) parents.push(source);
        }
    }

    return parentMap;
}

function buildChildMap(nodeIds: string[], edges: Array<Record<string, unknown>>): Map<string, string[]> {
    const childMap = new Map<string, string[]>(nodeIds.map(id => [id, []]));

    for (const edge of edges) {
        const source = (edge['source'] ?? edge['sourceNodeId']) as string | undefined;
        const target = (edge['target'] ?? edge['targetNodeId']) as string | undefined;
        if (source && target && childMap.has(source)) {
            const children = childMap.get(source);
            if (children) children.push(target);
        }
    }

    return childMap;
}

function collectDescendantNodeIds(
    startNodeId: string,
    nodeIds: string[],
    edges: Array<Record<string, unknown>>
): string[] {
    const childMap = buildChildMap(nodeIds, edges);
    const descendants = new Set<string>();
    const stack = [...(childMap.get(startNodeId) ?? [])];

    while (stack.length > 0) {
        const current = stack.pop();
        if (!current || descendants.has(current)) continue;
        descendants.add(current);
        stack.push(...(childMap.get(current) ?? []));
    }

    return [...descendants];
}

function buildInitialInputPayload(node: Record<string, unknown>): Record<string, unknown> | null {
    const data = node['data'] as Record<string, unknown> | undefined;
    const config = (node['config'] ?? data?.['config']) as Record<string, unknown> | undefined;
    const label =
        (node['name'] as string | undefined) ??
        (node['label'] as string | undefined) ??
        (data?.['label'] as string | undefined);

    const payload: Record<string, unknown> = {};
    if (config && Object.keys(config).length > 0) {
        Object.assign(payload, config);
    }
    if (label) payload.label = label;

    return Object.keys(payload).length > 0 ? payload : null;
}

// ============================================================================
// Block → Provider mapping (F-34)
// ============================================================================

const LEGACY_BLOCK_PROVIDER_MAP: Record<string, ApiKeyProvider> = {
    'media-image': 'nanobanana',
    analysis: 'openai',
    'media-tts': 'elevenlabs',
    search: 'anthropic',
    content: 'anthropic',
    integration: 'anthropic',
};

const OPENAI_BLOCK_PROVIDER_MAP: Record<string, ApiKeyProvider> = {
    search: 'openai',
    content: 'openai',
    analysis: 'openai',
    'media-image': 'openai',
    'media-tts': 'openai',
    'media-video': 'openai',
    integration: 'openai',
};

type RunServiceFailure = {
    ok: false;
    error: string;
    status: number;
    missingProviders?: string[];
    estimatedCostUsd?: number;
    maxCostUsd?: number;
};

const getProviderForBlock = (blockType: string): ApiKeyProvider | undefined => {
    return env.aiProvider === 'legacy' ? LEGACY_BLOCK_PROVIDER_MAP[blockType] : OPENAI_BLOCK_PROVIDER_MAP[blockType];
};

const getBlockType = (node: Record<string, unknown>): string => {
    const data = node['data'] as Record<string, unknown> | undefined;
    return String(node['blockType'] ?? data?.['blockType'] ?? node['type'] ?? '');
};

const getNodeConfig = (node: Record<string, unknown>): Record<string, unknown> => {
    const data = node['data'] as Record<string, unknown> | undefined;
    const config = (node['config'] ?? data?.['config']) as Record<string, unknown> | undefined;
    return config ?? {};
};

const readPositiveNumber = (value: unknown): number | null => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
};

const getImageSceneCostUsd = (): number => {
    const quality = env.openaiImageQuality.toLowerCase();
    if (quality === 'high') return 0.25;
    if (quality === 'low') return 0.02;
    return 0.063;
};

const getMediaImageSceneCount = (node: Record<string, unknown>): number => {
    const config = getNodeConfig(node);
    const count =
        readPositiveNumber(config['count']) ??
        readPositiveNumber(config['scenes']) ??
        readPositiveNumber(config['sceneCount']) ??
        readPositiveNumber(config['frameCount']) ??
        12;
    return Math.max(1, Math.floor(count));
};

const estimateRunCostUsd = (nodes: Array<Record<string, unknown>>): number => {
    let total = 0;

    for (const node of nodes) {
        const blockType = getBlockType(node);
        switch (blockType) {
            case 'search':
                total += 0.02;
                break;
            case 'content':
                total += 0.08;
                break;
            case 'data':
                total += 0.01;
                break;
            case 'analysis':
                total += 0.03;
                break;
            case 'media-image':
                total += getMediaImageSceneCount(node) * getImageSceneCostUsd();
                break;
            case 'media-tts':
                total += 0.02;
                break;
            case 'media-video':
                total += 0.02;
                break;
            case 'integration':
                total += 0.01;
                break;
            default:
                break;
        }
    }

    return Math.round(total * 100) / 100;
};

const checkRunCostLimit = (nodes: Array<Record<string, unknown>>): RunServiceFailure | null => {
    const maxCostUsd = env.maxRunEstimatedCostUsd;
    if (maxCostUsd <= 0) return null;

    const estimatedCostUsd = estimateRunCostUsd(nodes);
    if (estimatedCostUsd <= maxCostUsd) return null;

    return {
        ok: false,
        error: 'RUN_COST_LIMIT_EXCEEDED',
        status: 422,
        estimatedCostUsd,
        maxCostUsd,
    };
};

const requiresPaidOpenAI = (nodes: Array<Record<string, unknown>>): boolean => {
    return nodes.some(node => {
        const blockType = getBlockType(node);
        return getProviderForBlock(blockType) === 'openai';
    });
};

/**
 * F-34: Check that all required API keys are present before execution.
 * Priority: block config apiKeyOverride > global SettingsTable key > env var.
 * Returns list of missing providers, or empty array if all OK.
 * Async — reads from DynamoDB in prod via settingsService.getKeyForProviderAsync().
 */
async function checkMissingApiKeys(nodes: Array<Record<string, unknown>>): Promise<string[]> {
    const missing: string[] = [];
    const checked = new Set<string>();

    for (const node of nodes) {
        const blockType = getBlockType(node);
        const provider = getProviderForBlock(blockType);
        if (!provider) continue;
        if (checked.has(provider)) continue;
        checked.add(provider);

        // Check block-level override first
        const config = getNodeConfig(node);
        const override = config?.['apiKeyOverride'] as string | undefined;
        if (override && override.trim().length > 0) continue;

        // Check global key — async to read from DynamoDB in prod
        const globalKey = await settingsService.getKeyForProviderAsync(provider);
        if (globalKey) continue;

        missing.push(provider);
    }

    return missing;
}

// ============================================================================
// Run service
// ============================================================================

export const runService = {
    /**
     * Create a new run for a flow:
     * 1. Load the flow
     * 2. Build an immutable snapshot of nodes/edges
     * 3. Compute DAG parentNodeIds for each node
     * 4. Persist Run (QUEUED) + RunNode records (all PENDING)
     * 5. Send EXECUTE_RUN queue message (async; local mode runs inline)
     * 6. Return the latest run state (COMPLETED in local, QUEUED in prod)
     */
    async createRun(
        flowId: string,
        triggerSource = 'MANUAL',
        options?: { executionMode?: string; notifyWebhook?: string }
    ): Promise<{ ok: true; run: Run } | RunServiceFailure> {
        const flow = await flowRepo.get(flowId);
        if (!flow) return { ok: false, error: `Flow ${flowId} not found`, status: 404 };

        const snapshotNodes = (flow.nodes ?? []) as Array<Record<string, unknown>>;
        const snapshotEdges = (flow.edges ?? []) as Array<Record<string, unknown>>;

        const costLimitResult = checkRunCostLimit(snapshotNodes);
        if (costLimitResult) return costLimitResult;

        if (requiresPaidOpenAI(snapshotNodes) && !isPaidOpenAIAllowed()) {
            return { ok: false, error: PAID_OPENAI_DISABLED, status: 422 };
        }

        // F-34: API key pre-flight check
        const missingProviders = await checkMissingApiKeys(snapshotNodes);
        if (missingProviders.length > 0) {
            return {
                ok: false,
                error: `MISSING_API_KEYS`,
                status: 422,
                missingProviders,
            };
        }

        const now = new Date().toISOString();
        const runId = generateNumericId();

        // Persist the Run record (QUEUED)
        const run: Run = {
            runId,
            flowId,
            runType: 'FULL_FLOW',
            status: 'QUEUED',
            triggerSource,
            executionMode: (options?.executionMode as 'full' | 'step') ?? 'full',
            notifyWebhook: options?.notifyWebhook ?? null,
            flowSnapshot: { nodes: snapshotNodes, edges: snapshotEdges },
            createdAt: now,
        };
        await runRepo.putRun(run);

        // Build DAG
        const nodeIds = snapshotNodes.map(n => (n['id'] ?? n['nodeId']) as string).filter(Boolean);
        const parentMap = buildParentMap(nodeIds, snapshotEdges);

        // Persist RunNode records (all PENDING)
        for (const node of snapshotNodes) {
            const nodeId = (node['id'] ?? node['nodeId']) as string;
            if (!nodeId) continue;

            const runNode: RunNode = {
                runId,
                nodeId,
                blockType: getBlockType(node) || 'unknown',
                label:
                    ((node['data'] as Record<string, unknown>)?.['label'] as string | undefined) ??
                    (node['name'] as string | undefined) ??
                    (node['label'] as string | undefined) ??
                    nodeId,
                status: 'PENDING',
                progress: 0,
                retryCount: 0,
                parentNodeIds: parentMap.get(nodeId) ?? [],
                inputPayload: buildInitialInputPayload(node),
                updatedAt: now,
            };
            await runRepo.putRunNode(runNode);
        }

        // Enqueue execution — local mode runs inline (sync), prod sends to SQS
        await queue.send({
            type: 'EXECUTE_RUN',
            runId,
            executionId: generateNumericId(),
            timestamp: now,
        });

        // Return the latest run state (COMPLETED in local after inline execution)
        const latest = await runRepo.getRun(runId);
        return { ok: true, run: latest ?? run };
    },

    /**
     * F-11: Create a single-node run for a specific node within a flow.
     */
    async createSingleNodeRun(
        flowId: string,
        nodeId: string,
        triggerSource = 'MANUAL'
    ): Promise<{ ok: true; run: Run } | RunServiceFailure> {
        const flow = await flowRepo.get(flowId);
        if (!flow) return { ok: false, error: `Flow ${flowId} not found`, status: 404 };

        const snapshotNodes = (flow.nodes ?? []) as Array<Record<string, unknown>>;
        const targetNode = snapshotNodes.find(n => (n['id'] ?? n['nodeId']) === nodeId);
        if (!targetNode) return { ok: false, error: `Node ${nodeId} not found in flow ${flowId}`, status: 404 };

        const costLimitResult = checkRunCostLimit([targetNode]);
        if (costLimitResult) return costLimitResult;

        if (requiresPaidOpenAI([targetNode]) && !isPaidOpenAIAllowed()) {
            return { ok: false, error: PAID_OPENAI_DISABLED, status: 422 };
        }

        // F-34: API key check for single node
        const missingProviders = await checkMissingApiKeys([targetNode]);
        if (missingProviders.length > 0) {
            return { ok: false, error: 'MISSING_API_KEYS', status: 422, missingProviders };
        }

        const now = new Date().toISOString();
        const runId = generateNumericId();
        const snapshotEdges = (flow.edges ?? []) as Array<Record<string, unknown>>;

        const run: Run = {
            runId,
            flowId,
            runType: 'SINGLE_NODE',
            targetNodeId: nodeId,
            status: 'QUEUED',
            triggerSource,
            flowSnapshot: { nodes: snapshotNodes, edges: snapshotEdges },
            createdAt: now,
        };
        await runRepo.putRun(run);

        // Only create RunNode for the target
        const runNode: RunNode = {
            runId,
            nodeId,
            blockType: getBlockType(targetNode) || 'unknown',
            label:
                ((targetNode['data'] as Record<string, unknown>)?.['label'] as string | undefined) ??
                (targetNode['name'] as string | undefined) ??
                (targetNode['label'] as string | undefined) ??
                nodeId,
            status: 'PENDING',
            progress: 0,
            retryCount: 0,
            parentNodeIds: [],
            inputPayload: buildInitialInputPayload(targetNode),
            updatedAt: now,
        };
        await runRepo.putRunNode(runNode);

        await queue.send({
            type: 'EXECUTE_RUN',
            runId,
            executionId: generateNumericId(),
            timestamp: now,
        });

        const latest = await runRepo.getRun(runId);
        return { ok: true, run: latest ?? run };
    },

    /**
     * Cancel a run:
     * - Only QUEUED or RUNNING runs can be cancelled
     * - All PENDING/RUNNING nodes are set to CANCELLED
     */
    async cancelRun(runId: string): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
        const run = await runRepo.getRun(runId);
        if (!run) return { ok: false, error: `Run ${runId} not found`, status: 404 };

        if (run.status !== 'QUEUED' && run.status !== 'RUNNING') {
            return { ok: false, error: `Run is already ${run.status}`, status: 409 };
        }

        // Cancel all active nodes first
        const nodes = await runRepo.listRunNodes(runId);
        for (const node of nodes) {
            if (node.status === 'PENDING' || node.status === 'RUNNING') {
                await runRepo.updateRunNodeStatus(runId, node.nodeId, 'CANCELLED');
            }
        }

        // Cancel the run
        await runRepo.updateRunStatus(runId, 'CANCELLED');
        return { ok: true };
    },

    /**
     * Retry a failed node:
     * 1. FAILED → PENDING (retryCount incremented in repo)
     * 2. Reset downstream SKIPPED nodes to PENDING
     * 3. If run was FAILED, transition back to RUNNING
     * 4. Resume DAG execution so downstream nodes run with fresh parent output
     */
    async retryNode(
        runId: string,
        nodeId: string,
        _reason?: string
    ): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
        const node = await runRepo.getRunNode(runId, nodeId);
        if (!node) return { ok: false, error: `RunNode ${runId}#${nodeId} not found`, status: 404 };

        if (node.status !== 'FAILED') {
            return { ok: false, error: `Node is ${node.status}, only FAILED nodes can be retried`, status: 409 };
        }

        const run = await runRepo.getRun(runId);
        if (!run) return { ok: false, error: `Run ${runId} not found`, status: 404 };
        const allNodes = await runRepo.listRunNodes(runId);
        const nodeIds = allNodes.map(n => n.nodeId);
        const edges = run.flowSnapshot.edges as Array<Record<string, unknown>>;
        const descendantNodeIds = collectDescendantNodeIds(nodeId, nodeIds, edges);

        // FAILED → PENDING (retryCount incremented inside updateRunNodeStatus)
        const result = await runRepo.updateRunNodeStatus(runId, nodeId, 'PENDING');
        if (!result.ok) return { ok: false, error: result.error, status: 409 };

        for (const descendantNodeId of descendantNodeIds) {
            const descendant = allNodes.find(n => n.nodeId === descendantNodeId);
            if (descendant?.status === 'SKIPPED' || descendant?.status === 'FAILED') {
                const descendantResult = await runRepo.updateRunNodeStatus(runId, descendantNodeId, 'PENDING');
                if (!descendantResult.ok) return { ok: false, error: descendantResult.error, status: 409 };
            }
        }

        // If run is FAILED, bring it back to RUNNING so execution can continue
        if (run?.status === 'FAILED') {
            const runResult = await runRepo.updateRunStatus(runId, 'RUNNING', {
                startedAt: run.startedAt ?? new Date().toISOString(),
                completedAt: null,
                finalOutputSummary: null,
            });
            if (!runResult.ok) {
                return { ok: false, error: runResult.error, status: 409 };
            }
        }

        // Resume the DAG instead of only the failed node, so downstream skipped
        // nodes can run with the retried node output.
        await queue.send({
            type: 'EXECUTE_RUN',
            runId,
            executionId: generateNumericId(),
            timestamp: new Date().toISOString(),
        });

        return { ok: true };
    },
};
