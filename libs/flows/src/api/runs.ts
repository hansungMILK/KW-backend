// TODO: import api from '@flows/web-core' when backend is ready
const _log = console.log.bind(console, '[runs-api]');

export interface RunView {
    id: string;
    flowId: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    createdAt: number;
}

/**
 * Start a flow run
 * POST /flows/{flowId}/runs
 *
 * TODO: backend not ready — replace mock with real call:
 * const response = await api.post<RunView>(`/flows/${flowId}/runs`);
 * return response.data;
 */
export const createFlowRun = async (flowId: string): Promise<RunView> => {
    _log(`> createFlowRun(${flowId})`);
    return Promise.resolve({
        id: crypto.randomUUID(),
        flowId,
        status: 'pending',
        createdAt: Date.now(),
    });
};
