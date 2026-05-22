import { api } from '@flows/web-core';

import type {
    RunCreateResponse,
    RunGetResponse,
    RunListResponse,
    RunNode,
    RunNodesListResponse,
    RunScope,
} from '@flows/contracts';

const _log = console.log.bind(console, '[runs-api]');

export interface RunView {
    id: string;
    flowId: string;
    status: RunCreateResponse['status'];
    createdAt: number;
}

export interface CreateFlowRunOptions {
    executionMode?: 'full' | 'step';
    triggerSource?: string;
    scope?: RunScope;
}

export type FlowRunSummary = RunListResponse['items'][number];

export type RunNodeRecoverResponse = {
    runId: string;
    nodeId: string;
    recoveryAccepted: boolean;
    repairedSourceNodeId: string;
};

/**
 * Start a flow run
 * POST /flows/{flowId}/runs
 *
 */
export const createFlowRun = async (flowId: string, options?: CreateFlowRunOptions): Promise<RunView> => {
    _log(`> createFlowRun(${flowId})`, options);
    const response = await api.post<RunCreateResponse>(`/flows/${flowId}/runs`, options ?? {});
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
 * List recent runs for a flow.
 * GET /flows/{flowId}/runs
 */
export const listFlowRuns = async (flowId: string, limit = 20): Promise<FlowRunSummary[]> => {
    _log(`> listFlowRuns(${flowId})`, { limit });
    const response = await api.get<RunListResponse>(`/flows/${flowId}/runs`, { params: { limit } });
    return response.data.items;
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

/**
 * Recover a failed analysis node by applying quality-review feedback.
 * POST /runs/{runId}/nodes/{nodeId}/recover
 */
export const recoverRunNode = async (
    runId: string,
    nodeId: string,
    reason?: string
): Promise<RunNodeRecoverResponse> => {
    _log(`> recoverRunNode(${runId}, ${nodeId})`, { reason });
    const response = await api.post<RunNodeRecoverResponse>(`/runs/${runId}/nodes/${nodeId}/recover`, {
        ...(reason ? { reason } : {}),
    });
    return response.data;
};
