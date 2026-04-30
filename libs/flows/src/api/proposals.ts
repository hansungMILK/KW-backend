import { api } from '@flows/web-core';

import type { NodeData } from '../types';
import type { EdgeData } from '@lemoncloud/eureka-flows-api';
import type { ProposalApproveResponse } from '@flows/contracts';

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
 */
export const approveProposal = async (proposalId: string): Promise<ApproveProposalResult> => {
    _log(`> approveProposal(${proposalId})`);
    const response = await api.post<ProposalApproveResponse>(`/proposals/${proposalId}/approve`);
    return {
        id: response.data.proposal.proposalId,
        flowId: response.data.proposal.flowId,
        nodes: response.data.flow.nodes as NodeData[],
        edges: response.data.flow.edges as EdgeData[],
    };
};
