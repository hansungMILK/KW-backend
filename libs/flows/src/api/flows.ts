import { api, withRetry } from '@flows/web-core';

import type {
    DataPacket,
    FlowView,
    LoadFlowResult,
    LogEntry,
    SaveFlowBody,
    SaveFlowView,
    UpdateFlowBody,
} from '../types';

const _log = console.log.bind(console, '[flows-api]');

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
    latestProposalId?: string | null;
    lastRunId?: string | null;
}

const toLoadFlowResult = (flow: SpecFlowDetail): LoadFlowResult => ({
    id: flow.flowId,
    name: flow.title,
    state: flow.status,
    description: flow.description,
    nodes: flow.nodes ?? [],
    edges: flow.edges ?? [],
    ports: [],
    // Execution events are broadcast by flowId, so subscribe to flowId even if
    // old records still carry a separate channelId.
    channelId: flow.flowId,
    createdAt: flow.createdAt,
    updatedAt: flow.updatedAt,
});

const toSaveFlowView = (flow: SpecFlowDetail): SaveFlowView => ({
    id: flow.flowId,
    name: flow.title,
    state: flow.status,
    description: flow.description,
    nodes: flow.nodes ?? [],
    edges: flow.edges ?? [],
    ports: [],
    channelId: flow.flowId,
    createdAt: flow.createdAt,
    updatedAt: flow.updatedAt,
});

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
 * Load flow snapshot (complete state with nodes and edges)
 * GET /flows/{flowId}
 *
 * @see eureka-flows-api #0.26.111
 * @param id - Flow ID to load
 * @throws Error if id is missing or API call fails
 */
export const loadFlow = async (id: string): Promise<LoadFlowResult> => {
    if (!id) {
        throw new Error('Flow ID is required');
    }
    _log(`> loadFlow(${id})`);
    const response = await withRetry(() => api.get<SpecFlowDetail>(`/flows/${id}`), 3, 'loadFlow');
    return toLoadFlowResult(response.data);
};

/**
 * Save flow snapshot (complete state with nodes and edges)
 * PUT /flows/{flowId}
 *
 * @see eureka-flows-api #0.26.111
 * @param id - Flow ID ('0' for create new)
 * @param body - SaveFlowBody { nodes: NodeData[], edges: EdgeData[] }
 * @returns SaveFlowView with the flow ID and saved state
 */
export const saveFlow = async (id: string, body: SaveFlowBody): Promise<SaveFlowView> => {
    _log(`> saveFlow(${id})`, { nodeCount: body.nodes.length, edgeCount: body.edges?.length ?? 0 });
    if (id === '0') {
        const created = await createFlow();
        if (!created.id) throw new Error('Failed to create flow before save');
        return putFlow(created.id, body, created.name);
    }
    return putFlow(id, body);
};

/**
 * Create new flow via POST /flows
 *
 * @param body - Initial flow state (nodes, edges)
 * @returns SaveFlowView with the new flow ID from server
 */
export const createFlow = async (body?: Partial<SaveFlowBody>): Promise<SaveFlowView> => {
    _log('> createFlow() via POST /flows');
    const createResponse = await api.post<SpecFlowSummary>('/flows', { title: 'Untitled Workflow' });
    const created = toCreatedFlowView(createResponse.data);
    if (!created.id) {
        throw new Error('Failed to create flow: no ID returned');
    }
    const saveBody: SaveFlowBody = {
        nodes: body?.nodes ?? [],
        edges: body?.edges ?? [],
    };
    return saveBody.nodes.length > 0 || saveBody.edges.length > 0
        ? putFlow(created.id, saveBody, created.name)
        : created;
};

/**
 * Upsert flow (batch update nodes and edges)
 * PUT /flows/{flowId}
 *
 * Use this for batch operations like:
 * - Moving multiple nodes at once
 * - Bulk node/edge updates
 *
 * @see eureka-flows-api v0.26.212
 * @param id - Flow ID to upsert into
 * @param body - SaveFlowBody { nodes: NodeData[], edges: EdgeData[] }
 * @returns SaveFlowView with updated nodes, edges, ports
 */
export const upsertFlow = async (id: string, body: SaveFlowBody): Promise<SaveFlowView> => {
    if (!id) {
        throw new Error('Flow ID is required');
    }
    _log(`> upsertFlow(${id})`, { nodeCount: body.nodes?.length ?? 0, edgeCount: body.edges?.length ?? 0 });
    return putFlow(id, body);
};

/**
 * Update flow metadata (name, etc.)
 * PUT /flows/{flowId}
 *
 * @see eureka-flows-api v0.26.126
 * @param id - Flow ID to update
 * @param body - UpdateFlowBody { name?: string }
 * @returns FlowView with updated metadata
 */
export const updateFlowMetadata = async (id: string, body: UpdateFlowBody): Promise<FlowView> => {
    if (!id) {
        throw new Error('Flow ID is required');
    }
    _log(`> updateFlowMetadata(${id})`, body);
    const current = await loadFlow(id);
    const saved = await putFlow(id, { nodes: current.nodes, edges: current.edges }, body.name ?? current.name);
    return saved;
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
} from '../types';
