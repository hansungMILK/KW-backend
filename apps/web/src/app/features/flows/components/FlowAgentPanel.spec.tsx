// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type MessageProposal, approveProposal, getFlowMessages } from '@flows/flows';

import { FlowAgentPanel } from './FlowAgentPanel';

vi.mock('@flows/flows', () => ({
    approveProposal: vi.fn(async () => ({ id: 'proposal-1', flowId: 'flow-1', nodes: [], edges: [] })),
    getFlowMessages: vi.fn(async () => []),
    sendFlowMessage: vi.fn(),
}));

vi.mock('@flows/ui-kit', () => ({
    MarkdownViewer: ({ content }: { content: string }) => <div>{content}</div>,
}));

vi.mock('@flows/web-core', () => ({
    extractErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));

const proposal: MessageProposal = {
    id: 'proposal-1',
    blocks: [{ type: 'content', label: '스크립트 생성' }],
    estimatedCost: '$0.40',
    metadata: {
        aiRequestDecision: {
            intent: 'shorts',
            recipeId: 'shorts.info.v1',
            outputKind: 'video',
            mode: 'creative-simulation',
            reason: '대결 장면을 쇼츠로 제작하는 요청입니다.',
        },
        contentProfile: {
            contentProfileId: 'shorts.info.v1',
            scriptToneId: 'informative-reframe',
            scriptToneIntensity: 'medium',
            reviewMode: 'direct-run',
            toneOptions: [
                { id: 'informative-reframe', label: '정보전달형', description: '핵심 정리' },
                { id: 'news-anchor', label: '뉴스앵커형', description: '뉴스처럼 전달' },
            ],
            intensityOptions: [
                { id: 'medium', label: '표준', description: '표준 강도' },
                { id: 'high', label: '강하게', description: '강한 톤' },
            ],
            reviewModeOptions: [
                { id: 'direct-run', label: '바로 실행', description: '바로 실행' },
                { id: 'script-first', label: '대본 검수 후 실행', description: '대본 먼저 확인' },
            ],
            profileOptions: [
                { id: 'shorts.info.v1', label: '쇼츠 제작', description: '쇼츠' },
                { id: 'shorts.countryball.v1', label: '컨트리볼 상황극', description: '국가볼 상황극 쇼츠' },
                { id: 'longform.explainer.v1', label: '롱폼 해설', description: '예전 metadata에 남은 롱폼 옵션' },
            ],
        },
    },
};

describe('FlowAgentPanel proposal content profile controls', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Element.prototype.scrollIntoView = vi.fn();
    });

    afterEach(() => {
        cleanup();
    });

    it('lets the user choose script tone, intensity, review mode, and explicit shorts subtype', async () => {
        render(
            <FlowAgentPanel
                open
                onClose={() => undefined}
                flowId="flow-1"
                externalProposal={{
                    type: 'proposal.created',
                    id: 'proposal-created-1',
                    proposalId: proposal.id,
                    flowId: 'flow-1',
                    blocks: proposal.blocks,
                    estimatedCost: proposal.estimatedCost,
                    metadata: proposal.metadata,
                    description: '제안 설명',
                    timestamp: Date.now(),
                }}
            />
        );

        expect(await screen.findByText('대본/콘텐츠 설정')).toBeTruthy();
        expect(screen.getByText('AI 콘텐츠 판단')).toBeTruthy();
        expect(screen.getByText('시뮬레이션 쇼츠')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: '뉴스앵커형' }));
        fireEvent.click(screen.getByRole('button', { name: '강하게' }));
        fireEvent.click(screen.getByRole('button', { name: '대본 검수 후 실행' }));
        fireEvent.click(screen.getByRole('button', { name: '컨트리볼 상황극' }));
        expect(screen.queryByRole('button', { name: '롱폼 해설' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: '승인' }));

        await waitFor(() => {
            expect(approveProposal).toHaveBeenCalledWith(
                'proposal-1',
                expect.objectContaining({
                    scriptToneId: 'news-anchor',
                    scriptToneIntensity: 'high',
                    reviewMode: 'script-first',
                    contentProfileId: 'shorts.countryball.v1',
                })
            );
        });
    });

    it('shows the countryball option for shorts proposals even when profile options are missing', async () => {
        const legacyShortsProposal: MessageProposal = {
            ...proposal,
            id: 'proposal-legacy-shorts',
            metadata: {
                ...proposal.metadata,
                contentProfile: {
                    ...proposal.metadata?.contentProfile,
                    contentProfileId: 'shorts.info.v1',
                    profileOptions: undefined,
                },
            },
        };

        render(
            <FlowAgentPanel
                open
                onClose={() => undefined}
                flowId="flow-1"
                externalProposal={{
                    type: 'proposal.created',
                    id: 'proposal-created-legacy',
                    proposalId: legacyShortsProposal.id,
                    flowId: 'flow-1',
                    blocks: legacyShortsProposal.blocks,
                    estimatedCost: legacyShortsProposal.estimatedCost,
                    metadata: legacyShortsProposal.metadata,
                    description: '제안 설명',
                    timestamp: Date.now(),
                }}
            />
        );

        expect(await screen.findByText('대본/콘텐츠 설정')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: '컨트리볼 상황극' }));
        fireEvent.click(screen.getByRole('button', { name: '승인' }));

        await waitFor(() => {
            expect(approveProposal).toHaveBeenCalledWith(
                'proposal-legacy-shorts',
                expect.objectContaining({
                    contentProfileId: 'shorts.countryball.v1',
                    imageStyleId: 'countryball-comic',
                })
            );
        });
    });

    it('does not show image scene/style controls or send image options for longform proposals', async () => {
        const longformProposal: MessageProposal = {
            ...proposal,
            id: 'proposal-longform',
            blocks: [{ type: 'longform-source', label: '롱폼 자료 수집' }],
            metadata: {
                contentProfile: {
                    ...proposal.metadata?.contentProfile,
                    contentProfileId: 'longform.explainer.v1',
                    reviewMode: 'script-first',
                },
                imageGeneration: {
                    model: 'gpt-image-2',
                    sceneCount: 12,
                    styleOptions: [{ id: 'animation', label: '애니메이션' }],
                    sceneCountOptions: [{ count: 12, label: '12장' }],
                    qualityOptions: [{ id: 'high', label: '고품질', estimatedImageCostUsd: 1.2 }],
                },
            },
        };

        render(
            <FlowAgentPanel
                open
                onClose={() => undefined}
                flowId="flow-1"
                externalProposal={{
                    type: 'proposal.created',
                    id: 'proposal-created-longform',
                    proposalId: longformProposal.id,
                    flowId: 'flow-1',
                    blocks: longformProposal.blocks,
                    estimatedCost: longformProposal.estimatedCost,
                    metadata: longformProposal.metadata,
                    description: '롱폼 제안',
                    timestamp: Date.now(),
                }}
            />
        );

        expect(await screen.findByText('대본/콘텐츠 설정')).toBeTruthy();
        expect(screen.queryByText('이미지 설정')).toBeNull();
        expect(screen.queryByText('12장')).toBeNull();
        expect(screen.queryByText('애니메이션')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: '승인' }));

        await waitFor(() => {
            expect(approveProposal).toHaveBeenCalledWith(
                'proposal-longform',
                expect.not.objectContaining({
                    imageStyleId: expect.anything(),
                    imageQuality: expect.anything(),
                    sceneCount: expect.anything(),
                })
            );
        });
    });

    it('treats standalone image proposals as image settings, not script/content settings', async () => {
        const imageProposal: MessageProposal = {
            id: 'proposal-image',
            blocks: [
                { type: 'content', label: '이미지 프롬프트 구성' },
                { type: 'media-image', label: '이미지 생성' },
            ],
            estimatedCost: '$0.07',
            metadata: {
                contentProfile: {
                    contentProfileId: 'image.single.v1',
                    scriptToneId: 'informative-reframe',
                    scriptToneIntensity: 'medium',
                    reviewMode: 'direct-run',
                    toneOptions: [{ id: 'news-anchor', label: '뉴스앵커형', description: '뉴스처럼 전달' }],
                    intensityOptions: [{ id: 'medium', label: '표준', description: '표준 강도' }],
                    reviewModeOptions: [{ id: 'script-first', label: '대본 검수 후 실행', description: '검수' }],
                    profileOptions: [{ id: 'image.single.v1', label: '단일 이미지', description: '이미지' }],
                },
                imageGeneration: {
                    model: 'gpt-image-2',
                    format: 'single-image',
                    imageStyleId: 'explainer-comic',
                    imageQuality: 'medium',
                    sceneCount: 1,
                    styleOptions: [{ id: 'explainer-comic', label: '정보전달 만화' }],
                    sceneCountOptions: [{ count: 1, label: '1장' }],
                    qualityOptions: [{ id: 'medium', label: 'medium', estimatedImageCostUsd: 0.041 }],
                },
            },
        };

        render(
            <FlowAgentPanel
                open
                onClose={() => undefined}
                flowId="flow-1"
                externalProposal={{
                    type: 'proposal.created',
                    id: 'proposal-created-image',
                    proposalId: imageProposal.id,
                    flowId: 'flow-1',
                    blocks: imageProposal.blocks,
                    estimatedCost: imageProposal.estimatedCost,
                    metadata: imageProposal.metadata,
                    description: '단일 이미지 제안',
                    timestamp: Date.now(),
                }}
            />
        );

        expect(await screen.findByText('이미지 설정')).toBeTruthy();
        expect(screen.getByText(/이미지 수/)).toBeTruthy();
        expect(screen.queryByText('대본/콘텐츠 설정')).toBeNull();
        expect(screen.queryByRole('button', { name: '8장' })).toBeNull();
        expect(screen.queryByRole('button', { name: '12장' })).toBeNull();
        expect(screen.queryByRole('button', { name: '16장' })).toBeNull();
        expect(screen.queryByRole('button', { name: '대본 검수 후 실행' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: '승인' }));

        await waitFor(() => {
            expect(approveProposal).toHaveBeenCalledWith(
                'proposal-image',
                expect.objectContaining({
                    contentProfileId: 'image.single.v1',
                    imageStyleId: 'explainer-comic',
                    imageQuality: 'medium',
                    sceneCount: 1,
                })
            );
        });
        const approvalOptions = vi.mocked(approveProposal).mock.calls[0]?.[1] as Record<string, unknown>;
        expect(approvalOptions['scriptToneId']).toBeUndefined();
        expect(approvalOptions['reviewMode']).toBeUndefined();
    });

    it('replaces chat history when the active flow changes', async () => {
        vi.mocked(getFlowMessages).mockImplementation(async flowId => [
            {
                id: `${flowId}-message`,
                role: 'agent',
                content: flowId === 'flow-1' ? '첫 번째 플로우 기록' : '두 번째 플로우 기록',
                timestamp: Date.now(),
            },
        ]);

        const { rerender } = render(<FlowAgentPanel open onClose={() => undefined} flowId="flow-1" />);

        expect(await screen.findByText('첫 번째 플로우 기록')).toBeTruthy();

        rerender(<FlowAgentPanel open onClose={() => undefined} flowId="flow-2" />);

        expect(await screen.findByText('두 번째 플로우 기록')).toBeTruthy();
        expect(screen.queryByText('첫 번째 플로우 기록')).toBeNull();
    });

    it('shows script-review waiting state without marking the workflow completed', async () => {
        render(
            <FlowAgentPanel
                open
                onClose={() => undefined}
                flowId="flow-1"
                runStatus="reviewing"
                runActivity={{
                    state: 'reviewing',
                    nodeLabel: '대본 검수',
                    message: '대본 노드에서 검수본을 저장한 뒤 이어서 실행하세요.',
                }}
            />
        );

        expect(await screen.findByText('대본 검수 대기')).toBeTruthy();
        expect(screen.getByText(/현재 노드:/)).toBeTruthy();
        expect(screen.getByText('대본 검수')).toBeTruthy();
        expect(screen.getByText('대본 노드에서 검수본을 저장한 뒤 이어서 실행하세요.')).toBeTruthy();
        expect(screen.queryByText('워크플로우 실행 완료')).toBeNull();
    });

    it('shows recovery as an in-progress state immediately after clicking quality feedback retry', async () => {
        let resolveRecovery: (() => void) | undefined;
        const onRecoverAnalysisFailure = vi.fn(
            () =>
                new Promise<void>(resolve => {
                    resolveRecovery = resolve;
                })
        );

        render(
            <FlowAgentPanel
                open
                onClose={() => undefined}
                flowId="flow-1"
                runStatus="failed"
                runActivity={{
                    state: 'failed',
                    runId: 'run-1',
                    nodeId: 'node-analysis',
                    nodeLabel: '사실성 및 형식 검수',
                    errorCode: 'ANALYSIS_REJECTED',
                    error: 'Analysis rejected content: 요청한 핵심 주제가 충분히 반영되지 않았습니다.',
                    message: '워크플로우 실행이 실패했습니다.',
                    progress: 100,
                }}
                onRecoverAnalysisFailure={onRecoverAnalysisFailure}
            />
        );

        expect(await screen.findByText('워크플로우 실행 실패')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: /피드백 반영해 다시 생성/ }));

        await waitFor(() => {
            expect(onRecoverAnalysisFailure).toHaveBeenCalledWith('run-1', 'node-analysis');
            expect(screen.getByText('품질검수 피드백 반영 중')).toBeTruthy();
        });
        expect(screen.queryByText('워크플로우 실행 실패')).toBeNull();
        expect(screen.queryByText(/Analysis rejected content/)).toBeNull();

        resolveRecovery?.();
    });

    it('lets the user retry after a prior script recovery JSON failure', async () => {
        const onRecoverAnalysisFailure = vi.fn(async () => undefined);

        render(
            <FlowAgentPanel
                open
                onClose={() => undefined}
                flowId="flow-1"
                runStatus="failed"
                runActivity={{
                    state: 'failed',
                    runId: 'run-1',
                    nodeId: 'node-analysis',
                    nodeLabel: '사실성 및 형식 검수',
                    errorCode: 'ANALYSIS_RECOVERY_FAILED',
                    error: 'SCRIPT_RECOVERY_INVALID_JSON',
                    message: '워크플로우 실행이 실패했습니다.',
                    progress: 100,
                }}
                onRecoverAnalysisFailure={onRecoverAnalysisFailure}
            />
        );

        fireEvent.click(await screen.findByRole('button', { name: /피드백 반영해 다시 생성/ }));

        await waitFor(() => {
            expect(onRecoverAnalysisFailure).toHaveBeenCalledWith('run-1', 'node-analysis');
        });
    });

    it('keeps quality feedback recovery labeled after the parent switches the run back to running', async () => {
        render(
            <FlowAgentPanel
                open
                onClose={() => undefined}
                flowId="flow-1"
                runStatus="running"
                runActivity={{
                    state: 'running',
                    runId: 'run-1',
                    nodeId: 'node-analysis',
                    nodeLabel: '사실성 및 형식 검수',
                    message: '품질검수 피드백을 반영해 새 대본을 생성하고 있습니다.',
                    progress: 0,
                    recoveryType: 'analysis-feedback',
                }}
            />
        );

        expect(await screen.findByText('품질검수 피드백 반영 중')).toBeTruthy();
        expect(screen.queryByText('워크플로우 실행 실패')).toBeNull();
        expect(screen.queryByText('워크플로우 실행 중')).toBeNull();
    });
});
