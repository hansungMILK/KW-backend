import { getFlow, upsertFlow } from './flows';

import type { EdgeBody, EdgeData, EdgeView } from '../types';

const _log = console.log.bind(console, '[edges-api]');

const createClientEdgeId = (): string => `edge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const requireFlowId = (flowId?: string): string => {
    if (!flowId) throw new Error('flowId is required after P3 legacy /edges endpoint removal');
    return flowId;
};

// ============================================================================
// Spec v2 API — /flows/{flowId}/edges/* 명세 기준 경로
// ============================================================================

/**
 * List edges by flow ID
 * GET /flows/{flowId}/edges
 */
export const listFlowEdges = async (flowId: string): Promise<EdgeView[]> => {
    _log(`> listFlowEdges(${flowId})`);
    const response = await withRetry(
        () => api.get<ApiListResult<EdgeView>>(`/flows/${flowId}/edges`),
        3,
        'listFlowEdges'
    );
    return response.data.list || [];
};

/**
 * Create new edge under a flow
 * POST /flows/{flowId}/edges
 */
export const createFlowEdge = async (flowId: string, body: EdgeBody): Promise<EdgeView> => {
    _log(`> createFlowEdge(${flowId})`, body);
    const response = await api.post<EdgeView>(`/flows/${flowId}/edges`, body);
    return response.data;
};

/**
 * Get edge by ID within a flow
 * GET /flows/{flowId}/edges/{edgeId}
 */
export const getFlowEdge = async (flowId: string, edgeId: string): Promise<EdgeView> => {
    _log(`> getFlowEdge(${flowId}, ${edgeId})`);
    const response = await api.get<EdgeView>(`/flows/${flowId}/edges/${edgeId}`);
    return response.data;
};

/**
 * Update edge within a flow
 * PUT /flows/{flowId}/edges/{edgeId}
 */
export const updateFlowEdge = async (flowId: string, edgeId: string, body: EdgeBody): Promise<EdgeView> => {
    _log(`> updateFlowEdge(${flowId}, ${edgeId})`, body);
    const response = await api.put<EdgeView>(`/flows/${flowId}/edges/${edgeId}`, body);
    return response.data;
};

/**
 * Delete edge from a flow
 * DELETE /flows/{flowId}/edges/{edgeId}
 */
export const deleteFlowEdge = async (flowId: string, edgeId: string): Promise<void> => {
    _log(`> deleteFlowEdge(${flowId}, ${edgeId})`);
    await api.delete(`/flows/${flowId}/edges/${edgeId}`);
};

// ============================================================================
// Legacy API — Phase 3에서 제거 예정 (프론트 캔버스가 아직 의존 중)
// ============================================================================

/**
 * @deprecated Use GET /flows/{flowId} edges array instead. Removal in P3.
 * List edges by flow ID
 * POST /edges/0/list
 *
 * @deprecated Use listFlowEdges() — GET /flows/{flowId}/edges
 */
export const listEdges = async (flowId: string): Promise<EdgeView[]> => {
    _log(`> listEdges(${flowId})`);
    const flow = await getFlow(flowId);
    return (flow.edges ?? []) as unknown as EdgeView[];
};

/**
 * @deprecated Use upsertFlow() from flows.ts instead. Removal in P3.
 * Get edge by ID
 * GET /edges/:id
 *
 * @deprecated Use getFlowEdge() — GET /flows/{flowId}/edges/{edgeId}
 */
export const getEdge = async (id: string): Promise<EdgeView> => {
    _log(`> getEdge(${id})`);
    throw new Error(`getEdge(${id}) requires flow context after P3 legacy /edges endpoint removal`);
};

/**
 * @deprecated Use upsertFlow() from flows.ts instead. Removal in P3.
 * Create new edge
 * POST /edges/0
 *
 * @deprecated Use createFlowEdge() — POST /flows/{flowId}/edges
 */
export const createEdge = async (body: EdgeBody): Promise<EdgeView> => {
    _log('> createEdge()', body);
    const flowId = requireFlowId(body.flowId);
    const edge = { id: body.id || createClientEdgeId(), ...(body as Partial<EdgeData>) } as EdgeData;
    const result = await upsertFlow(flowId, { nodes: [], edges: [edge] });
    return (result.edges?.find(item => item.id === edge.id) ?? edge) as unknown as EdgeView;
};

/**
 * @deprecated Use upsertFlow() from flows.ts instead. Removal in P3.
 * Update existing edge
 * POST /edges/:id
 *
 * @deprecated Use updateFlowEdge() — PUT /flows/{flowId}/edges/{edgeId}
 */
export const updateEdge = async (id: string, body: EdgeBody): Promise<EdgeView> => {
    _log(`> updateEdge(${id})`, body);
    const flowId = requireFlowId(body.flowId);
    const edge = { id, ...(body as Partial<EdgeData>) } as EdgeData;
    const result = await upsertFlow(flowId, { nodes: [], edges: [edge] });
    return (result.edges?.find(item => item.id === id) ?? edge) as unknown as EdgeView;
};

/**
 * @deprecated Use upsertFlow() with id prefixed '#' for deletion. Removal in P3.
 * Delete edge
 * DELETE /edges/:id
 *
 * @deprecated Use deleteFlowEdge() — DELETE /flows/{flowId}/edges/{edgeId}
 */
export const deleteEdge = async (id: string, flowId?: string): Promise<void> => {
    _log(`> deleteEdge(${id}, flowId=${flowId ?? 'n/a'})`);
    await upsertFlow(requireFlowId(flowId), { nodes: [], edges: [{ id: `#${id}` } as EdgeData] });
};

// Re-export types
export type { EdgeView, EdgeBody } from '../types';
