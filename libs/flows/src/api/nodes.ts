import { api, withRetry } from '@flows/web-core';

import type {
    ApiListResult,
    DataPacket,
    NodeBody,
    NodeView,
    PortData,
    PortDataResponse,
    S3ImageInfo,
    UpsertNodeResult,
} from '../types';
import type { EdgeData } from '@lemoncloud/eureka-flows-api';

const _log = console.log.bind(console, '[nodes-api]');

// ============================================================================
// Spec v2 API — /flows/{flowId}/nodes/* 명세 기준 경로
// ============================================================================

/**
 * List nodes by flow ID
 * GET /flows/{flowId}/nodes
 */
export const listFlowNodes = async (flowId: string): Promise<NodeView[]> => {
    _log(`> listFlowNodes(${flowId})`);
    const response = await withRetry(
        () => api.get<ApiListResult<NodeView>>(`/flows/${flowId}/nodes`),
        3,
        'listFlowNodes'
    );
    return response.data.list || [];
};

/**
 * Create node under a flow
 * POST /flows/{flowId}/nodes
 */
export const createFlowNode = async (flowId: string, body: NodeBody): Promise<NodeView> => {
    _log(`> createFlowNode(${flowId})`, body);
    if (!body.name) throw new Error('Node name is required');
    if (!body.blockId) throw new Error('Node blockId is required');
    const response = await api.post<NodeView>(`/flows/${flowId}/nodes`, body);
    return response.data;
};

/**
 * Get node by ID within a flow
 * GET /flows/{flowId}/nodes/{nodeId}
 */
export const getFlowNode = async (flowId: string, nodeId: string): Promise<NodeView> => {
    _log(`> getFlowNode(${flowId}, ${nodeId})`);
    const response = await api.get<NodeView>(`/flows/${flowId}/nodes/${nodeId}`);
    return response.data;
};

/**
 * Update node within a flow
 * PUT /flows/{flowId}/nodes/{nodeId}
 */
export const updateFlowNode = async (
    flowId: string,
    nodeId: string,
    body: Partial<NodeView>
): Promise<UpsertNodeResult> => {
    _log(`> updateFlowNode(${flowId}, ${nodeId})`, body);
    const response = await api.put<UpsertNodeResult>(`/flows/${flowId}/nodes/${nodeId}`, body);
    return response.data;
};

/**
 * Delete node from a flow
 * DELETE /flows/{flowId}/nodes/{nodeId}
 */
export const deleteFlowNode = async (flowId: string, nodeId: string): Promise<void> => {
    _log(`> deleteFlowNode(${flowId}, ${nodeId})`);
    await api.delete(`/flows/${flowId}/nodes/${nodeId}`);
};

/**
 * Get port data for a node
 * GET /flows/{flowId}/nodes/{nodeId}/port?direction=in|out
 */
export const getFlowNodePort = async (
    flowId: string,
    nodeId: string,
    direction: 'in' | 'out'
): Promise<PortDataResponse> => {
    _log(`> getFlowNodePort(${flowId}, ${nodeId}, direction=${direction})`);
    const response = await api.get<PortDataResponse>(`/flows/${flowId}/nodes/${nodeId}/port`, {
        params: { direction },
    });
    return response.data;
};

/**
 * Run a single node within a flow
 * POST /flows/{flowId}/nodes/{nodeId}/runs
 */
export const runFlowNode = async (
    flowId: string,
    nodeId: string,
    body?: RunNodeBody,
    options?: RunNodeOptions
): Promise<NodeView> => {
    _log(`> runFlowNode(${flowId}, ${nodeId})`, { body, options });
    const queryParams: string[] = [];
    if (options?.async) queryParams.push('async');
    if (options?.force) queryParams.push('force');
    if (options?.propagate === false) queryParams.push('propagate=0');
    const params = queryParams.length > 0 ? `?${queryParams.join('&')}` : '';
    const response = await api.post<NodeView>(`/flows/${flowId}/nodes/${nodeId}/runs${params}`, body || {});
    return response.data;
};

/**
 * Body for POST /nodes/:id/run
 * @see eureka-flows-api #0.26.212
 */
export interface RunNodeBody {
    /** Config to override during execution (not saved to node) */
    config?: Record<string, string>;
    /** Output data from frontend execution (for isFrontend nodes) */
    output?: Record<string, DataPacket>;
}

// ============================================================================
// Legacy API — Phase 3에서 제거 예정 (프론트 캔버스가 아직 의존 중)
// ============================================================================

/**
 * List nodes by flow ID
 * POST /nodes/0/list
 *
 * @deprecated Use listFlowNodes() — GET /flows/{flowId}/nodes
 */
