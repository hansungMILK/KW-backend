import { beforeEach, describe, expect, it, vi } from 'vitest';

import { openaiOrchestrator } from './openai-orchestrator';
import { openaiAdapter } from '../../adapters/ai/openai-adapter';
import { DEFAULT_WORKFLOW_PACK_REGISTRY } from '../workflow-packs';

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
        strategy: '공식 자료와 업계 맥락을 분리해 설명한다',
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
    contentJudgment: {
        primaryTask: 'explain',
        sourcePolicy: 'url-primary',
        scriptToneId: 'news-anchor',
        whyThisTone: '확인된 사실과 전망을 분리해야 하는 주제다',
    },
    productionJudgment: {
        rendererRoute: 'hyperframes',
        requiresUserReview: true,
        paidMediaAfterReview: true,
    },
    assumptions: ['AI가 고른 전략을 노드 config에 보존한다'],
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

    it('converts longform model output into a user-facing production flow with paid media blocked until review', async () => {
        const proposal = await openaiOrchestrator.generateProposal(
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

        expect(proposal.metadata?.['contentProfile']).toEqual(
            expect.objectContaining({
                contentProfileId: 'longform.explainer.v1',
                scriptToneId: 'news-anchor',
                reviewMode: 'script-first',
            })
        );
        expect(proposal.proposedNodes).toContainEqual(
            expect.objectContaining({
                blockType: 'longform-source',
                config: expect.objectContaining({
                    orchestratorSourcePolicy: 'url-primary',
                    orchestratorPrimaryTask: 'explain',
                    orchestratorStrategy: '공식 자료와 업계 맥락을 분리해 설명한다',
                }),
            })
        );
        expect(proposal.proposedNodes).toContainEqual(
            expect.objectContaining({
                blockType: 'longform-scene-json',
                config: expect.objectContaining({
                    mode: 'longform-gate-a',
                    renderer: 'hyperframes',
                    rendererRoute: 'hyperframes',
                }),
            })
        );
        expect(proposal.proposedNodes).toContainEqual(
            expect.objectContaining({
                blockType: 'longform-review',
                config: expect.objectContaining({
                    mode: 'longform-gate-a',
                    contentProfileId: 'longform.explainer.v1',
                    reviewMode: 'script-first',
                    mediaExecutionAllowed: false,
                }),
            })
        );
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
        expect(proposal.assistantMessage).not.toMatch(/Gate [AB]|게이트/i);
        expect(proposal.proposedNodes.map(node => node.label).join(' ')).not.toMatch(/Gate [AB]|게이트/i);
        expect(openaiAdapter.chatJson).toHaveBeenCalledWith(
            expect.objectContaining({
                model: 'gpt-test',
                systemPrompt: expect.stringContaining('longform workflow planner'),
                userMessage: expect.stringContaining('AI 에이전트의 미래'),
            })
        );
        expect(proposal.metadata?.['aiOrchestratorDecision']).toEqual(
            expect.objectContaining({
                plan: expect.objectContaining({
                    goal: 'AI 에이전트의 미래 롱폼 영상을 만든다',
                }),
            })
        );
    });

    it('uses OpenAI only for compact longform intent judgment, not the executable graph JSON', async () => {
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

        expect(proposal.proposedNodes.map(node => node.blockType)).toEqual([
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
        expect(proposal.assistantMessage).toContain('롱폼 제작 기획');
        expect(proposal.assistantMessage).not.toMatch(/Gate [AB]|게이트/i);
        expect(proposal.approvalRequired).toBe(true);
        expect(openaiAdapter.chatJson).toHaveBeenCalledWith(
            expect.objectContaining({
                maxTokens: 1200,
                systemPrompt: expect.stringContaining('Do not return executable workflow nodes'),
            })
        );
    });

    it('uses a standalone image recipe for explicit image generation requests without adding video blocks', async () => {
        const proposal = await openaiOrchestrator.generateProposal('flow-image', '바나나가 춤추는 이미지 생성해줘');
        const recipe = DEFAULT_WORKFLOW_PACK_REGISTRY.getRecipe('image.single.v1');

        expect(proposal.proposedNodes.map(node => node.blockType)).toEqual(
            recipe?.defaultBlocks.map(block => block.blockType)
        );
        expect(proposal.proposedEdges).toHaveLength(1);
        expect(proposal.proposedNodes).toContainEqual(
            expect.objectContaining({
                blockType: 'media-image',
                config: expect.objectContaining({
                    count: 1,
                    imageModel: 'gpt-image-2',
                }),
            })
        );
        expect(proposal.proposedNodes.map(node => node.blockType)).not.toContain('media-video');
        expect(proposal.metadata?.['contentProfile']).toEqual(
            expect.objectContaining({ contentProfileId: 'image.single.v1' })
        );
        expect(openaiAdapter.chatJson).not.toHaveBeenCalled();
    });

    it('uses a text writing recipe for blog article requests without adding media blocks', async () => {
        const proposal = await openaiOrchestrator.generateProposal(
            'flow-blog',
            '블로그에 쓸 글 생성해줘. 주제는 토트넘 강등 위기'
        );
        const recipe = DEFAULT_WORKFLOW_PACK_REGISTRY.getRecipe('text.blog.v1');

        expect(proposal.proposedNodes.map(node => node.blockType)).toEqual(
            recipe?.defaultBlocks.map(block => block.blockType)
        );
        expect(proposal.proposedNodes.map(node => node.blockType)).not.toContain('media-image');
        expect(proposal.proposedNodes.map(node => node.blockType)).not.toContain('media-tts');
        expect(proposal.proposedNodes.map(node => node.blockType)).not.toContain('media-video');
        expect(proposal.metadata?.['contentProfile']).toEqual(
            expect.objectContaining({ contentProfileId: 'text.explainer.v1' })
        );
        expect(openaiAdapter.chatJson).not.toHaveBeenCalled();
    });

    it('uses URL collection plus text writing for URL explanation requests without video blocks', async () => {
        const proposal = await openaiOrchestrator.generateProposal(
            'flow-url-text',
            '이 링크 내용 설명해줘 https://example.com/article'
        );
        const recipe = DEFAULT_WORKFLOW_PACK_REGISTRY.getRecipe('text.url-explainer.v1');

        expect(proposal.proposedNodes.map(node => node.blockType)).toEqual(
            recipe?.defaultBlocks.map(block => block.blockType)
        );
        expect(proposal.proposedNodes[0]).toEqual(
            expect.objectContaining({
                blockType: 'search',
                config: expect.objectContaining({
                    query: '이 링크 내용 설명해줘 https://example.com/article',
                }),
            })
        );
        expect(proposal.proposedNodes.map(node => node.blockType)).not.toContain('media-video');
        expect(openaiAdapter.chatJson).not.toHaveBeenCalled();
    });
});
