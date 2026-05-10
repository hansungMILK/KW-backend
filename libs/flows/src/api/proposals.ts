import { api } from '@flows/web-core';

import type { EdgeData, NodeData } from '../types';

const _log = console.log.bind(console, '[proposals-api]');

export interface ProposalApproveResult {
    id: string;
    flowId?: string;
    nodes?: NodeData[];
    edges?: EdgeData[];
}

/**
 * Approve a proposal and apply nodes/edges to canvas
 * POST /proposals/{proposalId}/approve
 *
 * @param proposalId - Proposal ID to approve
 * @returns ProposalApproveResult with nodes and edges to place on canvas
 */
export const approveProposal = async (proposalId: string): Promise<ProposalApproveResult> => {
    _log(`> approveProposal(${proposalId})`);
    const response = await api.post<ProposalApproveResult>(`/proposals/${proposalId}/approve`);
    return response.data;
};
