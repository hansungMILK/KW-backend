import { api, withRetry } from '@flows/web-core';

import type { FlowView, LoadFlowResult, SaveFlowBody, SaveFlowView, UpdateFlowBody } from '../types';
import type { BlockDefinition, DataPacket, LogEntry } from '@lemoncloud/eureka-flows-api';

const _log = console.log.bind(console, '[flows-api]');

/**
 * Get flow (full state with nodes and edges)
 * GET /flows/{flowId}
 */
export const getFlow = async (id: string): Promise<LoadFlowResult> => {
    if (!id) throw new Error('Flow ID is required');
    _log(`> getFlow(${id})`);
    const response = await withRetry(() => api.get<LoadFlowResult>(`/flows/${id}`), 3, 'getFlow');
    return response.data;
};

/**
 * Update flow (batch update nodes and edges)
 * PUT /flows/{flowId}
 */
export const updateFlow = async (id: string, body: SaveFlowBody): Promise<SaveFlowView> => {
    if (!id) throw new Error('Flow ID is required');
    _log(`> updateFlow(${id})`, { nodeCount: body.nodes?.length ?? 0, edgeCount: body.edges?.length ?? 0 });
    const response = await api.put<SaveFlowView>(`/flows/${id}`, body);
    return response.data;
};

/**
 * Create new flow
 * POST /flows/0/save
 */
export const createFlow = async (body?: Partial<SaveFlowBody>): Promise<SaveFlowView> => {
    _log('> createFlow() via POST /flows/0/save');
    const saveBody: SaveFlowBody = {
        nodes: body?.nodes ?? [],
        edges: body?.edges ?? [],
    };
    const response = await api.post<SaveFlowView>('/flows/0/save', saveBody);
    return response.data;
};

/**
 * Update flow metadata (name, etc.)
 * POST /flows/:id
 */
export const updateFlowMetadata = async (id: string, body: UpdateFlowBody): Promise<FlowView> => {
    if (!id) throw new Error('Flow ID is required');
    _log(`> updateFlowMetadata(${id})`, body);
    const response = await api.post<FlowView>(`/flows/${id}`, body);
    return response.data;
};

/**
 * @deprecated Use getFlow() instead. Keep until smoke test passes.
 * GET /flows/:id/load
 */
export const loadFlow = async (id: string): Promise<LoadFlowResult> => {
    if (!id) throw new Error('Flow ID is required');
    _log(`> loadFlow(${id}) [DEPRECATED — use getFlow()]`);
    const response = await withRetry(() => api.get<LoadFlowResult>(`/flows/${id}/load`), 3, 'loadFlow');
    return response.data;
};

/**
 * @deprecated Use updateFlow() instead. Keep until smoke test passes.
 * POST /flows/:id/save
 */
export const saveFlow = async (id: string, body: SaveFlowBody): Promise<SaveFlowView> => {
    _log(`> saveFlow(${id}) [DEPRECATED — use updateFlow()]`);
    const response = await api.post<SaveFlowView>(`/flows/${id}/save`, body);
    return response.data;
};

/**
 * @deprecated Use updateFlow() instead. Keep until smoke test passes.
 * POST /flows/:id/upsert
 */
export const upsertFlow = async (id: string, body: SaveFlowBody): Promise<SaveFlowView> => {
    if (!id) throw new Error('Flow ID is required');
    _log(`> upsertFlow(${id}) [DEPRECATED — use updateFlow()]`);
    const response = await api.post<SaveFlowView>(`/flows/${id}/upsert`, body);
    return response.data;
};

/**
 * Fetch execution logs for a node
 * TODO: Implement when GET /nodes/:id/logs API is available
 */
export const fetchBlockLogs = async (nodeId: string): Promise<LogEntry[]> => {
    _log(`> fetchBlockLogs(${nodeId})`);
    return [];
};

export const createPacket = (value: unknown, type: 'text' | 'image' | 'number'): DataPacket => ({
    value,
    type,
    timestamp: Date.now(),
});

// Re-export types for convenience
export type { BlockDefinition, DataPacket, LogEntry };
export type {
    FlowBody,
    FlowView,
    LoadFlowPortData,
    LoadFlowResult,
    SaveFlowBody,
    SaveFlowView,
    UpdateFlowBody,
} from '../types';
