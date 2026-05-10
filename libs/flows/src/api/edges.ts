import { api, withRetry } from '@flows/web-core';

import type { ApiListResult, EdgeBody, EdgeView } from '../types';

const _log = console.log.bind(console, '[edges-api]');

// ============================================================================
// Edge CRUD API
// ============================================================================

/**
 * List edges by flow ID
 * POST /edges/0/list
 */
export const listEdges = async (flowId: string): Promise<EdgeView[]> => {
    _log(`> listEdges(${flowId})`);
    const response = await withRetry(
        () => api.post<ApiListResult<EdgeView>>('/edges/0/list', { flowId }),
        3,
        'listEdges'
    );
    return response.data.list || [];
};

/**
 * Get edge by ID
 * GET /edges/:id
 */
export const getEdge = async (id: string): Promise<EdgeView> => {
    _log(`> getEdge(${id})`);
    const response = await api.get<EdgeView>(`/edges/${id}`);
    return response.data;
};

// Re-export types
export type { EdgeView, EdgeBody } from '../types';