export const listNodes = async (flowId: string): Promise<NodeView[]> => {
    _log(`> listNodes(${flowId})`);
    const response = await withRetry(
        () => api.post<ApiListResult<NodeView>>('/nodes/0/list', { flowId }),
        3,
        'listNodes'
    );
    return response.data.list || [];
};

/**
 * Get node by ID
 * GET /nodes/:id
 *
 * @deprecated Use getFlowNode() — GET /flows/{flowId}/nodes/{nodeId}
 */
export const getNode = async (id: string): Promise<NodeView> => {
    _log(`> getNode(${id})`);
    const response = await api.get<NodeView>(`/nodes/${id}`);
    return response.data;
};

/**
 * Get port data by port ID
 * GET /nodes/:portId/port?direction=in|out
 *
 * @deprecated Use getFlowNodePort() — GET /flows/{flowId}/nodes/{nodeId}/port
 */
export const getPortData = async (portId: string, direction: 'in' | 'out'): Promise<PortDataResponse> => {
    _log(`> getPortData(${portId}, direction=${direction})`);
    const response = await api.get<PortDataResponse>(`/nodes/${portId}/port`, { params: { direction } });
    return response.data;
};

/**
 * Create new node
 * POST /nodes/0
 *
 * Required fields: name, flowId, blockId
 * @deprecated Use createFlowNode() — POST /flows/{flowId}/nodes
 */
export const createNode = async (body: NodeBody): Promise<NodeView> => {
    _log('> createNode()', body);

    if (!body.name) throw new Error('Node name is required');
    if (!body.flowId) throw new Error('Node flowId is required');
    if (!body.blockId) throw new Error('Node blockId is required');

    const response = await api.post<NodeView>('/nodes/0', body);
    return response.data;
};

/**
 * Upsert node (create or update)
 * POST /nodes/:id/upsert?flowId=<flowId>
 *
 * @deprecated Use updateFlowNode() — PUT /flows/{flowId}/nodes/{nodeId}
 */
export const upsertNode = async (id: string, flowId: string, body: Partial<NodeView>): Promise<UpsertNodeResult> => {
    _log(`> upsertNode(${id}, flowId=${flowId})`, body);
    // Send body directly - server expects { config?, output?, ...nodeFields }
    // NOT wrapped in { nodes: [...] } format
    const response = await api.post<UpsertNodeResult>(`/nodes/${id}/upsert`, body, { params: { flowId } });
    return response.data;
};

/**
 * @deprecated Use upsertFlow() from flows.ts instead for edge operations
 * Edge creation should use POST /flows/:id/upsert with { nodes: [], edges: [...] }
 *
 * This function incorrectly calls /nodes/0/upsert which only supports { config, output } body format.
 */
export const upsertEdge = async (flowId: string, edge: EdgeData): Promise<UpsertNodeResult> => {
    console.warn('[DEPRECATED] upsertEdge() is deprecated. Use upsertFlow() for edge operations.');
    _log(`> upsertEdge(flowId=${flowId})`, edge);
    // This is incorrect - /nodes/:id/upsert only supports { config, output } format
    // Edge operations should use POST /flows/:id/upsert with { nodes: [], edges: [...] }
    const body = { edges: [edge] };
    const response = await api.post<UpsertNodeResult>('/nodes/0/upsert', body, { params: { flowId } });
    return response.data;
};

/**
 * Body for upserting a port node
 */
export interface PortNodeBody {
    stereo: 'port';
    parentId: string;
    direction: 'in' | 'out';
    name: string;
    dataType?: string;
    data$?: PortData;
}

/**
 * Upsert port node (save input/output port data)
 * POST /nodes/0/upsert?flowId=<flowId>
 *
 * Used to save port data before node execution.
 * Server's hydrateInputs() reads from these port nodes.
 *
 * @param flowId - Flow ID (required)
 * @param body - Port node data
 * @returns UpsertNodeResult
 */
export const upsertPortNode = async (flowId: string, body: PortNodeBody): Promise<UpsertNodeResult> => {
    _log(`> upsertPortNode(flowId=${flowId})`, body);
    const requestBody = { nodes: [body] };
    const response = await api.post<UpsertNodeResult>('/nodes/0/upsert', requestBody, { params: { flowId } });
    return response.data;
};

/**
 * Convert DataPacket to PortData format
 * @param packet - Frontend DataPacket format
 * @returns Server PortData format (S, N, M fields)
 */
