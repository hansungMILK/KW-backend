import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type MessageProposal, approveProposal } from '@flows/flows';

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
                { id: 'shorts.info.v1', label: '정보전달 쇼츠', description: '쇼츠' },
                { id: 'longform.explainer.v1', label: '롱폼 해설', description: '롱폼' },
            ],
        },
    },
};

describe('FlowAgentPanel proposal content profile controls', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Element.prototype.scrollIntoView = vi.fn();
    });

    it('lets the user choose script tone, intensity, review mode, and content profile before approval', async () => {
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

        fireEvent.click(screen.getByRole('button', { name: '뉴스앵커형' }));
        fireEvent.click(screen.getByRole('button', { name: '강하게' }));
        fireEvent.click(screen.getByRole('button', { name: '대본 검수 후 실행' }));
        fireEvent.click(screen.getByRole('button', { name: '롱폼 해설' }));
        fireEvent.click(screen.getByRole('button', { name: '승인' }));

        await waitFor(() => {
            expect(approveProposal).toHaveBeenCalledWith(
                'proposal-1',
                expect.objectContaining({
                    scriptToneId: 'news-anchor',
                    scriptToneIntensity: 'high',
                    reviewMode: 'script-first',
                    contentProfileId: 'longform.explainer.v1',
                })
            );
        });
    });
});
