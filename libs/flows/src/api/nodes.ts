import { API_URL, api } from '@flows/web-core';

import { getFlow, upsertFlow } from './flows';

import type {
    DataPacket,
    EdgeData,
    NodeBody,
    NodeData,
    NodeView,
    PortData,
    PortDataResponse,
    S3ImageInfo,
    UpsertNodeResult,
} from '../types';

const _log = console.log.bind(console, '[nodes-api]');

const createClientNodeId = (): string => `node_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const parsePortRef = (portId: string, direction: 'in' | 'out'): { nodeId: string; portName: string } => {
    const [nodeId, rawPortName] = portId.split(':', 2);
    const portName = rawPortName?.split('@')[0] || direction;
    return { nodeId: nodeId || portId, portName };
};

const toDataPacket = (raw: unknown): PortDataResponse['data'] | null => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const data = raw as Record<string, unknown>;
    const timestamp = typeof data['timestamp'] === 'number' ? data['timestamp'] : undefined;

    if ('value' in data && typeof data['type'] === 'string') {
        return { value: data['value'], type: data['type'], timestamp };
    }
    if ('S' in data) return { value: String(data['S'] ?? ''), type: 'text', timestamp };
    if ('N' in data) return { value: Number(data['N']), type: 'number', timestamp };
    if ('F' in data) return { value: Number(data['F']), type: 'number', timestamp };
    if ('M' in data) {
        const value = data['M'];
        if (typeof value !== 'string') return { value, type: 'json', timestamp };
        try {
            return { value: JSON.parse(value), type: 'json', timestamp };
        } catch {
            return { value, type: 'json', timestamp };
        }
    }
    return null;
};

/**
 * Body for POST /flows/{flowId}/nodes/{nodeId}/runs.
 */
export interface RunNodeBody {
    /** Config to override during execution (not saved to node) */
    config?: Record<string, unknown>;
    /** Output data from frontend execution (for isFrontend nodes) */
    output?: Record<string, DataPacket>;
}

const getAssetBaseUrl = (): string => {
    const runtimeWindow =
        typeof window !== 'undefined' ? (window as typeof window & { VITE_ASSET_BASE_URL?: string }) : undefined;
    const configured = runtimeWindow?.VITE_ASSET_BASE_URL;
    if (configured) return configured.replace(/\/+$/, '');

    const apiUrl = API_URL.replace(/\/+$/, '');
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(apiUrl)) {
        return `${apiUrl}/_local-assets`;
    }

    throw new Error('VITE_ASSET_BASE_URL is required to display legacy s3:// image URLs');
};

const keyFromS3Url = (s3Url: string): string => s3Url.replace(/^s3:\/\/[^/]+\//, '');

const encodeAssetPath = (key: string): string => key.split('/').map(encodeURIComponent).join('/');

/**
 * @deprecated Use GET /flows/{flowId} nodes array instead. The legacy endpoint was removed in P3.
 * List nodes by flow ID
 */
export const listNodes = async (flowId: string): Promise<NodeView[]> => {
    _log(`> listNodes(${flowId})`);
    const flow = await getFlow(flowId);
    return (flow.nodes ?? []) as unknown as NodeView[];
};

/**
 * Get node by ID
 * Requires flow context after P3 legacy endpoint removal.
 */
export const getNode = async (id: string): Promise<NodeView> => {
    _log(`> getNode(${id})`);
    throw new Error(`getNode(${id}) requires flow context after P3 legacy endpoint removal`);
};

/**
 * Get port data by port ID
 *
 * Used for real-time port data synchronization via WebSocket.
 * When a port update notification is received, this fetches the latest port data.
 *
 * @param portId - Port ID (e.g., "1000637:in" or "1000637:out")
 * @param direction - Port direction ('in' or 'out')
 * @returns PortDataResponse with port data
 */
export const getPortData = async (
    portId: string,
    direction: 'in' | 'out',
    flowId?: string
): Promise<PortDataResponse> => {
    _log(`> getPortData(${portId}, direction=${direction}, flowId=${flowId ?? 'n/a'})`);
    if (!flowId) throw new Error('flowId is required to read port data after P3 legacy endpoint removal');

    const { nodeId, portName } = parsePortRef(portId, direction);
    const flow = await getFlow(flowId);
    const port = flow.ports?.find(item => item.id === portId || (item.nodeId === nodeId && item.portId === portName));
    if (port?.data) {
        return { id: port.id, nodeId: port.nodeId, portId: port.portId, direction, data: port.data };
    }

    const portNode = (flow.nodes ?? []).find(node => {
        const record = node as unknown as Record<string, unknown>;
        return (
            record['stereo'] === 'port' &&
            record['parentId'] === nodeId &&
            record['direction'] === direction &&
            record['name'] === portName
        );
    }) as unknown as Record<string, unknown> | undefined;

    const data = toDataPacket(
        portNode?.['data$'] ?? (portNode?.['data'] as Record<string, unknown> | undefined)?.['data$']
    );
    if (!data) throw new Error(`Port data not found: ${portId}`);

    return {
        id: portId,
        nodeId,
        portId: portName,
        direction,
        data,
    };
};

/**
 * @deprecated Use upsertFlow() from flows.ts instead. The legacy endpoint was removed in P3.
 * Create new node
 *
 * Required fields: name, flowId, blockId
 */
export const createNode = async (body: NodeBody): Promise<NodeView> => {
    _log('> createNode()', body);

    if (!body.name) throw new Error('Node name is required');
    if (!body.flowId) throw new Error('Node flowId is required');
    if (!body.blockId) throw new Error('Node blockId is required');

    const flowId = body.flowId;
    const node = { id: createClientNodeId(), ...(body as unknown as Partial<NodeView>) } as unknown as NodeData;
    const result = await upsertFlow(flowId, { nodes: [node], edges: [] });
    return (result.nodes?.find(item => item.id === node.id) ?? node) as unknown as NodeView;
};

/**
 * @deprecated Use upsertFlow() from flows.ts for canvas saves. The legacy endpoint was removed in P3.
 * Upsert node (create or update)
 *
 * - id="0" → create new node with a client-generated ID
 * - id=<nodeId> → update existing node
 *
 * @param id - Node ID or "0" for auto-assign
 * @param flowId - Flow ID (required)
 * @param body - Node data: { config, output, blockId, position, ... }
 * @returns NodeData with server-assigned or existing ID
 */
export const upsertNode = async (id: string, flowId: string, body: Partial<NodeView>): Promise<UpsertNodeResult> => {
    _log(`> upsertNode(${id}, flowId=${flowId})`, body);
    const nodeId = id === '0' ? createClientNodeId() : id;
    const node = { id: nodeId, ...(body as unknown as Partial<NodeData>) } as NodeData;
    const result = await upsertFlow(flowId, { nodes: [node], edges: [] });
    return {
        nodes: [node, ...(result.nodes ?? []).filter(item => item.id !== nodeId)],
        edges: result.edges,
    };
};

/**
 * @deprecated Use upsertFlow() from flows.ts instead for edge operations
 * Edge creation should use PUT /flows/{flowId} with the full canvas graph.
 */
export const upsertEdge = async (flowId: string, edge: EdgeData): Promise<UpsertNodeResult> => {
    console.warn('[DEPRECATED] upsertEdge() is deprecated. Use upsertFlow() for edge operations.');
    _log(`> upsertEdge(flowId=${flowId})`, edge);
    const result = await upsertFlow(flowId, { nodes: [], edges: [edge] });
    return { nodes: result.nodes ?? [], edges: result.edges ?? [] };
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
    const node = {
        id: `port_${body.parentId}_${body.direction}_${body.name}`,
        ...body,
    } as unknown as NodeData;
    const result = await upsertFlow(flowId, { nodes: [node], edges: [] });
    return { nodes: [node], edges: result.edges ?? [] };
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
 */
export const deleteNode = async (id: string, flowId?: string): Promise<void> => {
    _log(`> deleteNode(${id}, flowId=${flowId ?? 'n/a'})`);
    if (!flowId) throw new Error('flowId is required after P3 legacy /nodes endpoint removal');
    await upsertFlow(flowId, { nodes: [{ id: `#${id}` } as NodeData], edges: [] });
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
 * POST /flows/{flowId}/nodes/{nodeId}/runs
 *
 * Executes the node's processor with current inputs and config.
 * Supports async execution via SQS queue.
 *
 * @param nodeId - Node ID to execute
 * @param body - Request body
 * @param body.config - Config to override (not saved)
 * @param body.output - Output data from frontend execution (for isFrontend nodes)
 * @param options - Execution options
 * @param options.async - If true, queues execution and returns immediately
 * @param options.force - If true, forces execution even for isFrontend nodes
 * @param options.propagate - If true, propagates to downstream nodes (default: true)
 */
