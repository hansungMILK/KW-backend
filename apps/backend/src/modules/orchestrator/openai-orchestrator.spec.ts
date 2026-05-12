import { beforeEach, describe, expect, it, vi } from 'vitest';

import { openaiOrchestrator } from './openai-orchestrator';
import { openaiAdapter } from '../../adapters/ai/openai-adapter';

vi.mock('../../config/env', () => ({
    env: {
        openaiOrchestratorModel: 'gpt-test',
        openaiImageQuality: 'medium',
    },
}));

vi.mock('../../adapters/ai/openai-adapter', () => ({
    openaiAdapter: {
        chatJson: vi.fn(),
    },
}));

vi.mock('../../services/trace-service', () => ({
    traceService: {
        record: vi.fn(async () => undefined),
    },
}));

vi.mock('../../utils/id-generator', () => ({
    generateNumericId: vi.fn(() => 'node-id'),
}));

const paidVideoPlan = {
    plan: {
        goal: 'AI 에이전트의 미래 롱폼 영상을 만든다',
        outputType: 'video',
        planType: 'pipeline',
        requiredCapabilities: [
            'source.collect',
            'text.generate',
            'data.structure',
            'quality.review',
            'image.generate',
            'audio.tts',
            'video.compose',
        ],
        selectedBlocks: [
            { blockType: 'search', reason: '자료 수집' },
            { blockType: 'content', reason: '대본 작성' },
            { blockType: 'data', reason: '씬 구조화' },
            { blockType: 'analysis', reason: '품질 검수' },
            { blockType: 'media-image', reason: '이미지 생성' },
            { blockType: 'media-tts', reason: '음성 생성' },
            { blockType: 'media-video', reason: '영상 합성' },
            { blockType: 'integration', reason: '메타데이터 생성' },
        ],
        rejectedBlocks: [],
        assumptions: [],
    },
    blocks: [
        { type: 'search', label: '자료 수집', config: {} },
        { type: 'content', label: '대본 작성', config: { scenes: 8 } },
        { type: 'data', label: '씬 구조화', config: {} },
        { type: 'analysis', label: '품질 검수', config: {} },
        { type: 'media-image', label: '이미지 생성', config: { count: 8 } },
        { type: 'media-tts', label: '음성 생성', config: {} },
        { type: 'media-video', label: '영상 합성', config: { renderer: 'hyperframes' } },
        { type: 'integration', label: '메타데이터 생성', config: {} },
    ],
    edges: [
        { from: 0, to: 1 },
        { from: 1, to: 2 },
        { from: 2, to: 3 },
        { from: 3, to: 4 },
        { from: 3, to: 5 },
        { from: 4, to: 6 },
        { from: 5, to: 6 },
        { from: 6, to: 7 },
    ],
    estimatedCostUsd: 2.3,
    summary: '롱폼 영상 제작 파이프라인을 제안합니다.',
};

describe('openaiOrchestrator longform Gate A', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(openaiAdapter.chatJson).mockResolvedValue({
            content: JSON.stringify(paidVideoPlan),
            model: 'gpt-test',
            inputTokens: 1,
            outputTokens: 1,
            latencyMs: 1,
        });
    });

    it('converts longform model output into user-facing planning blocks before paid media execution', async () => {
        const proposal = await openaiOrchestrator.generateProposal(
            'flow-1',
            '롱폼 제작해줘. 주제는 AI 에이전트의 미래'
        );

        const blockTypes = proposal.proposedNodes.map(node => node.blockType);
        expect(blockTypes).toEqual(['search', 'content', 'data', 'analysis']);
        expect(blockTypes).not.toContain('media-image');
        expect(blockTypes).not.toContain('media-tts');
        expect(blockTypes).not.toContain('media-video');

        expect(proposal.metadata?.['contentProfile']).toEqual(
            expect.objectContaining({
                contentProfileId: 'longform.explainer.v1',
                reviewMode: 'script-first',
            })
        );
        expect(proposal.proposedNodes).toContainEqual(
            expect.objectContaining({
                blockType: 'content',
                config: expect.objectContaining({
                    mode: 'longform-gate-a',
                    rendererRoute: 'hyperframes',
                    mediaExecutionAllowed: false,
                }),
            })
        );
        expect(proposal.estimatedCost.total).toBeLessThan(0.5);
        expect(proposal.assistantMessage).toContain('롱폼 제작 기획');
        expect(proposal.assistantMessage).not.toMatch(/Gate [AB]|게이트/i);
        expect(proposal.proposedNodes.map(node => node.label).join(' ')).not.toMatch(/Gate [AB]|게이트/i);
    });

    it('still converts longform requests to Gate A when the model returns an invalid paid-media DAG', async () => {
        vi.mocked(openaiAdapter.chatJson).mockResolvedValueOnce({
            content: JSON.stringify({
                ...paidVideoPlan,
                edges: [
                    { from: 0, to: 1 },
                    { from: 1, to: 6 },
                ],
            }),
            model: 'gpt-test',
            inputTokens: 1,
            outputTokens: 1,
            latencyMs: 1,
        });

        const proposal = await openaiOrchestrator.generateProposal(
            'flow-1',
            '롱폼 제작해줘. 주제는 AI 에이전트의 미래'
        );

        expect(proposal.proposedNodes.map(node => node.blockType)).toEqual(['search', 'content', 'data', 'analysis']);
        expect(proposal.assistantMessage).toContain('롱폼 제작 기획');
        expect(proposal.assistantMessage).not.toMatch(/Gate [AB]|게이트/i);
        expect(proposal.approvalRequired).toBe(true);
    });
});
