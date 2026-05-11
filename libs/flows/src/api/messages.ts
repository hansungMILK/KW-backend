import { api } from '@flows/web-core';

const _log = console.log.bind(console, '[messages-api]');

// ============================================================================
// Request types
// ============================================================================

export interface SendMessageBody {
    /** Agent message text (spec field name: content) */
    content: string;
    currentContext?: Record<string, unknown>;
}

// ============================================================================
// Backend response types (internal — not exported)
// ============================================================================

interface BackendMessage {
    messageId: string;
    flowId?: string;
    role: 'USER' | 'ASSISTANT' | 'SYSTEM';
    messageType: 'TEXT' | 'PROPOSAL' | 'STATUS';
    content: string;
    proposalId?: string;
    createdAt?: number;
}

interface BackendProposedNode {
    type: string;
    label: string;
}

interface BackendProposal {
    proposalId: string;
    flowId?: string;
    status?: string;
    proposedNodes?: BackendProposedNode[];
    estimatedCost?: { currency?: string; total?: number; breakdown?: unknown };
    approvalRequired?: boolean;
}

interface BackendSendMessageResponse {
    message?: BackendMessage;
    proposal?: BackendProposal;
    assistantMessage?: BackendMessage;
}

// ============================================================================
// Public types
// ============================================================================

export interface MessageProposalBlock {
    type: string;
    label: string;
}

export interface MessageProposal {
    /** proposalId from backend */
    id: string;
    blocks: MessageProposalBlock[];
    /** Formatted as "$0.00" */
    estimatedCost?: string;
}

export interface MessageView {
    id: string;
    flowId?: string;
    /** Agent reply text (from assistantMessage.content) */
    message?: string;
    role: 'user' | 'agent';
    createdAt?: number;
    proposal?: MessageProposal;
}

export interface GetMessagesResult {
    items: MessageView[];
    nextCursor?: string | null;
}

// ============================================================================
// API functions
// ============================================================================

/**
 * Send a message to the flow agent
 * POST /flows/{flowId}/messages
 *
 * Transforms backend response:
 * - assistantMessage.content → message
 * - proposal.proposedNodes → proposal.blocks
 * - proposal.estimatedCost.total → "$X.XX" string
 *
 * Returns null if no assistantMessage in response.
 */
/** @deprecated use sendFlowMessage */
export const sendMessage = async (flowId: string, body: SendMessageBody): Promise<MessageView | null> => {
    _log(`> sendMessage(${flowId})`, body);
    const response = await api.post<BackendSendMessageResponse>(`/flows/${flowId}/messages`, body);
    const { message, proposal, assistantMessage } = response.data;

    const agentMsg = assistantMessage ?? message;
    if (!agentMsg) return null;

    const result: MessageView = {
        id: agentMsg.messageId,
        flowId: agentMsg.flowId,
        message: (assistantMessage ?? message)?.content,
        role: 'agent',
        createdAt: agentMsg.createdAt,
    };

    if (proposal) {
        const costTotal = proposal.estimatedCost?.total;
        result.proposal = {
            id: proposal.proposalId,
            blocks: (proposal.proposedNodes ?? []).map(n => ({ type: n.type, label: n.label })),
            estimatedCost: costTotal !== undefined ? `$${costTotal.toFixed(2)}` : undefined,
        };
    }

    return result;
};

/** Spec-named alias for sendMessage */
export const sendFlowMessage = sendMessage;

/**
 * Get message history for a flow
 * GET /flows/{flowId}/messages
 */
export const getFlowMessages = async (flowId: string, limit = 50): Promise<GetMessagesResult> => {
    _log(`> getFlowMessages(${flowId}, limit=${limit})`);
    const response = await api.get<{
        items: BackendMessage[];
        nextCursor?: string | null;
    }>(`/flows/${flowId}/messages`, { params: { limit } });

    const items: MessageView[] = (response.data.items ?? []).map(m => ({
        id: m.messageId,
        flowId: m.flowId,
        message: m.content,
        role: m.role === 'USER' ? 'user' : 'agent',
        createdAt: m.createdAt ? Date.parse(String(m.createdAt)) : undefined,
    }));

    return { items, nextCursor: response.data.nextCursor };
};
