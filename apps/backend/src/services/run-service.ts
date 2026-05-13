import { settingsService } from './settings-service';
import { traceService } from './trace-service';
import { wsService } from './websocket-service';
import { broadcastNodePortUpdated } from './ws-flow-events-service';
import { PAID_OPENAI_DISABLED, isPaidOpenAIAllowed } from '../adapters/ai/paid-openai-guard';
import { queue } from '../adapters/aws/queue';
import { env } from '../config/env';
import { estimateGptImage2CostUsd } from '../modules/image-generation/image-style';
import { flowRepo } from '../repositories/flow-repository';
import { runRepo } from '../repositories/run-repository';
import { getFlowNodeBlockType, getFlowNodeId, isExecutableFlowNode } from '../utils/flow-node-classification';
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

const isRecord = (input: unknown): input is Record<string, unknown> =>
    input != null && typeof input === 'object' && !Array.isArray(input);

function decodePacketValue(input: unknown): unknown {
    if (!isRecord(input)) return input;

    if ('value' in input) return input['value'];
    if ('S' in input) return String(input['S'] ?? '');
    if ('N' in input) return Number(input['N']);
    if ('F' in input) return Number(input['F']);
    if ('M' in input) {
        const value = input['M'];
        if (typeof value !== 'string') return value;
        try {
            return JSON.parse(value);
        } catch {
            return value;
        }
    }

    return input;
}

function mergePortValue(payload: Record<string, unknown>, portName: string, rawValue: unknown): void {
    const value = decodePacketValue(rawValue);
    const key = portName || 'in';
    payload[key] = value;

    if ((key === 'in' || key === 'input') && isRecord(value)) {
        Object.assign(payload, value);
    }

    if ((key === 'in' || key === 'input') && typeof value === 'string') {
        payload['topic'] ??= value;
        payload['text'] ??= value;
        payload['content'] ??= value;
    }
}

function buildSavedPortInputPayload(nodeId: string, nodes: Array<Record<string, unknown>>): Record<string, unknown> {
    const payload: Record<string, unknown> = {};

    for (const node of nodes) {
        if (node['stereo'] !== 'port') continue;
        if (node['parentId'] !== nodeId) continue;
        if (node['direction'] !== 'in') continue;

        const portName = typeof node['name'] === 'string' ? node['name'] : 'in';
        const data = node['data$'] ?? (node['data'] as Record<string, unknown> | undefined)?.['data$'];
        if (data !== undefined) mergePortValue(payload, portName, data);
    }

    return payload;
}

function buildRequestInputPayload(input: Record<string, unknown> | undefined): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    if (!input) return payload;

    for (const [portName, rawValue] of Object.entries(input)) {
        mergePortValue(payload, portName, rawValue);
    }

    return payload;
}

const hasSuppliedOutput = (
    overrides?: SingleNodeRunOverrides
): overrides is SingleNodeRunOverrides & {
    output: Record<string, unknown>;
} => !!overrides?.output && Object.keys(overrides.output).length > 0;

function buildSingleNodeInputPayload(
    targetNode: Record<string, unknown>,
    allNodes: Array<Record<string, unknown>>,
    overrides?: SingleNodeRunOverrides
): Record<string, unknown> | null {
    const targetNodeId = String(targetNode['id'] ?? targetNode['nodeId'] ?? '');
    const payload: Record<string, unknown> = {
        ...(buildInitialInputPayload(targetNode) ?? {}),
        ...buildSavedPortInputPayload(targetNodeId, allNodes),
        ...buildRequestInputPayload(overrides?.input),
    };

    if (overrides?.config && Object.keys(overrides.config).length > 0) {
        Object.assign(payload, overrides.config);
    }

    if (overrides?.output && Object.keys(overrides.output).length > 0) {
        payload['output'] = overrides.output;
    }

    return Object.keys(payload).length > 0 ? payload : null;
}

function mergeExecutionPayloadForCostGuard(
    node: Record<string, unknown>,
    inputPayload: Record<string, unknown> | null | undefined
): Record<string, unknown> {
    if (!inputPayload || Object.keys(inputPayload).length === 0) return node;

    const nestedConfig = isRecord(inputPayload['config']) ? inputPayload['config'] : {};
    return {
        ...node,
        config: {
            ...getNodeConfig(node),
            ...nestedConfig,
        },
        data: {
            ...getNodeData(node),
            ...inputPayload,
        },
    };
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
    'longform-tts': 'elevenlabs',
};

const OPENAI_BLOCK_PROVIDER_MAP: Record<string, ApiKeyProvider> = {
    search: 'openai',
    content: 'openai',
    analysis: 'openai',
    'media-image': 'openai',
    'media-tts': 'elevenlabs',
    'media-video': 'openai',
    integration: 'openai',
    'longform-tts': 'elevenlabs',
};