export const runNode = async (
    flowId: string,
    nodeId: string,
    body?: RunNodeBody,
    options?: RunNodeOptions
): Promise<NodeView> => {
    _log(`> runNode(${flowId}, ${nodeId})`, { body, options });
    try {
        const response = await api.post<{ runId: string; status: string }>(`/flows/${flowId}/nodes/${nodeId}/runs`, {
            triggerSource: 'MANUAL',
            config: body?.config,
            output: body?.output,
            async: options?.async,
        });
        return { id: nodeId, state: 'RUNNING', status: response.data.status } as unknown as NodeView;
    } catch (err) {
        _log('> runNode error:', err);
        throw err;
    }
};

/**
 * Resolve an S3 URL to the current asset public URL.
 *
 * @param s3Url - S3 reference (s3://bucket/key)
 * @returns Public URL for browser display
 */
export const getImageFromS3 = async (s3Url: string): Promise<string> => {
    if (!s3Url || !s3Url.startsWith('s3://')) {
        throw new Error('Invalid S3 URL');
    }
    _log(`> getImageFromS3(${s3Url})`);
    return `${getAssetBaseUrl()}/${encodeAssetPath(keyFromS3Url(s3Url))}`;
};

/**
 * Get S3 image info (metadata only) without calling removed legacy /nodes endpoints.
 * Size/hash are unknown on the client; the UI uses this only for safe parsing.
 *
 * @param s3Url - S3 reference (s3://bucket/key)
 * @returns S3ImageInfo with parsed URL data
 */
