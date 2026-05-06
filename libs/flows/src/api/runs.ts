import { api } from '@flows/web-core';

import type { RunCreateResponse, RunGetResponse, RunNode, RunNodesListResponse } from '@flows/contracts';

const _log = console.log.bind(console, '[runs-api]');

export interface RunView {
    id: string;
    flowId: string;
    status: RunCreateResponse['status'];
    createdAt: number;
}

/**
 * Start a flow run
 * POST /flows/{flowId}/runs
 *
 */
export const createFlowRun = async (flowId: string): Promise<RunView> => {
    _log(`> createFlowRun(${flowId})`);
    const response = await api.post<RunCreateResponse>(`/flows/${flowId}/runs`);
    return {
        id: response.data.runId,
        flowId: response.data.flowId,
        status: response.data.status,
        createdAt: Date.parse(response.data.createdAt),
    };
};

/**
 * Get a run by ID
 * GET /runs/{runId}
 */
export const getRun = async (runId: string): Promise<RunGetResponse> => {
    _log(`> getRun(${runId})`);
    const response = await api.get<RunGetResponse>(`/runs/${runId}`);
    return response.data;
};

/**
 * Get run node execution snapshots
 * GET /runs/{runId}/nodes
 */
export const getRunNodes = async (runId: string): Promise<RunNode[]> => {
    _log(`> getRunNodes(${runId})`);
    const response = await api.get<RunNodesListResponse>(`/runs/${runId}/nodes`);
    return response.data.items;
};
