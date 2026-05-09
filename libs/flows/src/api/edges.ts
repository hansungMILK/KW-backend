import { getFlow, upsertFlow } from './flows';

import type { EdgeBody, EdgeData, EdgeView } from '../types';

const _log = console.log.bind(console, '[edges-api]');

const createClientEdgeId = (): string => `edge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const requireFlowId = (flowId?: string): string => {
    if (!flowId) throw new Error('flowId is required after P3 legacy /edges endpoint removal');
    return flowId;
};

// ============================================================================
// P3 API — edges are persisted through the full flow document
// ============================================================================

/**
 * List edges by flow ID
 * GET /flows/{flowId}
 */
export const listFlowEdges = async (flowId: string): Promise<EdgeView[]> => {
    _log(`> listFlowEdges(${flowId})`);
    const flow = await getFlow(flowId);
    return (flow.edges ?? []) as unknown as EdgeView[];
};

/**
 * Create new edge under a flow
 * PUT /flows/{flowId}
 */
export const createFlowEdge = async (flowId: string, body: EdgeBody): Promise<EdgeView> => {
    _log(`> createFlowEdge(${flowId})`, body);
    const edge = { id: body.id || createClientEdgeId(), ...(body as Partial<EdgeData>) } as EdgeData;
    const result = await upsertFlow(flowId, { nodes: [], edges: [edge] });
    return (result.edges?.find(item => item.id === edge.id) ?? edge) as unknown as EdgeView;
};

/**
 * Get edge by ID within a flow
 * GET /flows/{flowId}
 */
export const getFlowEdge = async (flowId: string, edgeId: string): Promise<EdgeView> => {
    _log(`> getFlowEdge(${flowId}, ${edgeId})`);
    const flow = await getFlow(flowId);
    const edge = (flow.edges ?? []).find(item => item.id === edgeId);
    if (!edge) throw new Error(`Edge not found: ${edgeId}`);
    return edge as unknown as EdgeView;
};

/**
 * Update edge within a flow
 * PUT /flows/{flowId}
 */
export const updateFlowEdge = async (flowId: string, edgeId: string, body: EdgeBody): Promise<EdgeView> => {
    _log(`> updateFlowEdge(${flowId}, ${edgeId})`, body);
    const edge = { id: edgeId, ...(body as Partial<EdgeData>) } as EdgeData;
    const result = await upsertFlow(flowId, { nodes: [], edges: [edge] });
    return (result.edges?.find(item => item.id === edgeId) ?? edge) as unknown as EdgeView;
};

/**
 * Delete edge from a flow
 * PUT /flows/{flowId}
 */
export const deleteFlowEdge = async (flowId: string, edgeId: string): Promise<void> => {
    _log(`> deleteFlowEdge(${flowId}, ${edgeId})`);
    await upsertFlow(flowId, { nodes: [], edges: [{ id: `#${edgeId}` } as EdgeData] });
};

// ============================================================================
// Legacy client helpers backed by PUT /flows/{flowId}
// ============================================================================

/**
 * @deprecated Use GET /flows/{flowId} edges array instead. Removal in P3.
 * List edges by flow ID
 */
export const listEdges = async (flowId: string): Promise<EdgeView[]> => {
    _log(`> listEdges(${flowId})`);
    return listFlowEdges(flowId);
};

/**
 * @deprecated Use upsertFlow() from flows.ts instead. Removal in P3.
 * Get edge by ID
 */
export const getEdge = async (id: string): Promise<EdgeView> => {
    _log(`> getEdge(${id})`);
    throw new Error(`getEdge(${id}) requires flow context after P3 legacy /edges endpoint removal`);
};

/**
 * @deprecated Use upsertFlow() from flows.ts instead. Removal in P3.
 * Create new edge
 */
export const createEdge = async (body: EdgeBody): Promise<EdgeView> => {
    _log('> createEdge()', body);
    return createFlowEdge(requireFlowId(body.flowId), body);
};

/**
 * @deprecated Use upsertFlow() from flows.ts instead. Removal in P3.
 * Update existing edge
 */
export const updateEdge = async (id: string, body: EdgeBody): Promise<EdgeView> => {
    _log(`> updateEdge(${id})`, body);
    return updateFlowEdge(requireFlowId(body.flowId), id, body);
};

/**
 * @deprecated Use upsertFlow() with id prefixed '#' for deletion. Removal in P3.
 * Delete edge
 */
export const deleteEdge = async (id: string, flowId?: string): Promise<void> => {
    _log(`> deleteEdge(${id}, flowId=${flowId ?? 'n/a'})`);
    await deleteFlowEdge(requireFlowId(flowId), id);
};

// Re-export types
export type { EdgeView, EdgeBody } from '../types';
