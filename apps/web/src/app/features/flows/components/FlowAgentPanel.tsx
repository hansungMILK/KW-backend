import { useEffect, useRef, useState } from 'react';

import { Send, X } from 'lucide-react';

import { approveProposal, sendFlowMessage } from '@flows/flows';

import type { MessageProposal } from '@flows/flows';
import type { ProposalCreatedMessage } from '@flows/socket';

interface Message {
    id: string;
    role: 'user' | 'agent';
    text?: string;
    thinking?: boolean;
    proposal?: MessageProposal;
}

interface FlowAgentPanelProps {
    open: boolean;
    onClose: () => void;
    flowId: string | null;
    /** Called after proposal approved — passes nodes/edges to place on canvas */
    onApproveProposal?: (nodes: unknown[], edges: unknown[]) => void;
    /** Externally pushed proposal.created WS event */
    externalProposal?: ProposalCreatedMessage | null;
}

const formatEstimatedCost = (cost: ProposalCreatedMessage['estimatedCost']): string | undefined => {
    if (cost === undefined) return undefined;
    if (typeof cost === 'string') return cost;
    if (typeof cost === 'number') return `$${cost.toFixed(2)}`;
    if (typeof cost.total === 'number') {
        const currency = cost.currency === 'USD' || !cost.currency ? '$' : `${cost.currency} `;
        return `${currency}${cost.total.toFixed(2)}`;
    }
    return undefined;
};

export const FlowAgentPanel = ({ open, onClose, flowId, onApproveProposal, externalProposal }: FlowAgentPanelProps) => {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isThinking, setIsThinking] = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (open) inputRef.current?.focus();
    }, [open]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // Handle externally pushed proposal.created WS event
    useEffect(() => {
        if (!externalProposal) return;
        if (!externalProposal.blocks || externalProposal.blocks.length === 0) return;
        const proposal: MessageProposal = {
            id: externalProposal.proposalId,
            blocks: externalProposal.blocks ?? [],
            estimatedCost: formatEstimatedCost(externalProposal.estimatedCost),
            description: externalProposal.description,
        };
        setMessages(prev =>
            prev.some(message => message.proposal?.id === proposal.id)
                ? prev
                : [...prev, { id: crypto.randomUUID(), role: 'agent', proposal }]
        );
    }, [externalProposal]);

    const sendMessage = async () => {
        const text = input.trim();
        if (!text || isThinking || !flowId) return;

        const userMsg: Message = { id: crypto.randomUUID(), role: 'user', text };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setIsThinking(true);

        const thinkingMsg: Message = { id: crypto.randomUUID(), role: 'agent', thinking: true };
        setMessages(prev => [...prev, thinkingMsg]);

        try {
            const response = await sendFlowMessage(flowId, { content: text });

            setMessages(prev => {
                const withoutThinking = prev.filter(m => !m.thinking);
                const msgs: Message[] = [
                    ...withoutThinking,
                    { id: crypto.randomUUID(), role: 'agent', text: response.content },
                ];
                if (response.proposal) {
                    msgs.push({ id: crypto.randomUUID(), role: 'agent', proposal: response.proposal });
                }
                return msgs;
            });
        } catch {
            setMessages(prev => [
                ...prev.filter(m => !m.thinking),
                { id: crypto.randomUUID(), role: 'agent', text: '오류가 발생했습니다. 다시 시도해주세요.' },
            ]);
        } finally {
            setIsThinking(false);
        }
    };

    const handleApprove = async (proposal: MessageProposal) => {
        try {
            const result = await approveProposal(proposal.id);
            onApproveProposal?.(result.nodes, result.edges);
            setMessages(prev => prev.filter(m => m.proposal?.id !== proposal.id));
        } catch {
            // keep proposal card visible on error
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void sendMessage();
        }
    };

    if (!open) return null;

    return (
        <div className="absolute top-0 right-0 h-full w-80 bg-background border-l border-border flex flex-col z-30 shadow-xl">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
                <span className="text-sm font-semibold text-foreground">flow agent</span>
                <button
                    onClick={onClose}
                    className="w-6 h-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
                {messages.map(msg => {
                    if (msg.thinking) {
                        return (
                            <div key={msg.id} className="flex items-start gap-2">
                                <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                                    <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                                </div>
                                <div className="bg-muted rounded-lg px-3 py-2 text-[12px] text-muted-foreground">
                                    생각중...
                                </div>
                            </div>
                        );
                    }

                    if (msg.proposal) {
                        const { blocks, estimatedCost, description } = msg.proposal;
                        if (blocks.length === 0) return null;
                        const proposal = msg.proposal;
                        return (
                            <div key={msg.id} className="flex items-start gap-2">
                                <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                                    <div className="w-2 h-2 rounded-full bg-primary" />
                                </div>
                                <div className="bg-muted rounded-lg px-3 py-3 text-[12px] text-foreground flex flex-col gap-2 w-full">
                                    <div className="font-semibold">{blocks.length}개 블록 생성</div>
                                    {description && (
                                        <div className="text-muted-foreground leading-relaxed">{description}</div>
                                    )}
                                    <div className="text-muted-foreground leading-relaxed">
                                        {blocks.map((b, i) => (
                                            <div key={i}>{b.label}</div>
                                        ))}
                                    </div>
                                    {estimatedCost && (
                                        <div className="text-muted-foreground">
                                            예상 비용 : {estimatedCost}
                                            <br />
                                            생성 하시겠습니까?
                                        </div>
                                    )}
                                    <div className="flex gap-2 mt-1">
                                        <button
                                            className="flex-1 text-[11px] py-1.5 rounded-md bg-foreground text-background hover:bg-foreground/80 transition-colors"
                                            onClick={() => void handleApprove(proposal)}
                                        >
                                            승인
                                        </button>
                                        <button
                                            className="flex-1 text-[11px] py-1.5 rounded-md bg-muted-foreground/10 hover:bg-muted-foreground/20 text-foreground transition-colors border border-border"
                                            onClick={() => setMessages(prev => prev.filter(m => m.id !== msg.id))}
                                        >
                                            cancel
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    }

                    if (msg.role === 'user') {
                        return (
                            <div key={msg.id} className="flex justify-end">
                                <div className="bg-primary text-primary-foreground rounded-lg px-3 py-2 text-[12px] max-w-[80%]">
                                    {msg.text}
                                </div>
                            </div>
                        );
                    }

                    return (
                        <div key={msg.id} className="flex items-start gap-2">
                            <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                                <div className="w-2 h-2 rounded-full bg-primary" />
                            </div>
                            <div className="bg-muted rounded-lg px-3 py-2 text-[12px] text-foreground max-w-[80%]">
                                {msg.text}
                            </div>
                        </div>
                    );
                })}
                <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className="px-3 pb-3 pt-2 border-t border-border shrink-0">
                <div className="flex items-end gap-2 bg-muted rounded-xl px-3 py-2">
                    <textarea
                        ref={inputRef}
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="메세지를 입력해주세요."
                        rows={1}
                        className="flex-1 bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground resize-none outline-none leading-relaxed"
                        style={{ maxHeight: '80px' }}
                    />
                    <button
                        onClick={() => void sendMessage()}
                        disabled={!input.trim() || isThinking || !flowId}
                        className="w-6 h-6 rounded-full bg-foreground flex items-center justify-center shrink-0 disabled:opacity-30 transition-opacity"
                    >
                        <Send className="w-3 h-3 text-background" />
                    </button>
                </div>
            </div>
        </div>
    );
};
