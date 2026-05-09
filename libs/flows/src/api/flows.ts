import { api, withRetry } from '@flows/web-core';

import type {
    CreateFlowBody,
    DeleteFlowResult,
    FlowDetail,
    FlowListParams,
    FlowListResult,
    FlowSummary,
    FlowView,
    LoadFlowResult,
    PutFlowBody,
    SaveFlowBody,
    SaveFlowView,
    UpdateFlowBody,
} from '../types';
import type { BlockDefinition, DataPacket, LogEntry } from '@lemoncloud/eureka-flows-api';

const _log = console.log.bind(console, '[flows-api]');

// ============================================================================
// Spec v2 API — 명세 기준 경로
// ============================================================================

/**
 * List flows
 * GET /flows
 */
export const listFlows = async (params?: FlowListParams): Promise<FlowListResult> => {
    _log('> listFlows()', params);
    const response = await api.get<FlowListResult>('/flows', { params });
    return response.data;
};

/**
 * Create new flow
 * POST /flows
 */
export const createFlowV2 = async (body: CreateFlowBody): Promise<FlowSummary> => {
    _log('> createFlowV2()', body);
    const response = await api.post<FlowSummary>('/flows', body);
    return response.data;
};

/**
 * Get flow by ID (complete state with nodes and edges)
 * GET /flows/{flowId}
 */
export const getFlow = async (flowId: string): Promise<FlowDetail> => {
    if (!flowId) throw new Error('Flow ID is required');
    _log(`> getFlow(${flowId})`);
    const response = await withRetry(() => api.get<FlowDetail>(`/flows/${flowId}`), 3, 'getFlow');
    return response.data;
};

/**
 * Update flow canvas (unified save — replaces save/upsert/meta endpoints)
 * PUT /flows/{flowId}
 *
 * nodes.length >= 1 이면 DRAFT → READY 자동 전이
 */
export const putFlow = async (flowId: string, body: PutFlowBody): Promise<FlowSummary> => {
    if (!flowId) throw new Error('Flow ID is required');
    _log(`> putFlow(${flowId})`, { nodeCount: body.nodes.length, edgeCount: body.edges.length });
    const response = await api.put<FlowSummary>(`/flows/${flowId}`, body);
    return response.data;
};

/**
 * Delete flow and cascade messages/proposals
 * DELETE /flows/{flowId}
 */
export const deleteFlow = async (flowId: string): Promise<DeleteFlowResult> => {
    if (!flowId) throw new Error('Flow ID is required');
    _log(`> deleteFlow(${flowId})`);
    const response = await api.delete<DeleteFlowResult>(`/flows/${flowId}`);
    return response.data;
};

/**
 * Duplicate flow (creates new DRAFT flow)
 * POST /flows/{flowId}/duplicate
 */
export const duplicateFlow = async (flowId: string): Promise<FlowSummary> => {
    if (!flowId) throw new Error('Flow ID is required');
    _log(`> duplicateFlow(${flowId})`);
    const response = await api.post<FlowSummary>(`/flows/${flowId}/duplicate`);
    return response.data;
};

/**
 * Archive flow (READY → ARCHIVED)
 * POST /flows/{flowId}/archive
 */
export const archiveFlow = async (flowId: string): Promise<FlowSummary> => {
    if (!flowId) throw new Error('Flow ID is required');
    _log(`> archiveFlow(${flowId})`);
    const response = await api.post<FlowSummary>(`/flows/${flowId}/archive`);
    return response.data;
};

/**
 * Unarchive flow (ARCHIVED → READY)
 * POST /flows/{flowId}/unarchive
 */
export const unarchiveFlow = async (flowId: string): Promise<FlowSummary> => {
    if (!flowId) throw new Error('Flow ID is required');
    _log(`> unarchiveFlow(${flowId})`);
    const response = await api.post<FlowSummary>(`/flows/${flowId}/unarchive`);
    return response.data;
};

// ============================================================================
// Legacy API — Phase 3에서 제거 예정 (기존 canvas가 아직 의존 중)
// ============================================================================

/**
 * Load flow snapshot (complete state with nodes and edges)
 * GET /flows/:id/load
 *
 * @deprecated Use getFlow() — GET /flows/{flowId}
 */
export const loadFlow = async (id: string): Promise<LoadFlowResult> => {
    if (!id) {
        throw new Error('Flow ID is required');
    }
    _log(`> loadFlow(${id})`);
    const response = await withRetry(() => api.get<LoadFlowResult>(`/flows/${id}/load`), 3, 'loadFlow');
    return response.data;
};

/**
 * Save flow snapshot (complete state with nodes and edges)
 * POST /flows/:id/save
 *
 * @deprecated Use putFlow() — PUT /flows/{flowId}
 */
export const saveFlow = async (id: string, body: SaveFlowBody): Promise<SaveFlowView> => {
    _log(`> saveFlow(${id})`, { nodeCount: body.nodes.length, edgeCount: body.edges?.length ?? 0 });
    const response = await api.post<SaveFlowView>(`/flows/${id}/save`, body);
    return response.data;
};

/**
 * Create new flow via POST /flows/0/save
 *
 * @deprecated Use createFlowV2() — POST /flows
 */
export const createFlow = async (body?: Partial<SaveFlowBody>): Promise<SaveFlowView> => {
    _log('> createFlow() via POST /flows/0/save');
    const saveBody: SaveFlowBody = {
        nodes: body?.nodes ?? [],
        edges: body?.edges ?? [],
    };
    return saveFlow('0', saveBody);
};

/**
 * Upsert flow (batch update nodes and edges)
 * POST /flows/:id/upsert
 *
 * @deprecated Use putFlow() — PUT /flows/{flowId}
 */
export const upsertFlow = async (id: string, body: SaveFlowBody): Promise<SaveFlowView> => {
    if (!id) {
        throw new Error('Flow ID is required');
    }
    _log(`> upsertFlow(${id})`, { nodeCount: body.nodes?.length ?? 0, edgeCount: body.edges?.length ?? 0 });
    const response = await api.post<SaveFlowView>(`/flows/${id}/upsert`, body);
    return response.data;
};

/**
 * Update flow metadata (name, etc.)
 * POST /flows/:id
 *
 * @deprecated Use putFlow() — PUT /flows/{flowId}
 */
export const updateFlowMetadata = async (id: string, body: UpdateFlowBody): Promise<FlowView> => {
    if (!id) {
        throw new Error('Flow ID is required');
    }
    _log(`> updateFlowMetadata(${id})`, body);
    const response = await api.post<FlowView>(`/flows/${id}`, body);
    return response.data;
};

/**
 * Fetch execution logs for a node
 * TODO: Implement when server API is available
 * @param nodeId - Node ID to fetch logs for
 * @returns Empty array (placeholder)
 */
export const fetchBlockLogs = async (nodeId: string): Promise<LogEntry[]> => {
    _log(`> fetchBlockLogs(${nodeId})`);
    // TODO: Implement when GET /nodes/:id/logs API is available
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
    CreateFlowBody,
    DeleteFlowResult,
    FlowBody,
    FlowDetail,
    FlowListParams,
    FlowListResult,
    FlowStatus,
    FlowSummary,
    FlowView,
    LoadFlowPortData,
    LoadFlowResult,
    PutFlowBody,
    SaveFlowBody,
    SaveFlowView,
    UpdateFlowBody,
} from '../types';
