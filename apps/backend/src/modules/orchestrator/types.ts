/**
 * Orchestrator interface — mock now, real Claude adapter later.
 */

export interface ProposalResult {
    proposedNodes: Record<string, unknown>[];
    proposedEdges: Record<string, unknown>[];
    estimatedCost: {
        currency: string;
        total: number;
        breakdown?: Array<{ blockType: string; amount: number }>;
    };
    metadata?: Record<string, unknown>;
    approvalRequired: boolean;
    assistantMessage: string;
}

export interface Orchestrator {
    generateProposal(
        flowId: string,
        userMessage: string,
        currentContext?: Record<string, unknown>
    ): Promise<ProposalResult>;
}
