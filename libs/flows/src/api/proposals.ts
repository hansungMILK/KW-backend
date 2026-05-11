import { api } from '@flows/web-core';

import type { EdgeData, NodeData } from '../types';

const _log = console.log.bind(console, '[proposals-api]');

// ============================================================================
// Backend response types (internal)
// ============================================================================

interface BackendProposalApproveResponse {
    proposal: {
        proposalId: string;
        flowId?: string;
        status: 'APPROVED';
        proposedNodes?: unknown[];
        proposedEdges?: unknown[];
    };
    flow: {
        id: string;
        name?: string;
        state?: string;
        nodes: NodeData[];
        edges: EdgeData[];
        updatedAt?: string;
    };
}

// ============================================================================
// Public types
// ============================================================================

export interface ProposalApproveResult {
    /** proposalId from backend */
    id: string;
    flowId?: string;
    /** Nodes to place on canvas (from flow.nodes) */
    nodes?: NodeData[];
    /** Edges to place on canvas (from flow.edges) */
    edges?: EdgeData[];
}

// ============================================================================
// API functions
// ============================================================================

/**
 * Approve a proposal and apply nodes/edges to canvas
 * POST /proposals/{proposalId}/approve
 *
 * Backend response: { proposal: Proposal(APPROVED), flow: { id, nodes[], edges[] } }
 * Returns normalized ProposalApproveResult with nodes/edges for canvas.
 */
export const approveProposal = async (proposalId: string): Promise<ProposalApproveResult> => {
    _log(`> approveProposal(${proposalId})`);
    const response = await api.post<BackendProposalApproveResponse>(`/proposals/${proposalId}/approve`);
    const { proposal, flow } = response.data;
    return {
        id: proposal.proposalId,
        flowId: proposal.flowId,
        nodes: flow.nodes,
        edges: flow.edges,
    };
};