type RunServiceFailure = {
    ok: false;
    error: string;
    status: number;
    missingProviders?: string[];
    estimatedCostUsd?: number;
    maxCostUsd?: number;
};

type SingleNodeRunOverrides = {
    config?: Record<string, unknown>;
    input?: Record<string, unknown>;
    output?: Record<string, unknown>;
};

const getProviderForBlock = (blockType: string): ApiKeyProvider | undefined => {
    return env.aiProvider === 'legacy' ? LEGACY_BLOCK_PROVIDER_MAP[blockType] : OPENAI_BLOCK_PROVIDER_MAP[blockType];
};

const getBlockType = (node: Record<string, unknown>): string => {
    return getFlowNodeBlockType(node);
};

const getNodeId = (node: Record<string, unknown>): string => getFlowNodeId(node);

const isExecutableNode = (node: Record<string, unknown>): boolean => isExecutableFlowNode(node);

const getNodeConfig = (node: Record<string, unknown>): Record<string, unknown> => {
    const data = node['data'] as Record<string, unknown> | undefined;
    const config = (node['config'] ?? data?.['config']) as Record<string, unknown> | undefined;
    return config ?? {};
};

const getNodeData = (node: Record<string, unknown>): Record<string, unknown> => {
    const data = node['data'] as Record<string, unknown> | undefined;
    return data ?? {};
};

const readPositiveNumber = (value: unknown): number | null => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
};

const readFirstPositiveNumber = (
    record: Record<string, unknown>,
    keys: string[],
    fallbackRecord?: Record<string, unknown>
): number | null => {
    for (const key of keys) {
        const value = readPositiveNumber(record[key]) ?? readPositiveNumber(fallbackRecord?.[key]);
        if (value !== null) return value;
    }
    return null;
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

const LONGFORM_HTML_RENDER_BLOCK_TYPES = new Set([
    'html-compose',
    'html-render',
    'hyperframes-compose',
    'hyperframes-render',
    'longform-render',
    'mp4-render',
]);

const LONGFORM_GATE_B_BLOCK_TYPES = new Set([
    'longform-tts',
    'longform-srt-align',
    'longform-motion-compose',
    'longform-render',
    'longform-qa',
    'longform-package',
]);

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
                total += estimateGptImage2CostUsd(
                    getMediaImageSceneCount(node),
                    getNodeConfig(node)['imageQuality'] ?? env.openaiImageQuality
                );
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
            case 'longform-source':
                total += 0.02;
                break;
            case 'longform-brief':
                total += 0.03;
                break;
            case 'longform-script':
                total += 0.04;
                break;
            case 'longform-storyboard':
                total += 0.03;
                break;
            case 'longform-scene-json':
                total += 0.02;
                break;
            case 'longform-review':
                total += 0.01;
                break;
            case 'longform-tts':
                total += 0.08;
                break;
            case 'longform-srt-align':
                total += 0.01;
                break;
            case 'longform-motion-compose':
                total += 0.05;
                break;
            case 'longform-render':
                total += 0.5;
                break;
            case 'longform-qa':
            case 'longform-package':
                total += 0.01;
                break;
            default:
                break;
        }
    }

    return Math.round(total * 100) / 100;
};

const isLongformHtmlRenderNode = (node: Record<string, unknown>): boolean => {
    const config = getNodeConfig(node);
    const data = getNodeData(node);
    const blockType = getBlockType(node);
    const renderer = String(
        config['renderer'] ?? config['rendererRoute'] ?? config['renderRoute'] ?? data['renderer'] ?? ''
    );

    if (LONGFORM_HTML_RENDER_BLOCK_TYPES.has(blockType)) return true;
    return blockType === 'media-video' && /hyperframes|html/i.test(renderer);
};

const estimateLongformHtmlRenderCostUsd = (nodes: Array<Record<string, unknown>>): number => {
    let total = 0;

    for (const node of nodes) {
        if (!isLongformHtmlRenderNode(node)) continue;

        const config = getNodeConfig(node);
        const data = getNodeData(node);
        const combined =
            readFirstPositiveNumber(
                config,
                [
                    'longformHtmlRenderEstimatedCostUsd',
                    'htmlRenderEstimatedCostUsd',
                    'renderGenerationEstimatedCostUsd',
                ],
                data
            ) ?? 0;
        const compose =
            readFirstPositiveNumber(
                config,
                ['htmlComposeEstimatedCostUsd', 'composeEstimatedCostUsd', 'hyperframesComposeEstimatedCostUsd'],
                data
            ) ?? 0;
        const render =
            readFirstPositiveNumber(
                config,
                ['hyperframesRenderEstimatedCostUsd', 'renderEstimatedCostUsd', 'mp4RenderEstimatedCostUsd'],
                data
            ) ?? 0;

        total += Math.max(combined, compose + render);
    }

    return Math.round(total * 100) / 100;
};

