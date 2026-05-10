import { api } from '@flows/web-core';

const _log = console.log.bind(console, '[runs-api]');

export interface RunView {
    id: string;
    flowId: string;
    status?: string;
    createdAt?: number;
}

/**
 * Start a flow run
 * POST /flows/{flowId}/runs
 *
 * @param flowId - Flow ID to run
 * @returns RunView with run ID and initial status
 */
export const createRun = async (flowId: string): Promise<RunView> => {
    _log(`> createRun(${flowId})`);
    const response = await api.post<RunView>(`/flows/${flowId}/runs`);
    return response.data;
};