export const getImageInfo = async (s3Url: string): Promise<S3ImageInfo> => {
    if (!s3Url || !s3Url.startsWith('s3://')) {
        throw new Error('Invalid S3 URL');
    }
    _log(`> getImageInfo(${s3Url})`);
    const key = keyFromS3Url(s3Url);
    const ext = key.includes('.') ? key.slice(key.lastIndexOf('.') + 1).toLowerCase() : '';
    return {
        s3Url,
        parsed: {
            bucket: s3Url.replace(/^s3:\/\//, '').split('/')[0] ?? '',
            key,
            md5: '',
            sizeKb: 0,
            ext,
            prefix: key.includes('/') ? key.slice(0, key.lastIndexOf('/')) : undefined,
        },
        allowed: true,
    };
};

/**
 * Body for development-only canvas touch updates.
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
 *
 * Updates node metadata for testing purposes.
 * Only available in development environment.
 *
 * @param nodeId - Node ID to touch
 * @param body - Touch body with optional fields
 * @returns Updated NodeView
 */
export const touchNode = async (
    flowId: string,
    nodeId: string,
    body: TouchNodeBody,
    options: { target?: 'node' | 'edge' } = {}
): Promise<NodeView> => {
    _log(`> touchNode(flowId=${flowId}, nodeId=${nodeId})`, body);
    if (!flowId) throw new Error('flowId is required to touch canvas data after P3 legacy endpoint removal');

    if (options.target === 'edge') {
        const edgePatch: EdgeData = {
            id: nodeId,
            ...('position' in body && body.position ? { position: body.position } : {}),
            ...('disabled' in body && body.disabled !== undefined ? { disabled: body.disabled } : {}),
            ...('name' in body && body.name ? { label: body.name } : {}),
        } as EdgeData;
        await upsertFlow(flowId, { nodes: [], edges: [edgePatch] });
        return edgePatch as unknown as NodeView;
    }

    const nodePatch: NodeData = { id: nodeId, ...(body as Partial<NodeData>) } as NodeData;
    const result = await upsertFlow(flowId, { nodes: [nodePatch], edges: [] });
    return (result.nodes?.find(item => item.id === nodeId) ?? nodePatch) as unknown as NodeView;
};