export const toPortData = (packet: DataPacket): PortData => {
    const { value, type, timestamp } = packet;
    const base: PortData = {};
    if (timestamp) base.timestamp = timestamp;

    switch (type) {
        case 'text':
        case 'image':
            return { ...base, S: String(value) };
        case 'number':
            return { ...base, N: Number(value) };
        case 'json':
        case 'any':
        default:
            return { ...base, M: JSON.stringify(value) };
    }
};

/**
 * Delete node
 * DELETE /nodes/:id
 *
 * @deprecated Use deleteFlowNode() — DELETE /flows/{flowId}/nodes/{nodeId}
 */
export const deleteNode = async (id: string): Promise<void> => {
    _log(`> deleteNode(${id})`);
    await api.delete(`/nodes/${id}`);
};

/**
 * Run node execution options
 */
export interface RunNodeOptions {
    /** If true, queues execution via SQS and returns immediately */
    async?: boolean;
    /** If true, forces execution even if node is busy or isFrontend */
    force?: boolean;
    /** If true, propagates to downstream nodes after execution (default: true) */
    propagate?: boolean;
}

/**
 * Run node execution
 * POST /nodes/:nodeId/run
 *
 * @deprecated Use runFlowNode() — POST /flows/{flowId}/nodes/{nodeId}/runs
 */
export const runNode = async (nodeId: string, body?: RunNodeBody, options?: RunNodeOptions): Promise<NodeView> => {
    _log(`> runNode(${nodeId})`, { body, options });
    try {
        // Build query params
        const queryParams: string[] = [];
        if (options?.async) queryParams.push('async');
        if (options?.force) queryParams.push('force');
        if (options?.propagate === false) queryParams.push('propagate=0');

        const params = queryParams.length > 0 ? `?${queryParams.join('&')}` : '';
        const response = await api.post<NodeView>(`/nodes/${nodeId}/run${params}`, body || {});
        return response.data;
    } catch (err) {
        _log('> runNode error:', err);
        throw err;
    }
};

/**
 * Get image from S3 URL
 * GET /nodes/0/image?s3Url=...
 *
 * Fetches image binary from S3 via proxy endpoint.
 * Returns base64 data URL for direct use in <img> src.
 *
 * @see eureka-flows-api v0.26.126
 * @param s3Url - S3 reference (s3://bucket/key)
 * @returns Data URL (data:image/...;base64,...)
 */
export const getImageFromS3 = async (s3Url: string): Promise<string> => {
    if (!s3Url || !s3Url.startsWith('s3://')) {
        throw new Error('Invalid S3 URL');
    }
    _log(`> getImageFromS3(${s3Url})`);

    const response = await api.get<{ body: string; headers: { 'Content-Type': string } }>('/nodes/0/image', {
        params: { s3Url },
    });

    const contentType = response.data.headers?.['Content-Type'] || 'image/png';
    const base64Body = response.data.body;

    return `data:${contentType};base64,${base64Body}`;
};

/**
 * Get S3 image info (metadata only)
 * GET /nodes/0/image-info?s3Url=...
 *
 * Returns parsed S3 URL information without fetching the image.
 *
 * @see eureka-flows-api v0.26.126
 * @param s3Url - S3 reference (s3://bucket/key)
 * @returns S3ImageInfo with parsed URL data
 */
export const getImageInfo = async (s3Url: string): Promise<S3ImageInfo> => {
    if (!s3Url || !s3Url.startsWith('s3://')) {
        throw new Error('Invalid S3 URL');
    }
    _log(`> getImageInfo(${s3Url})`);

    const response = await api.get<S3ImageInfo>('/nodes/0/image-info', {
        params: { s3Url },
    });

    return response.data;
};

/**
 * Body for POST /nodes/:id/touch
 * Debug/test endpoint to update node metadata
 */
export interface TouchNodeBody {
    timestamp?: string;
    progress?: number;
    disabled?: boolean;
    required?: boolean;
    modifiedAt?: string;
    enterNo?: number;
    exitNo?: number;
    position?: { x: number; y: number };
    name?: string;
    width?: number;
    height?: number;
}

/**
 * Touch node (debug/test endpoint)
 * POST /nodes/:id/touch
 *
 * Updates node metadata for testing purposes.
 * Only available in development environment.
 *
 * @param nodeId - Node ID to touch
 * @param body - Touch body with optional fields
 * @returns Updated NodeView
 */
export const touchNode = async (nodeId: string, body: TouchNodeBody): Promise<NodeView> => {
    _log(`> touchNode(${nodeId})`, body);
    const response = await api.post<NodeView>(`/nodes/${nodeId}/touch`, body);
    return response.data;
};
