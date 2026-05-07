import { getFlow, upsertFlow } from './flows';

import type { EdgeBody, EdgeData, EdgeView } from '../types';

const _log = console.log.bind(console, '[edges-api]');

const createClientEdgeId = (): string => `edge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const requireFlowId = (flowId?: string): string => {
    if (!flowId) throw new Error('flowId is required after P3 legacy /edges endpoint removal');
    return flowId;
};

// ============================================================================
// Edge CRUD API
// ============================================================================

/**
 * @deprecated Use GET /flows/{flowId} edges array instead. Removal in P3.
 * List edges by flow ID
 * POST /edges/0/list
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
 */
export const getEdge = async (id: string): Promise<EdgeView> => {
    _log(`> getEdge(${id})`);
    throw new Error(`getEdge(${id}) requires flow context after P3 legacy /edges endpoint removal`);
};

/**
 * @deprecated Use upsertFlow() from flows.ts instead. Removal in P3.
 * Create new edge
 * POST /edges/0
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
 */
export const deleteEdge = async (id: string, flowId?: string): Promise<void> => {
    _log(`> deleteEdge(${id}, flowId=${flowId ?? 'n/a'})`);
    await upsertFlow(requireFlowId(flowId), { nodes: [], edges: [{ id: `#${id}` } as EdgeData] });
};

// Re-export types
export type { EdgeView, EdgeBody } from '../types';
