import { useEffect, useRef, useState } from 'react';

import { Send, X } from 'lucide-react';

import { approveProposal, getFlowMessages, sendFlowMessage } from '@flows/flows';
import { MarkdownViewer } from '@flows/ui-kit';
import { extractErrorMessage } from '@flows/web-core';

import type { MessageProposal } from '@flows/flows';
import type { ProposalCreatedMessage } from '@flows/socket';

interface Message {
    id: string;
    role: 'user' | 'agent';
    text?: string;
    thinking?: boolean;
    proposal?: MessageProposal;
}

type ImageQuality = 'low' | 'medium' | 'high';
type ImageStyleId =
    | 'explainer-comic'
    | 'animation'
    | 'photo-real'
    | 'research-visual'
    | 'blueprint'
    | 'newspaper'
    | 'app-ui'
    | 'icon-design';

type ImageStyleOption = {
    id: ImageStyleId;
    label: string;
    description?: string;
};

type ImageGenerationMetadata = {
    imageGeneration?: {
        model?: string;
        recommendedStyleId?: ImageStyleId;
        imageStyleId?: ImageStyleId;
        imageStyleLabel?: string;
        imageQuality?: ImageQuality;
        sceneCount?: number;
        imageEstimatedCostUsd?: number;
        textAndOtherEstimatedCostUsd?: number;
        estimatedTotalCostUsd?: number;
        styleOptions?: ImageStyleOption[];
        sceneCountOptions?: Array<{
            count: number;
            label: string;
        }>;
        qualityOptions?: Array<{
            id: ImageQuality;
            label: string;
            estimatedImageCostUsd?: number;
        }>;
    };
};

type ScriptToneId = 'informative-reframe' | 'mz-viral' | 'news-anchor' | 'story-dialogue' | 'calm-explainer';
type ScriptToneIntensity = 'low' | 'medium' | 'high';
type ContentProfileId =
    | 'text.explainer.v1'
    | 'image.single.v1'
    | 'shorts.info.v1'
    | 'shorts.story.v1'
    | 'longform.explainer.v1'
    | 'longform.documentary.v1';
type ReviewMode = 'direct-run' | 'script-first';

type ContentProfileOption<T extends string> = {
    id: T;
    label: string;
    description?: string;
};

type ContentProfileMetadata = {
    contentProfile?: {
        contentProfileId?: ContentProfileId;
        scriptToneId?: ScriptToneId;
        scriptToneIntensity?: ScriptToneIntensity;
        reviewMode?: ReviewMode;
        toneOptions?: ContentProfileOption<ScriptToneId>[];
        intensityOptions?: ContentProfileOption<ScriptToneIntensity>[];
        reviewModeOptions?: ContentProfileOption<ReviewMode>[];
        profileOptions?: ContentProfileOption<ContentProfileId>[];
    };
};

interface FlowAgentPanelProps {
    open: boolean;
    onClose: () => void;
    flowId: string | null;
    /** Called after proposal approved — passes nodes/edges to place on canvas */
    onApproveProposal?: (nodes: unknown[], edges: unknown[]) => void | Promise<void>;
    /** Externally pushed proposal.created WS event */
    externalProposal?: ProposalCreatedMessage | null;
    runStatus?: 'running' | 'completed' | 'failed' | null;
    runActivity?: {
        nodeLabel?: string;
        progress?: number;
        state?: 'queued' | 'running' | 'completed' | 'failed';
        message?: string;
        error?: string | null;
    } | null;
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

const asImageGenerationMetadata = (metadata: unknown): ImageGenerationMetadata['imageGeneration'] | undefined => {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;
    const imageGeneration = (metadata as ImageGenerationMetadata).imageGeneration;
    if (!imageGeneration || typeof imageGeneration !== 'object') return undefined;
    return imageGeneration;
};

const asContentProfileMetadata = (metadata: unknown): ContentProfileMetadata['contentProfile'] | undefined => {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;
    const contentProfile = (metadata as ContentProfileMetadata).contentProfile;
    if (!contentProfile || typeof contentProfile !== 'object' || Array.isArray(contentProfile)) return undefined;
    return contentProfile;
};

const formatUsd = (value: unknown): string | undefined => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    return `$${value.toFixed(value >= 1 ? 2 : 3)}`;
};

