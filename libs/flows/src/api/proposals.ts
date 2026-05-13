import { api } from '@flows/web-core';

import { normalizeNodeList } from './normalizers';

import type { EdgeData, NodeData } from '../types';
import type { ProposalApproveRequest, ProposalApproveResponse } from '@flows/contracts';

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
export const approveProposal = async (
    proposalId: string,
    body?: Partial<ProposalApproveRequest>
): Promise<ApproveProposalResult> => {
    _log(`> approveProposal(${proposalId})`);
    const response = await api.post<ProposalApproveResponse>(`/proposals/${proposalId}/approve`, body ?? {});
    return {
        id: response.data.proposal.proposalId,
        flowId: response.data.proposal.flowId,
        nodes: normalizeNodeList(response.data.flow.nodes),
        edges: response.data.flow.edges as unknown as EdgeData[],
    };
};
