import { beforeEach, describe, expect, it, vi } from 'vitest';

import { claudeOrchestrator } from './claude-orchestrator';
import { claudeAdapter } from '../../adapters/ai/claude-adapter';

vi.mock('../../config/env', () => ({
    env: {
        anthropicDefaultModel: 'claude-test',
        openaiImageQuality: 'medium',
    },
}));

vi.mock('../../adapters/ai/claude-adapter', () => ({
    claudeAdapter: {
        chat: vi.fn(),
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
    ],
    edges: [
        { from: 0, to: 1 },
        { from: 1, to: 2 },
        { from: 2, to: 3 },
        { from: 3, to: 4 },
        { from: 3, to: 5 },
        { from: 4, to: 6 },
        { from: 5, to: 6 },
    ],
    estimatedCostUsd: 2.3,
    summary: '롱폼 영상 제작 파이프라인을 제안합니다.',
};

describe('claudeOrchestrator longform Gate A', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(claudeAdapter.chat).mockResolvedValue({
            content: JSON.stringify(paidVideoPlan),
            model: 'claude-test',
            inputTokens: 1,
            outputTokens: 1,
            latencyMs: 1,
            stopReason: 'stop_sequence',
        });
    });

    it('converts longform model output into a full longform flow with paid media blocked until review', async () => {
        const proposal = await claudeOrchestrator.generateProposal(
            'flow-1',
            '롱폼 제작해줘. 주제는 AI 에이전트의 미래'
        );

        const blockTypes = proposal.proposedNodes.map(node => node.blockType);
        expect(blockTypes).toEqual([
            'longform-source',
            'longform-brief',
            'longform-script',
            'longform-storyboard',
            'longform-scene-json',
            'longform-review',
            'longform-tts',
            'longform-srt-align',
            'longform-motion-compose',
            'longform-render',
            'longform-qa',
            'longform-package',
        ]);
        expect(blockTypes).not.toContain('media-image');
        expect(blockTypes).not.toContain('media-tts');
        expect(blockTypes).not.toContain('media-video');
        expect(proposal.proposedNodes).toContainEqual(
            expect.objectContaining({
                blockType: 'longform-render',
                config: expect.objectContaining({
                    mode: 'longform-gate-b',
                    rendererRoute: 'hyperframes',
                    mediaExecutionAllowed: false,
                }),
            })
        );
        expect(proposal.estimatedCost.total).toBeLessThan(2);
        expect(proposal.assistantMessage).toContain('롱폼 제작 기획');
    });
});
