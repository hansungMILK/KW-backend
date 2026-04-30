// TODO: import api from '@flows/web-core' when backend is ready
import type { NodeData } from '../types';
import type { EdgeData } from '@lemoncloud/eureka-flows-api';

const _log = console.log.bind(console, '[proposals-api]');

export interface ApproveProposalResult {
    id: string;
    flowId: string;
    nodes: NodeData[];
    edges: EdgeData[];
}

/**
 * Approve a flow proposal — places nodes/edges onto the canvas
 * POST /proposals/{proposalId}/approve
 *
 * TODO: backend not ready — replace mock with real call:
 * const response = await api.post<ApproveProposalResult>(`/proposals/${proposalId}/approve`);
 * return response.data;
 */
export const approveProposal = async (proposalId: string): Promise<ApproveProposalResult> => {
    _log(`> approveProposal(${proposalId})`);
    return Promise.resolve({
        id: proposalId,
        flowId: '',
        nodes: [],
        edges: [],
    });
};