const toUserVisibleAgentError = (error: unknown): string => {
    const message = extractErrorMessage(error);
    if (/PAID_OPENAI_DISABLED|Paid OpenAI calls are disabled/i.test(message)) {
        return '현재 OpenAI 실제 호출이 꺼져 있습니다. 비용이 나가는 테스트를 할 때만 백엔드에서 ALLOW_PAID_OPENAI=1로 켜주세요.';
    }
    if (/MISSING_API_KEYS|Required API keys not configured|OPENAI_API_KEY/i.test(message)) {
        return 'OpenAI API 키가 설정되어 있지 않습니다. 백엔드 환경변수 또는 Settings API에 키를 넣은 뒤 다시 시도해주세요.';
    }
    if (/RUN_COST_LIMIT_EXCEEDED|exceeds the per-run cap/i.test(message)) {
        return '예상 실행 비용이 1회 한도 $2.00를 넘어 실행을 차단했습니다. 장면 수나 이미지 품질을 낮추거나 한도를 조정해주세요.';
    }
    if (/LONGFORM_HTML_RENDER_COST_LIMIT_EXCEEDED|longform HTML\/HyperFrames generation cost/i.test(message)) {
        return '롱폼 HTML/HyperFrames 생성 예상 비용이 1회 한도 $5.00를 넘어 실행을 차단했습니다. 렌더 길이, 해상도, 장면 수를 낮춰주세요.';
    }
    return message;
};

const normalizeAgentMarkdown = (text: string): string => {
    return text
        .replace(/\s+-\s+/g, '\n- ')
        .replace(/([.!?。！？])\s+(예를 들어|원하시면|지금 저는|원하는 경우)/g, '$1\n\n$2')
        .trim();
};

