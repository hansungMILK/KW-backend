import { api } from '@flows/web-core';

import type { RunCreateResponse } from '@flows/contracts';

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
