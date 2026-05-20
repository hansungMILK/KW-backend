import { api, withRetry } from '@flows/web-core';

import { normalizeNodeList } from './normalizers';

import type {
    BlockDefinition,
    DataPacket,
    FlowBody,
    FlowView,
    LoadFlowPortData,
    LoadFlowResult,
    LogEntry,
    SaveFlowBody,
    SaveFlowView,
    UpdateFlowBody,
} from '../types';
import type { FlowListResponse, FlowSummary, Trace, TraceListResponse } from '@flows/contracts';

const _log = console.log.bind(console, '[flows-api]');
const flowWriteQueues = new Map<string, Promise<unknown>>();

interface SpecFlowSummary {
    flowId: string;
    title: string;
    description?: string;
    status: FlowView['state'];
    createdAt: string;
    updatedAt: string;
    channelId?: string;
}

interface SpecFlowDetail extends SpecFlowSummary {
    nodes: SaveFlowBody['nodes'];
    edges: SaveFlowBody['edges'];
    ports?: LoadFlowPortData[];
    latestProposalId?: string | null;
    lastRunId?: string | null;
}

type RecordItem = Record<string, unknown>;

const getItemId = (item: unknown): string | null => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const id = (item as RecordItem)['id'];
    return typeof id === 'string' && id.length > 0 ? id : null;
};

const mergeRecord = (existing: RecordItem, patch: RecordItem): RecordItem => {
    const existingData = existing['data'];
    const patchData = patch['data'];
    const existingConfig = existing['config'];
    const patchConfig = patch['config'];

    return {
        ...existing,
        ...patch,
        ...(existingData && typeof existingData === 'object' && !Array.isArray(existingData)
            ? {
                  data:
                      patchData && typeof patchData === 'object' && !Array.isArray(patchData)
                          ? { ...(existingData as RecordItem), ...(patchData as RecordItem) }
                          : existingData,
              }
            : {}),
        ...(patchData && typeof patchData === 'object' && !Array.isArray(patchData) && !existingData
            ? { data: patchData }
            : {}),
        ...(existingConfig && typeof existingConfig === 'object' && !Array.isArray(existingConfig)
            ? {
                  config:
                      patchConfig && typeof patchConfig === 'object' && !Array.isArray(patchConfig)
                          ? { ...(existingConfig as RecordItem), ...(patchConfig as RecordItem) }
                          : existingConfig,
              }
            : {}),
        ...(patchConfig && typeof patchConfig === 'object' && !Array.isArray(patchConfig) && !existingConfig
            ? { config: patchConfig }
            : {}),
    };
};

const applyUpserts = <T>(existingItems: T[], patchItems: T[]): T[] => {
    let result = [...existingItems];

    for (const patch of patchItems) {
        const patchId = getItemId(patch);
        if (!patchId) continue;

        if (patchId.startsWith('#')) {
            const deleteId = patchId.slice(1);
            result = result.filter(item => getItemId(item) !== deleteId);
            continue;
        }

        const index = result.findIndex(item => getItemId(item) === patchId);
        if (index === -1) {
            result.push(patch);
            continue;
        }

        const existing = result[index];
        result[index] =
            existing && typeof existing === 'object' && !Array.isArray(existing)
                ? (mergeRecord(existing as RecordItem, patch as RecordItem) as T)
                : patch;
    }

    return result;
};