export const FlowAgentPanel = ({
    open,
    onClose,
    flowId,
    onApproveProposal,
    externalProposal,
    runStatus,
    runActivity,
}: FlowAgentPanelProps) => {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isThinking, setIsThinking] = useState(false);
    const [proposalImageStyles, setProposalImageStyles] = useState<Record<string, ImageStyleId>>({});
    const [proposalImageQualities, setProposalImageQualities] = useState<Record<string, ImageQuality>>({});
    const [proposalSceneCounts, setProposalSceneCounts] = useState<Record<string, number>>({});
    const [proposalScriptTones, setProposalScriptTones] = useState<Record<string, ScriptToneId>>({});
    const [proposalScriptToneIntensities, setProposalScriptToneIntensities] = useState<
        Record<string, ScriptToneIntensity>
    >({});
    const [proposalReviewModes, setProposalReviewModes] = useState<Record<string, ReviewMode>>({});
    const [proposalContentProfiles, setProposalContentProfiles] = useState<Record<string, ContentProfileId>>({});
    const [approvingProposalIds, setApprovingProposalIds] = useState<Record<string, boolean>>({});
    const [approvedProposalIds, setApprovedProposalIds] = useState<Record<string, boolean>>({});
    const bottomRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const isComposingRef = useRef(false);
    const loadedFlowIdRef = useRef<string | null>(null);

    useEffect(() => {
        if (open) inputRef.current?.focus();
    }, [open]);

    useEffect(() => {
        if (!open || !flowId) return;
        if (loadedFlowIdRef.current === flowId) return;

        loadedFlowIdRef.current = flowId;
        let cancelled = false;

        const loadHistory = async () => {
            try {
                const history = await getFlowMessages(flowId);
                if (cancelled) return;
                setMessages(prev =>
                    prev.length > 0
                        ? prev
                        : history.map(message => ({
                              id: message.id,
                              role: message.role,
                              text: message.content,
                          }))
                );
            } catch (error) {
                if (cancelled) return;
                setMessages(prev =>
                    prev.length > 0
                        ? prev
                        : [
                              {
                                  id: crypto.randomUUID(),
                                  role: 'agent',
                                  text: toUserVisibleAgentError(error),
                              },
                          ]
                );
            }
        };

        void loadHistory();

        return () => {
            cancelled = true;
        };
    }, [open, flowId]);

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
            metadata: externalProposal.metadata,
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
                if (!response) {
                    return [
                        ...withoutThinking,
                        {
                            id: crypto.randomUUID(),
                            role: 'agent',
                            text: '서버 응답에 표시할 답변이 없습니다. 잠시 후 다시 시도해주세요.',
                        },
                    ];
                }

                if (response.proposal) {
                    return withoutThinking.some(message => message.proposal?.id === response.proposal?.id)
                        ? withoutThinking
                        : [...withoutThinking, { id: crypto.randomUUID(), role: 'agent', proposal: response.proposal }];
                }

                return [...withoutThinking, { id: crypto.randomUUID(), role: 'agent', text: response.content }];
            });
        } catch (error) {
            setMessages(prev => [
                ...prev.filter(m => !m.thinking),
                { id: crypto.randomUUID(), role: 'agent', text: toUserVisibleAgentError(error) },
            ]);
        } finally {
            setIsThinking(false);
        }
    };

    const handleApprove = async (proposal: MessageProposal) => {
        if (approvingProposalIds[proposal.id]) return;
        setApprovingProposalIds(prev => ({ ...prev, [proposal.id]: true }));
        try {
            const imageGeneration = asImageGenerationMetadata(proposal.metadata);
            const contentProfile = asContentProfileMetadata(proposal.metadata);
            const result = await approveProposal(proposal.id, {
                imageStyleId: proposalImageStyles[proposal.id] ?? imageGeneration?.imageStyleId,
                imageQuality: proposalImageQualities[proposal.id] ?? imageGeneration?.imageQuality,
                sceneCount: proposalSceneCounts[proposal.id] ?? imageGeneration?.sceneCount,
                scriptToneId: proposalScriptTones[proposal.id] ?? contentProfile?.scriptToneId,
                scriptToneIntensity: proposalScriptToneIntensities[proposal.id] ?? contentProfile?.scriptToneIntensity,
                reviewMode: proposalReviewModes[proposal.id] ?? contentProfile?.reviewMode,
                contentProfileId: proposalContentProfiles[proposal.id] ?? contentProfile?.contentProfileId,
            });
            await onApproveProposal?.(result.nodes, result.edges);
            setApprovedProposalIds(prev => ({ ...prev, [proposal.id]: true }));
            setMessages(prev =>
                prev.map(message =>
                    message.proposal?.id === proposal.id
                        ? {
                              ...message,
                              text: `제안이 승인되었습니다. ${result.nodes.length}개 블록이 캔버스에 배치되었습니다.`,
                          }
                        : message
                )
            );
        } catch (error) {
            setMessages(prev => [
                ...prev,
                {
                    id: crypto.randomUUID(),
                    role: 'agent',
                    text: toUserVisibleAgentError(error),
                },
            ]);
        } finally {
            setApprovingProposalIds(prev => ({ ...prev, [proposal.id]: false }));
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.nativeEvent.isComposing || isComposingRef.current) return;
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

            {runStatus && (
                <div className="px-4 py-3 border-b border-border/70 bg-muted/20 shrink-0">
                    <div
                        className={`rounded-lg border px-3 py-2 text-[12px] ${
                            runStatus === 'running'
                                ? 'border-status-running/30 bg-status-running/10 text-status-running'
                                : runStatus === 'completed'
                                  ? 'border-status-completed/30 bg-status-completed/10 text-status-completed'
                                  : 'border-destructive/30 bg-destructive/10 text-destructive'
                        }`}
                    >
                        <div className="flex items-center gap-2 font-semibold">
                            {runStatus === 'running' && (
                                <span className="relative flex h-2.5 w-2.5">
                                    <span className="absolute inline-flex h-full w-full rounded-full bg-status-running opacity-70 animate-ping" />
                                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-status-running" />
                                </span>
                            )}
                            <span>
                                {runStatus === 'running' && '워크플로우 실행 중'}
                                {runStatus === 'completed' && '워크플로우 실행 완료'}
                                {runStatus === 'failed' && '워크플로우 실행 실패'}
                            </span>
                        </div>
                        {runActivity?.nodeLabel && (
                            <div className="mt-1 text-muted-foreground">
                                현재 노드: <span className="text-foreground">{runActivity.nodeLabel}</span>
                            </div>
                        )}
                        {runActivity?.message && <div className="mt-1 text-foreground/90">{runActivity.message}</div>}
                        {typeof runActivity?.progress === 'number' && (
                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                                <div
                                    className={`h-full rounded-full transition-all duration-300 ${
                                        runStatus === 'failed' ? 'bg-destructive' : 'bg-status-running'
                                    }`}
                                    style={{ width: `${Math.min(100, Math.max(3, runActivity.progress))}%` }}
                                />
                            </div>
                        )}
                        {runStatus === 'failed' && runActivity?.error && (
                            <div className="mt-1 text-destructive/90">{runActivity.error}</div>
                        )}
                    </div>
                </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
                {messages.length === 0 && (
                    <div className="rounded-xl border border-border bg-muted/30 px-3 py-3 text-[12px] text-muted-foreground leading-relaxed">
                        <div className="mb-2 font-semibold text-foreground">무엇을 만들까요?</div>
                        <div>자연어로 요청하면 필요한 블록을 제안하고, 승인 후 캔버스에 배치합니다.</div>
                        <div className="mt-2 space-y-1">
                            <div>예: 최신 이슈를 정보전달 쇼츠로 제작해줘</div>
                            <div>예: 바나나가 춤추는 이미지 생성해줘</div>
                            <div>예: 리뷰 요약 자동화 만들어줘</div>
                        </div>
                    </div>
                )}
                {messages.map(msg => {
                    if (msg.thinking) {
                        return (
                            <div key={msg.id} className="flex items-start gap-2">
                                <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                                    <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                                </div>
                                <div className="bg-muted rounded-lg px-3 py-2 text-[12px] text-muted-foreground flex items-center gap-1">
                                    <span>답변 생성 중</span>
                                    <span className="w-1 h-1 rounded-full bg-current animate-bounce" />
                                    <span className="w-1 h-1 rounded-full bg-current animate-bounce [animation-delay:120ms]" />
                                    <span className="w-1 h-1 rounded-full bg-current animate-bounce [animation-delay:240ms]" />
                                </div>
                            </div>
                        );
                    }

                    if (msg.proposal) {
                        const { blocks, estimatedCost, description } = msg.proposal;
                        if (blocks.length === 0) return null;
                        const proposal = msg.proposal;
                        const imageGeneration = asImageGenerationMetadata(proposal.metadata);
                        const contentProfile = asContentProfileMetadata(proposal.metadata);
                        const selectedScriptToneId =
                            proposalScriptTones[proposal.id] ?? contentProfile?.scriptToneId ?? 'informative-reframe';
                        const selectedScriptToneIntensity =
                            proposalScriptToneIntensities[proposal.id] ??
                            contentProfile?.scriptToneIntensity ??
                            'medium';
                        const selectedReviewMode =
                            proposalReviewModes[proposal.id] ?? contentProfile?.reviewMode ?? 'direct-run';
                        const selectedContentProfileId =
                            proposalContentProfiles[proposal.id] ??
                            contentProfile?.contentProfileId ??
                            'shorts.info.v1';
                        const selectedStyleId =
                            proposalImageStyles[proposal.id] ??
                            imageGeneration?.imageStyleId ??
                            imageGeneration?.recommendedStyleId;
                        const selectedQuality =
                            proposalImageQualities[proposal.id] ?? imageGeneration?.imageQuality ?? 'medium';
                        const selectedSceneCount =
                            proposalSceneCounts[proposal.id] ?? imageGeneration?.sceneCount ?? 12;
                        const selectedQualityOption = imageGeneration?.qualityOptions?.find(
                            option => option.id === selectedQuality
                        );
                        const baseSceneCount = Math.max(1, imageGeneration?.sceneCount ?? 12);
                        const selectedImageCost =
                            typeof selectedQualityOption?.estimatedImageCostUsd === 'number'
                                ? (selectedQualityOption.estimatedImageCostUsd / baseSceneCount) * selectedSceneCount
                                : undefined;
                        const totalCost =
                            typeof selectedImageCost === 'number'
                                ? selectedImageCost + (imageGeneration?.textAndOtherEstimatedCostUsd ?? 0)
                                : imageGeneration?.estimatedTotalCostUsd;
                        const sceneCountOptions = imageGeneration?.sceneCountOptions?.length
                            ? imageGeneration.sceneCountOptions
                            : [
                                  { count: 8, label: '8장' },
                                  { count: 12, label: '12장' },
                                  { count: 16, label: '16장' },
                              ];
                        const isApproving = Boolean(approvingProposalIds[proposal.id]);
                        const isApproved = Boolean(approvedProposalIds[proposal.id]);
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
                                    {contentProfile && (
                                        <div className="rounded-md border border-border bg-background/40 p-2 space-y-2">
                                            <div className="text-[11px] font-semibold text-foreground">
                                                대본/콘텐츠 설정
                                            </div>
                                            {contentProfile.profileOptions?.length ? (
                                                <div className="space-y-1">
                                                    <div className="text-[10px] font-medium text-muted-foreground">
                                                        콘텐츠 종류
                                                    </div>
                                                    <div className="flex flex-wrap gap-1">
                                                        {contentProfile.profileOptions.map(option => (
                                                            <button
                                                                key={option.id}
                                                                type="button"
                                                                className={`rounded-md border px-2 py-1 text-[10px] transition-colors ${
                                                                    selectedContentProfileId === option.id
                                                                        ? 'border-primary bg-primary/20 text-primary'
                                                                        : 'border-border bg-muted/30 text-muted-foreground hover:text-foreground'
                                                                }`}
                                                                disabled={isApproved}
                                                                title={option.description}
                                                                onClick={() =>
                                                                    setProposalContentProfiles(prev => ({
                                                                        ...prev,
                                                                        [proposal.id]: option.id,
                                                                    }))
                                                                }
                                                            >
                                                                {option.label}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            ) : null}
                                            {contentProfile.toneOptions?.length ? (
                                                <div className="space-y-1">
                                                    <div className="text-[10px] font-medium text-muted-foreground">
                                                        대본 톤
                                                    </div>
                                                    <div className="flex flex-wrap gap-1">
                                                        {contentProfile.toneOptions.map(option => (
                                                            <button
                                                                key={option.id}
                                                                type="button"
                                                                className={`rounded-full border px-2 py-1 text-[10px] transition-colors ${
                                                                    selectedScriptToneId === option.id
                                                                        ? 'border-primary bg-primary text-primary-foreground'
                                                                        : 'border-border bg-muted/40 text-muted-foreground hover:text-foreground'
                                                                }`}
                                                                disabled={isApproved}
                                                                title={option.description}
                                                                onClick={() =>
                                                                    setProposalScriptTones(prev => ({
                                                                        ...prev,
                                                                        [proposal.id]: option.id,
                                                                    }))
                                                                }
                                                            >
                                                                {option.label}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            ) : null}
                                            {contentProfile.intensityOptions?.length ? (
                                                <div className="space-y-1">
                                                    <div className="text-[10px] font-medium text-muted-foreground">
                                                        톤 강도
                                                    </div>
                                                    <div className="flex flex-wrap gap-1">
                                                        {contentProfile.intensityOptions.map(option => (
                                                            <button
                                                                key={option.id}
                                                                type="button"
                                                                className={`rounded-md border px-2 py-1 text-[10px] transition-colors ${
                                                                    selectedScriptToneIntensity === option.id
                                                                        ? 'border-primary bg-primary/20 text-primary'
                                                                        : 'border-border bg-muted/30 text-muted-foreground hover:text-foreground'
                                                                }`}
                                                                disabled={isApproved}
                                                                title={option.description}
                                                                onClick={() =>
                                                                    setProposalScriptToneIntensities(prev => ({
                                                                        ...prev,
                                                                        [proposal.id]: option.id,
                                                                    }))
                                                                }
                                                            >
                                                                {option.label}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            ) : null}
                                            {contentProfile.reviewModeOptions?.length ? (
                                                <div className="space-y-1">
                                                    <div className="text-[10px] font-medium text-muted-foreground">
                                                        실행 방식
                                                    </div>
                                                    <div className="flex flex-wrap gap-1">
                                                        {contentProfile.reviewModeOptions.map(option => (
                                                            <button
                                                                key={option.id}
                                                                type="button"
                                                                className={`rounded-md border px-2 py-1 text-[10px] transition-colors ${
                                                                    selectedReviewMode === option.id
                                                                        ? 'border-primary bg-primary/20 text-primary'
                                                                        : 'border-border bg-muted/30 text-muted-foreground hover:text-foreground'
                                                                }`}
                                                                disabled={isApproved}
                                                                title={option.description}
                                                                onClick={() =>
                                                                    setProposalReviewModes(prev => ({
                                                                        ...prev,
                                                                        [proposal.id]: option.id,
                                                                    }))
                                                                }
                                                            >
                                                                {option.label}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            ) : null}
                                            {selectedReviewMode === 'script-first' && (
                                                <div className="rounded-md bg-primary/10 px-2 py-1 text-[10px] text-primary">
                                                    대본 단계에서 멈춰 사용자가 검수한 뒤 유료 생성으로 이어갑니다.
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    {imageGeneration && (
                                        <div className="rounded-md border border-border bg-background/40 p-2 space-y-2">
                                            <div className="text-[11px] font-semibold text-foreground">이미지 설정</div>
                                            <div className="text-[10px] text-muted-foreground">
                                                모델: {imageGeneration.model ?? 'gpt-image-2'} · 장면:{' '}
                                                {selectedSceneCount}장
                                            </div>
                                            <div className="flex flex-wrap gap-1">
                                                {sceneCountOptions.map(option => (
                                                    <button
                                                        key={option.count}
                                                        type="button"
                                                        className={`rounded-md border px-2 py-1 text-[10px] transition-colors ${
                                                            selectedSceneCount === option.count
                                                                ? 'border-primary bg-primary/20 text-primary'
                                                                : 'border-border bg-muted/30 text-muted-foreground hover:text-foreground'
                                                        }`}
                                                        disabled={isApproved}
                                                        onClick={() =>
                                                            setProposalSceneCounts(prev => ({
                                                                ...prev,
                                                                [proposal.id]: option.count,
                                                            }))
                                                        }
                                                    >
                                                        {option.label}
                                                    </button>
                                                ))}
                                            </div>
                                            <div className="flex flex-wrap gap-1">
                                                {imageGeneration.styleOptions?.map(option => (
                                                    <button
                                                        key={option.id}
                                                        type="button"
                                                        className={`rounded-full border px-2 py-1 text-[10px] transition-colors ${
                                                            selectedStyleId === option.id
                                                                ? 'border-primary bg-primary text-primary-foreground'
                                                                : 'border-border bg-muted/40 text-muted-foreground hover:text-foreground'
                                                        }`}
                                                        disabled={isApproved}
                                                        title={option.description}
                                                        onClick={() =>
                                                            setProposalImageStyles(prev => ({
                                                                ...prev,
                                                                [proposal.id]: option.id,
                                                            }))
                                                        }
                                                    >
                                                        {option.label}
                                                    </button>
                                                ))}
                                            </div>
                                            <div className="flex gap-1">
                                                {imageGeneration.qualityOptions?.map(option => {
                                                    const optionCost =
                                                        typeof option.estimatedImageCostUsd === 'number'
                                                            ? (option.estimatedImageCostUsd / baseSceneCount) *
                                                              selectedSceneCount
                                                            : undefined;
                                                    return (
                                                        <button
                                                            key={option.id}
                                                            type="button"
                                                            className={`rounded-md border px-2 py-1 text-[10px] transition-colors ${
                                                                selectedQuality === option.id
                                                                    ? 'border-primary bg-primary/20 text-primary'
                                                                    : 'border-border bg-muted/30 text-muted-foreground hover:text-foreground'
                                                            }`}
                                                            disabled={isApproved}
                                                            onClick={() =>
                                                                setProposalImageQualities(prev => ({
                                                                    ...prev,
                                                                    [proposal.id]: option.id,
                                                                }))
                                                            }
                                                        >
                                                            {option.label}
                                                            {formatUsd(optionCost) ? ` ${formatUsd(optionCost)}` : ''}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                            {formatUsd(totalCost) && (
                                                <div className="text-[10px] text-muted-foreground">
                                                    선택 기준 예상 총 비용: {formatUsd(totalCost)}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    {estimatedCost && (
                                        <div className="text-muted-foreground">
                                            예상 비용 : {formatUsd(totalCost) ?? estimatedCost}
                                            <br />
                                            1회 실행 한도 : $2.00
                                            <br />
                                            생성 하시겠습니까?
                                        </div>
                                    )}
                                    {isApproved && (
                                        <div className="rounded-md border border-primary/30 bg-primary/10 px-2 py-1.5 text-[11px] text-primary">
                                            제안이 승인되어 캔버스에 배치되었습니다. 아래 워크플로우 실행 버튼으로 바로
                                            실행할 수 있습니다.
                                        </div>
                                    )}
                                    <div className="flex gap-2 mt-1">
                                        <button
                                            className="flex-1 text-[11px] py-1.5 rounded-md bg-foreground text-background hover:bg-foreground/80 transition-colors"
                                            disabled={isApproving || isApproved}
                                            onClick={() => void handleApprove(proposal)}
                                        >
                                            {isApproved ? '승인 완료' : isApproving ? '배치 중' : '승인'}
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
                            <div className="bg-muted rounded-lg px-3 py-2 text-foreground max-w-[86%]">
                                <MarkdownViewer
                                    content={normalizeAgentMarkdown(msg.text ?? '')}
                                    className="text-[12px] leading-relaxed overflow-visible [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:my-1.5 [&_ul]:space-y-1 [&_ol]:my-1.5 [&_ol]:space-y-1 [&_li]:leading-relaxed [&_strong]:font-semibold [&_strong]:text-foreground"
                                />
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
                        onCompositionStart={() => {
                            isComposingRef.current = true;
                        }}
                        onCompositionEnd={() => {
                            isComposingRef.current = false;
                        }}
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
