import { api } from '@flows/web-core';

const _log = console.log.bind(console, '[runs-api]');

// ============================================================================
// Types
// ============================================================================

export interface RunView {
    runId: string;
    flowId: string;
    status?: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | string;
    runType?: 'FULL_FLOW' | 'SINGLE_NODE' | string;
    triggerSource?: string;
    executionMode?: 'full' | 'step';
    createdAt?: number;
    startedAt?: number;
    completedAt?: number;
}

export interface RunNode {
    runId: string;
    nodeId: string;
    blockType?: string;
    label?: string;
    status?: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED' | 'CANCELLED' | string;
    inputPayload?: unknown;
    outputPayload?: unknown;
    progress?: number;
    retryCount?: number;
    parentNodeIds?: string[];
    errorCode?: string;
    errorMessage?: string;
    startedAt?: string;
    completedAt?: string;
    updatedAt?: string;
}

// ============================================================================
// API functions
// ============================================================================

/**
 * Start a flow run
 * POST /flows/{flowId}/runs
 *
 * Returns immediately with status QUEUED; execution is async via SQS worker.
 */
export const createFlowRun = async (flowId: string): Promise<RunView> => {
    _log(`> createFlowRun(${flowId})`);
    const response = await api.post<RunView>(`/flows/${flowId}/runs`);
    return response.data;
};

/** @deprecated Use createFlowRun instead */
export const createRun = createFlowRun;

/**
 * Get run details
 * GET /runs/{runId}
 */
export const getRun = async (runId: string): Promise<RunView> => {
    _log(`> getRun(${runId})`);
    const response = await api.get<RunView>(`/runs/${runId}`);
    return response.data;
};

/**
 * Get run node results
 * GET /runs/{runId}/nodes
 */
export const getRunNodes = async (runId: string): Promise<RunNode[]> => {
    _log(`> getRunNodes(${runId})`);
    const response = await api.get<{ items: RunNode[] }>(`/runs/${runId}/nodes`);
    return response.data.items ?? [];
};