const checkLongformHtmlRenderCostLimit = (nodes: Array<Record<string, unknown>>): RunServiceFailure | null => {
    const maxCostUsd = env.maxLongformHtmlRenderEstimatedCostUsd;
    if (maxCostUsd <= 0) return null;

    const estimatedCostUsd = estimateLongformHtmlRenderCostUsd(nodes);
    if (estimatedCostUsd <= maxCostUsd) return null;

    return {
        ok: false,
        error: 'LONGFORM_HTML_RENDER_COST_LIMIT_EXCEEDED',
        status: 422,
        estimatedCostUsd,
        maxCostUsd,
    };
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

const hasApprovedLongformGateAArtifact = (node: Record<string, unknown>): boolean => {
    const config = getNodeConfig(node);
    const data = getNodeData(node);
    const approvalRecords = [config, data];

    return approvalRecords.some(record => {
        const approvedArtifactId = record['approvedArtifactId'];
        const reviewedOutput = record['reviewedOutput'];
        return (
            record['mediaExecutionAllowed'] === true ||
            record['reviewStatus'] === 'approved' ||
            (typeof approvedArtifactId === 'string' && approvedArtifactId.trim().length > 0) ||
            (typeof reviewedOutput === 'string' && reviewedOutput.trim().length > 0) ||
            (isRecord(reviewedOutput) && Object.keys(reviewedOutput).length > 0)
        );
    });
};

const checkLongformGateBApproval = (nodes: Array<Record<string, unknown>>): RunServiceFailure | null => {
    const hasApprovedReviewNode = nodes.some(
        node => isLongformReviewNode(node) && hasApprovedLongformGateAArtifact(node)
    );
    const blockedNode = nodes.find(node => {
        const blockType = getBlockType(node);
        return (
            LONGFORM_GATE_B_BLOCK_TYPES.has(blockType) &&
            !hasApprovedReviewNode &&
            !hasApprovedLongformGateAArtifact(node)
        );
    });

    if (!blockedNode) return null;

    return {
        ok: false,
        error: 'LONGFORM_GATE_B_APPROVAL_REQUIRED',
        status: 409,
    };
};

const isLongformReviewNode = (node: Record<string, unknown>): boolean => getBlockType(node) === 'longform-review';

const isUnapprovedLongformGateBNode = (node: Record<string, unknown>): boolean => {
    return LONGFORM_GATE_B_BLOCK_TYPES.has(getBlockType(node)) && !hasApprovedLongformGateAArtifact(node);
};

const getPreflightNodesForRun = (
    nodes: Array<Record<string, unknown>>,
    executionMode: 'full' | 'step'
): Array<Record<string, unknown>> => {
    const shouldStopForReview =
        executionMode === 'step' && nodes.some(isLongformReviewNode) && nodes.some(isUnapprovedLongformGateBNode);

    if (!shouldStopForReview) return nodes;
    return nodes.filter(node => !LONGFORM_GATE_B_BLOCK_TYPES.has(getBlockType(node)));
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
        const executableNodes = snapshotNodes.filter(isExecutableNode);
        const snapshotEdges = (flow.edges ?? []) as Array<Record<string, unknown>>;
        const executionMode = (options?.executionMode as 'full' | 'step') ?? 'full';
        const preflightNodes = getPreflightNodesForRun(executableNodes, executionMode);

        if (executableNodes.length === 0) {
            return { ok: false, error: `Flow ${flowId} has no executable nodes`, status: 422 };
        }

        const longformCostLimitResult = checkLongformHtmlRenderCostLimit(preflightNodes);
        if (longformCostLimitResult) return longformCostLimitResult;

        const costLimitResult = checkRunCostLimit(preflightNodes);
        if (costLimitResult) return costLimitResult;

        const longformApprovalResult = checkLongformGateBApproval(preflightNodes);
        if (longformApprovalResult) return longformApprovalResult;

        if (requiresPaidOpenAI(preflightNodes) && !isPaidOpenAIAllowed()) {
            return { ok: false, error: PAID_OPENAI_DISABLED, status: 422 };
        }

        // F-34: API key pre-flight check
        const missingProviders = await checkMissingApiKeys(preflightNodes);
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
            executionMode,
            notifyWebhook: options?.notifyWebhook ?? null,
            flowSnapshot: { nodes: executableNodes, edges: snapshotEdges },
            createdAt: now,
        };
        await runRepo.putRun(run);

        // Build DAG
        const nodeIds = executableNodes.map(getNodeId).filter(Boolean);
        const parentMap = buildParentMap(nodeIds, snapshotEdges);

        // Persist RunNode records (all PENDING)
        for (const node of executableNodes) {
            const nodeId = getNodeId(node);
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
        triggerSource = 'MANUAL',
        overrides?: SingleNodeRunOverrides
    ): Promise<{ ok: true; run: Run } | RunServiceFailure> {
        const flow = await flowRepo.get(flowId);
        if (!flow) return { ok: false, error: `Flow ${flowId} not found`, status: 404 };

        const snapshotNodes = (flow.nodes ?? []) as Array<Record<string, unknown>>;
        const executableNodes = snapshotNodes.filter(isExecutableNode);
        const targetNode = executableNodes.find(n => getNodeId(n) === nodeId);
        if (!targetNode) return { ok: false, error: `Node ${nodeId} not found in flow ${flowId}`, status: 404 };

        const targetInputPayload = buildSingleNodeInputPayload(targetNode, snapshotNodes, overrides);
        const costGuardTargetNode = mergeExecutionPayloadForCostGuard(targetNode, targetInputPayload);
        const longformCostLimitResult = checkLongformHtmlRenderCostLimit([costGuardTargetNode]);
        if (longformCostLimitResult) return longformCostLimitResult;

        const costLimitResult = checkRunCostLimit([targetNode]);
        if (costLimitResult) return costLimitResult;

        const longformApprovalResult = checkLongformGateBApproval([costGuardTargetNode]);
        if (longformApprovalResult) return longformApprovalResult;

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
            flowSnapshot: { nodes: executableNodes, edges: snapshotEdges },
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
            inputPayload: targetInputPayload,
            updatedAt: now,
        };
        await runRepo.putRunNode(runNode);

        if (hasSuppliedOutput(overrides)) {
            const outputPayload = { ...overrides.output, durationMs: 0 };
            const startedAt = now;
            const completedAt = new Date().toISOString();

            await runRepo.updateRunStatus(runId, 'RUNNING', { startedAt });
            await runRepo.updateRunNodeStatus(runId, nodeId, 'RUNNING', { startedAt, progress: 0 });
            await runRepo.updateRunNodeStatus(runId, nodeId, 'COMPLETED', {
                completedAt,
                progress: 100,
                outputPayload,
            });
            await runRepo.updateRunStatus(runId, 'COMPLETED', {
                completedAt,
                finalOutputSummary: { targetNodeId: nodeId, output: overrides.output },
            });

            try {
                await wsService.broadcastToFlow(flowId, {
                    type: 'node.completed',
                    id: nodeId,
                    runId,
                    flowId,
                    nodeId,
                    status: 'COMPLETED',
                    timestamp: Date.now(),
                });
                await broadcastNodePortUpdated(flowId, nodeId, overrides.output, { splitOutputPorts: true });
                await wsService.broadcastToFlow(flowId, {
                    type: 'run.completed',
                    id: runId,
                    runId,
                    flowId,
                    status: 'COMPLETED',
                    timestamp: Date.now(),
                });
            } catch {
                /* non-fatal — websocket delivery is best-effort */
            }

            try {
                await traceService.record(runId, nodeId, 'STATUS', `Frontend node ${nodeId} completed`);
                await traceService.record(runId, null, 'STATUS', 'Run completed');
            } catch {
                /* non-fatal */
            }

            const latest = await runRepo.getRun(runId);
            return { ok: true, run: latest ?? { ...run, status: 'COMPLETED', completedAt } };
        }

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
    async retryNode(runId: string, nodeId: string, _reason?: string): Promise<{ ok: true } | RunServiceFailure> {
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
        const retryScopeNodeIds = new Set([nodeId, ...descendantNodeIds]);
        const runNodeById = new Map(allNodes.map(runNode => [runNode.nodeId, runNode]));
        const snapshotNodes = (run.flowSnapshot.nodes ?? []) as Array<Record<string, unknown>>;
        const retryScopeNodes = snapshotNodes
            .filter(snapshotNode => retryScopeNodeIds.has(getNodeId(snapshotNode)))
            .map(snapshotNode =>
                mergeExecutionPayloadForCostGuard(
                    snapshotNode,
                    runNodeById.get(getNodeId(snapshotNode))?.inputPayload ?? undefined
                )
            );

        const longformCostLimitResult = checkLongformHtmlRenderCostLimit(retryScopeNodes);
        if (longformCostLimitResult) return longformCostLimitResult;

        const longformApprovalResult = checkLongformGateBApproval(retryScopeNodes);
        if (longformApprovalResult) return longformApprovalResult;

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