const enqueueFlowWrite = <T>(id: string, task: () => Promise<T>): Promise<T> => {
    const previous = flowWriteQueues.get(id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    flowWriteQueues.set(id, next);
    return next.finally(() => {
        if (flowWriteQueues.get(id) === next) {
            flowWriteQueues.delete(id);
        }
    });
};

const toLoadFlowResult = (flow: SpecFlowDetail): LoadFlowResult => ({
    id: flow.flowId,
    name: flow.title,
    state: flow.status,
    description: flow.description,
    nodes: normalizeNodeList(flow.nodes),
    edges: flow.edges ?? [],
    ports: flow.ports ?? [],
    channelId: flow.flowId,
    createdAt: flow.createdAt,
    updatedAt: flow.updatedAt,
});

const toSaveFlowView = (flow: SpecFlowDetail): SaveFlowView => ({
    id: flow.flowId,
    name: flow.title,
    state: flow.status,
    description: flow.description,
    nodes: normalizeNodeList(flow.nodes),
    edges: flow.edges ?? [],
    ports: flow.ports ?? [],
    channelId: flow.flowId,
    createdAt: flow.createdAt,
    updatedAt: flow.updatedAt,
});

export const listFlows = async (limit = 20): Promise<FlowSummary[]> => {
    const response = await api.get<FlowListResponse>('/flows', { params: { limit } });
    return response.data.items;
};

const toCreatedFlowView = (flow: SpecFlowSummary): SaveFlowView => ({
    id: flow.flowId,
    name: flow.title,
    state: flow.status,
    description: flow.description,
    nodes: [],
    edges: [],
    ports: [],
    channelId: flow.flowId,
    createdAt: flow.createdAt,
    updatedAt: flow.updatedAt,
});

const putFlow = async (id: string, body: SaveFlowBody, title?: string): Promise<SaveFlowView> => {
    const response = await api.put<SpecFlowDetail>(`/flows/${id}`, {
        title,
        nodes: body.nodes,
        edges: body.edges ?? body.connections ?? [],
    });
    return toSaveFlowView(response.data);
};

/**
 * Get flow (full state with nodes and edges)
 * GET /flows/{flowId}
 */
export const getFlow = async (id: string): Promise<LoadFlowResult> => {
    if (!id) throw new Error('Flow ID is required');
    _log(`> getFlow(${id})`);
    const response = await withRetry(() => api.get<SpecFlowDetail>(`/flows/${id}`), 3, 'getFlow');
    return toLoadFlowResult(response.data);
};

/**
 * Update flow (complete canvas replacement)
 * PUT /flows/{flowId}
 */
export const updateFlow = async (id: string, body: SaveFlowBody): Promise<SaveFlowView> => {
    if (!id) throw new Error('Flow ID is required');
    _log(`> updateFlow(${id})`, { nodeCount: body.nodes?.length ?? 0, edgeCount: body.edges?.length ?? 0 });
    return putFlow(id, body);
};

/**
 * Create new flow
 * POST /flows, then optional PUT /flows/{flowId}
 */
export const createFlow = async (body?: Partial<SaveFlowBody>): Promise<SaveFlowView> => {
    _log('> createFlow() via POST /flows');
    const createResponse = await api.post<SpecFlowSummary>('/flows', { title: 'Untitled Workflow' });
    const created = toCreatedFlowView(createResponse.data);
    if (!created.id) throw new Error('Failed to create flow: no ID returned');

    const saveBody: SaveFlowBody = {
        nodes: body?.nodes ?? [],
        edges: body?.edges ?? [],
    };
    return saveBody.nodes.length > 0 || saveBody.edges.length > 0
        ? putFlow(created.id, saveBody, created.name)
        : created;
};

/**
 * Update flow metadata (name, etc.)
 * PUT /flows/{flowId}
 */
export const updateFlowMetadata = async (id: string, body: UpdateFlowBody): Promise<FlowView> => {
    if (!id) throw new Error('Flow ID is required');
    _log(`> updateFlowMetadata(${id})`, body);
    const current = await getFlow(id);
    return putFlow(id, { nodes: current.nodes, edges: current.edges }, body.name ?? current.name);
};

/**
 * @deprecated Use getFlow() instead.
 */
export const loadFlow = async (id: string): Promise<LoadFlowResult> => getFlow(id);

/**
 * @deprecated Use createFlow()/updateFlow() instead.
 */
export const saveFlow = async (id: string, body: SaveFlowBody): Promise<SaveFlowView> => {
    if (id === '0') return createFlow(body);
    return updateFlow(id, body);
};

/**
 * @deprecated Use full-canvas updateFlow() where possible.
 * This compatibility helper preserves old upsert semantics without calling
 * removed legacy backend endpoints.
 */
export const upsertFlow = async (id: string, body: SaveFlowBody): Promise<SaveFlowView> => {
    if (!id) throw new Error('Flow ID is required');
    _log(`> upsertFlow(${id}) [compat read-modify-write]`, {
        nodeCount: body.nodes?.length ?? 0,
        edgeCount: body.edges?.length ?? 0,
    });
    return enqueueFlowWrite(id, async () => {
        const current = await getFlow(id);
        return updateFlow(id, {
            nodes: applyUpserts(current.nodes ?? [], body.nodes ?? []),
            edges: applyUpserts(current.edges ?? [], body.edges ?? body.connections ?? []),
        });
    });
};

export interface FetchBlockLogsOptions {
    runId: string;
    nodeId: string;
    limit?: number;
}

const traceLevelToLogLevel = (traceType: Trace['traceType']): LogEntry['level'] => {
    if (traceType === 'ERROR') return 'ERROR';
    if (traceType === 'RETRY' || traceType === 'POLICY') return 'WARN';
    return 'INFO';
};

const formatTraceMessage = (trace: Trace): string => {
    const data = trace.data && Object.keys(trace.data).length > 0 ? ` ${JSON.stringify(trace.data)}` : '';
    return `[${trace.traceType}] ${trace.message}${data}`;
};

/**
 * Fetch execution logs for a node from the run trace API.
 */
export const fetchBlockLogs = async ({ runId, nodeId, limit = 100 }: FetchBlockLogsOptions): Promise<LogEntry[]> => {
    if (!runId) throw new Error('Run ID is required');
    if (!nodeId) throw new Error('Node ID is required');

    _log(`> fetchBlockLogs(${runId}, ${nodeId})`, { limit });
    const response = await api.get<TraceListResponse>(`/runs/${runId}/nodes/${nodeId}/traces`, {
        params: { limit },
    });

    return response.data.items.map(trace => ({
        id: trace.traceId,
        timestamp: trace.occurredAt,
        type: trace.traceType,
        level: traceLevelToLogLevel(trace.traceType),
        message: formatTraceMessage(trace),
    }));
};

export const createPacket = (value: unknown, type: 'text' | 'image' | 'number'): DataPacket => ({
    value,
    type,
    timestamp: Date.now(),
});

export type {
    BlockDefinition,
    DataPacket,
    FlowBody,
    FlowView,
    LoadFlowPortData,
    LoadFlowResult,
    LogEntry,
    SaveFlowBody,
    SaveFlowView,
    UpdateFlowBody,
};
