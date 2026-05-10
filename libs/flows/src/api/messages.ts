import { api } from '@flows/web-core';

const _log = console.log.bind(console, '[messages-api]');

export interface SendMessageBody {
    message: string;
}

export interface MessageProposalBlock {
    type: string;
    label: string;
}

export interface MessageProposal {
    id: string;
    blocks: MessageProposalBlock[];
    estimatedCost?: string;
}

export interface MessageView {
    id: string;
    flowId: string;
    message: string;
    role: 'user' | 'agent';
    createdAt?: number;
    proposal?: MessageProposal;
}

/**
 * Send a message to the flow agent
 * POST /flows/{flowId}/messages
 *
 * @param flowId - Flow ID to send message to
 * @param body - Request body with message text
 * @returns MessageView with agent reply and optional proposal
 */
export const sendMessage = async (flowId: string, body: SendMessageBody): Promise<MessageView> => {
    _log(`> sendMessage(${flowId})`, body);
    const response = await api.post<MessageView>(`/flows/${flowId}/messages`, body);
    return response.data;
};
