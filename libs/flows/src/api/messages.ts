// TODO: import api from '@flows/web-core' when backend is ready
const _log = console.log.bind(console, '[messages-api]');

export interface SendMessageBody {
    content: string;
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

/**
 * Send a message to the flow agent
 * POST /flows/{flowId}/messages
 *
 * TODO: backend not ready — replace mock with real call:
 * const response = await api.post<MessageView>(`/flows/${flowId}/messages`, body);
 * return response.data;
 */
export const sendFlowMessage = async (flowId: string, body: SendMessageBody): Promise<MessageView> => {
    _log(`> sendFlowMessage(${flowId})`, body);
    return Promise.resolve({
        id: crypto.randomUUID(),
        flowId,
        role: 'agent',
        content: '워크플로우를 구성하는 데 도움을 드릴게요. 어떤 결과물을 만들고 싶으신가요?',
        createdAt: Date.now(),
    });
};

/**
 * Get message history for a flow
 * GET /flows/{flowId}/messages
 *
 * TODO: backend not ready — replace mock with real call:
 * const response = await api.get<{ list: MessageView[] }>(`/flows/${flowId}/messages`);
 * return response.data.list ?? [];
 */
export const getFlowMessages = async (flowId: string): Promise<MessageView[]> => {
    _log(`> getFlowMessages(${flowId})`);
    return Promise.resolve([]);
};
