import { api } from '@flows/web-core';

import type { MessageCreateResponse, MessageListResponse } from '@flows/contracts';

const _log = console.log.bind(console, '[messages-api]');

export interface SendMessageBody {
    content: string;
    currentContext?: Record<string, unknown>;
}

export interface ProposalBlock {
    type: string;
    label: string;
    position?: { x: number; y: number };
}

export interface MessageProposal {
    id: string;
    blocks: ProposalBlock[];
    edges?: Array<{ source: string; target: string }>;
    estimatedCost?: string;
    estimatedCostUsd?: number;
    maxRunEstimatedCostUsd?: number;
    metadata?: Record<string, unknown>;
    description?: string;
}

export interface MessageView {
    id: string;
    flowId: string;
    role: 'user' | 'agent';
    content: string;
    proposal?: MessageProposal;
    createdAt: number;
}

const asRecord = (value: unknown): Record<string, unknown> =>
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const formatEstimatedCost = (cost: { currency: string; total: number } | undefined): string | undefined => {
    if (!cost) return undefined;
    const currency = cost.currency === 'USD' ? '$' : `${cost.currency} `;
    return `${currency}${cost.total.toFixed(2)}`;
};

const toProposalBlock = (node: unknown, index: number): ProposalBlock => {
    const item = asRecord(node);
    const type = String(item.blockType ?? item.type ?? item.blockId ?? 'unknown');
    return {
        type,
        label: String(item.name ?? item.label ?? type ?? `Block ${index + 1}`),
        position:
            typeof item.position === 'object' && item.position !== null
                ? (item.position as { x: number; y: number })
                : undefined,
    };
};

const toProposalEdge = (edge: unknown): { source: string; target: string } | null => {
    const item = asRecord(edge);
    const source = item.sourceNodeId ?? item.source ?? item.from;
    const target = item.targetNodeId ?? item.target ?? item.to;
    if (source === undefined || target === undefined) return null;
    return { source: String(source), target: String(target) };
};

type ProposalPayload =
    | NonNullable<MessageCreateResponse['proposal']>
    | NonNullable<MessageListResponse['items'][number]['proposal']>;

const toMessageProposal = (
    proposal: ProposalPayload | undefined,
    description?: string
): MessageProposal | undefined => {
    if (!proposal || proposal.proposedNodes.length === 0) return undefined;
    return {
        id: proposal.proposalId,
        blocks: proposal.proposedNodes.map(toProposalBlock),
        edges: proposal.proposedEdges
            .map(toProposalEdge)
            .filter((edge): edge is { source: string; target: string } => Boolean(edge)),
        estimatedCost: formatEstimatedCost(proposal.estimatedCost),
        estimatedCostUsd:
            'estimatedCostUsd' in proposal
                ? (proposal.estimatedCostUsd ?? proposal.estimatedCost?.total)
                : proposal.estimatedCost?.total,
        maxRunEstimatedCostUsd: 'maxRunEstimatedCostUsd' in proposal ? proposal.maxRunEstimatedCostUsd : undefined,
        metadata: proposal.metadata,
        description,
    };
};

/**
 * Send a message to the flow agent
 * POST /flows/{flowId}/messages
 *
 */
export const sendFlowMessage = async (flowId: string, body: SendMessageBody): Promise<MessageView | null> => {
    _log(`> sendFlowMessage(${flowId})`, body);
    const response = await api.post<MessageCreateResponse>(`/flows/${flowId}/messages`, body);
    if (!response.data.assistantMessage) return null;

    return {
        id: response.data.assistantMessage.messageId,
        flowId: response.data.assistantMessage.flowId,
        role: 'agent',
        content: response.data.assistantMessage.content,
        proposal: toMessageProposal(response.data.proposal, response.data.assistantMessage.content),
        createdAt: Date.parse(response.data.assistantMessage.createdAt),
    };
};

/**
 * Get message history for a flow
 * GET /flows/{flowId}/messages
 *
 */
export const getFlowMessages = async (flowId: string): Promise<MessageView[]> => {
    _log(`> getFlowMessages(${flowId})`);
    const response = await api.get<MessageListResponse>(`/flows/${flowId}/messages`);
    return response.data.items.map(message => ({
        id: message.messageId,
        flowId: message.flowId,
        role: message.role === 'USER' ? 'user' : 'agent',
        content: message.content,
        proposal: toMessageProposal(message.proposal, message.content),
        createdAt: Date.parse(message.createdAt),
    }));
};
