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

const genericDecision = (
    recipeId:
        | 'image.single.v1'
        | 'text.blog.v1'
        | 'text.url-explainer.v1'
        | 'shorts.info.v1'
        | 'longform.explainer.v1'
        | null,
    userMessage: string
) => ({
    intent:
        recipeId === 'image.single.v1'
            ? 'single-image'
            : recipeId === 'text.blog.v1'
              ? 'blog-post'
              : recipeId === 'text.url-explainer.v1'
                ? 'url-explainer'
                : recipeId === 'shorts.info.v1'
                  ? 'shorts'
                  : recipeId === 'longform.explainer.v1'
                    ? 'longform'
                    : 'custom',
    recipeId,
    outputKind:
        recipeId === 'image.single.v1'
            ? 'image'
            : recipeId === 'text.blog.v1' || recipeId === 'text.url-explainer.v1'
              ? 'text'
              : recipeId === 'shorts.info.v1' || recipeId === 'longform.explainer.v1'
                ? 'video'
                : 'unknown',
    mode: recipeId === 'shorts.info.v1' ? 'informational' : 'unknown',
    needsSearch: recipeId === 'shorts.info.v1' || recipeId === 'text.url-explainer.v1',
    needsScript: recipeId === 'shorts.info.v1' || recipeId === 'longform.explainer.v1',
    needsImagePrompt: recipeId === 'image.single.v1' || recipeId === 'shorts.info.v1',
    scriptToneId: 'informative-reframe',
    reason: 'AI planner가 요청에 맞는 레시피를 선택했습니다.',
    confidence: 0.94,
    understanding: {
        surfaceTerms: [userMessage],
        focusEntities: [userMessage],
        actions: [],
        constraints: [],
        styleHints: [],
    },
});

function inferGenericRecipeId(userMessage: string) {
    if (/롱폼|longform|긴\s*영상/.test(userMessage)) return 'longform.explainer.v1' as const;
    if (/쇼츠|shorts|릴스|reels|틱톡|tiktok/.test(userMessage)) return 'shorts.info.v1' as const;
    if (/이미지|사진|그림|그려|draw|image/i.test(userMessage)) return 'image.single.v1' as const;
    if (/https?:\/\//i.test(userMessage) && /설명|요약|정리|분석|해설|읽어/.test(userMessage)) {
        return 'text.url-explainer.v1' as const;
    }
    if (/블로그|홍보글|소개글|대본|본문|문서|아티클|포스트|글|써|작성|write/i.test(userMessage)) {
        return 'text.blog.v1' as const;
    }
    return null;
}

function mockPlannerResponses(longformDecision = paidVideoPlan) {
    vi.mocked(openaiAdapter.chatJson).mockImplementation(async request => {
        if (request.systemPrompt.includes('request intent and recipe planner')) {
            const userMessage =
                request.userMessage.match(/USER_REQUEST:\n([\s\S]*?)(?:\n\nCURRENT_CONTEXT:|$)/)?.[1] ?? '';
            return {
                content: JSON.stringify(genericDecision(inferGenericRecipeId(userMessage), userMessage)),
                model: 'gpt-test',
                inputTokens: 1,
                outputTokens: 1,
                latencyMs: 1,
            };
        }
        return {
            content: JSON.stringify(longformDecision),
            model: 'gpt-test',
            inputTokens: 1,
            outputTokens: 1,
            latencyMs: 1,
        };
    });
}

function expectGenericPlannerCalled() {
    expect(openaiAdapter.chatJson).toHaveBeenCalledWith(
        expect.objectContaining({
            model: 'gpt-test',
            systemPrompt: expect.stringContaining('request intent and recipe planner'),
        })
    );
}

describe('openaiOrchestrator longform Gate A', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockPlannerResponses();
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
        mockPlannerResponses({
            ...paidVideoPlan,
            edges: [
                { from: 0, to: 1 },
                { from: 1, to: 6 },
            ],
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
        expect(proposal.metadata?.['imageGeneration']).toEqual(
            expect.objectContaining({
                format: 'single-image',
                sceneCount: 1,
                sceneCountOptions: [{ count: 1, label: '1장' }],
            })
        );
        expectGenericPlannerCalled();
    });

    it('routes draw-action requests to the standalone image recipe without asking for prompt advice', async () => {
        const proposal = await openaiOrchestrator.generateProposal(
            'flow-draw-image',
            '우주 고래가 도시 위를 나는 상황을 그려줘'
        );
        const recipe = DEFAULT_WORKFLOW_PACK_REGISTRY.getRecipe('image.single.v1');

        expect(proposal.proposedNodes.map(node => node.blockType)).toEqual(
            recipe?.defaultBlocks.map(block => block.blockType)
        );
        expect(proposal.proposedNodes.map(node => node.blockType)).toContain('media-image');
        expect(proposal.proposedNodes.map(node => node.blockType)).not.toContain('media-video');
        expect(proposal.metadata?.['contentProfile']).toEqual(
            expect.objectContaining({ contentProfileId: 'image.single.v1' })
        );
        expect(proposal.assistantMessage).toContain('이미지');
        expectGenericPlannerCalled();
    });

    it('trusts the AI recipe decision for ambiguous visual production language instead of local keyword parsing', async () => {
        vi.mocked(openaiAdapter.chatJson).mockImplementation(async request => {
            if (request.systemPrompt.includes('request intent and recipe planner')) {
                return {
                    content: JSON.stringify(
                        genericDecision(
                            'image.single.v1',
                            '나루토와 주술회전 캐릭터들이 한곳에 모인 전투 포스터 느낌으로 연출해줘'
                        )
                    ),
                    model: 'gpt-test',
                    inputTokens: 1,
                    outputTokens: 1,
                    latencyMs: 1,
                };
            }
            throw new Error('full workflow planner should not be called for an AI-selected known recipe');
        });

        const proposal = await openaiOrchestrator.generateProposal(
            'flow-ai-routed-image',
            '나루토와 주술회전 캐릭터들이 한곳에 모인 전투 포스터 느낌으로 연출해줘'
        );

        expect(proposal.proposedNodes.map(node => node.blockType)).toEqual(
            DEFAULT_WORKFLOW_PACK_REGISTRY.getRecipe('image.single.v1')?.defaultBlocks.map(block => block.blockType)
        );
        expect(proposal.metadata?.['aiRequestDecision']).toEqual(
            expect.objectContaining({
                recipeId: 'image.single.v1',
                intent: 'single-image',
            })
        );
    });

    it('carries AI creative-simulation mode into the shorts request contract instead of only showing a tone choice', async () => {
        vi.mocked(openaiAdapter.chatJson).mockImplementation(async request => {
            if (request.systemPrompt.includes('request intent and recipe planner')) {
                return {
                    content: JSON.stringify({
                        ...genericDecision('shorts.info.v1', '고죠사토루와 나루토가 대결하는 장면을 쇼츠로 만들어줘'),
                        mode: 'creative-simulation',
                        reason: '가상 대결을 장면 단위로 시뮬레이션하는 쇼츠 요청입니다.',
                        understanding: {
                            surfaceTerms: ['고죠사토루와 나루토 대결'],
                            focusEntities: ['고죠사토루', '나루토'],
                            actions: ['대결', '풀전력 전투'],
                            constraints: ['쇼츠', '가상 시뮬레이션'],
                            styleHints: [],
                        },
                    }),
                    model: 'gpt-test',
                    inputTokens: 1,
                    outputTokens: 1,
                    latencyMs: 1,
                };
            }
            throw new Error('full workflow planner should not be called for an AI-selected shorts recipe');
        });

        const proposal = await openaiOrchestrator.generateProposal(
            'flow-simulation-shorts',
            '고죠사토루와 나루토가 대결하는 장면을 쇼츠로 만들어줘'
        );
        const contentNode = proposal.proposedNodes.find(node => node.blockType === 'content');
        const searchNode = proposal.proposedNodes.find(node => node.blockType === 'search');

        expect(proposal.assistantMessage).toContain('쇼츠 제작');
        expect(proposal.assistantMessage).not.toContain('정보전달 쇼츠');
        expect(proposal.metadata?.['aiRequestDecision']).toEqual(
            expect.objectContaining({ mode: 'creative-simulation' })
        );
        expect(contentNode?.config).toEqual(
            expect.objectContaining({
                requestMode: 'creative-simulation',
                requestSpec: expect.objectContaining({
                    contentMode: 'creative-simulation',
                    understanding: expect.objectContaining({
                        focusEntities: ['고죠사토루', '나루토'],
                    }),
                }),
            })
        );
        expect(searchNode?.config).toEqual(
            expect.objectContaining({
                requestSpec: expect.objectContaining({ contentMode: 'creative-simulation' }),
            })
        );
    });

    it('honors requested image count for image-only requests while capping unsafe batch sizes', async () => {
        const fourImages = await openaiOrchestrator.generateProposal('flow-four-images', '바나나 이미지 4장 생성해줘');
        const hugeBatch = await openaiOrchestrator.generateProposal(
            'flow-huge-images',
            '바나나 이미지 10,000장 생성해줘'
        );

        expect(fourImages.proposedNodes).toContainEqual(
            expect.objectContaining({
                blockType: 'media-image',
                config: expect.objectContaining({ count: 4 }),
            })
        );
        expect(fourImages.metadata?.['imageGeneration']).toEqual(
            expect.objectContaining({
                format: 'single-image',
                sceneCount: 4,
                sceneCountOptions: [{ count: 4, label: '4장' }],
            })
        );
        expect(hugeBatch.proposedNodes).toContainEqual(
            expect.objectContaining({
                blockType: 'media-image',
                config: expect.objectContaining({ count: 24 }),
            })
        );
        expect(hugeBatch.metadata?.['imageGeneration']).toEqual(
            expect.objectContaining({
                format: 'single-image',
                sceneCount: 24,
                sceneCountOptions: [{ count: 24, label: '24장' }],
            })
        );
    });

    it('routes explicit countryball requests through dedicated blocks with AI scene count as the default', async () => {
        const proposal = await openaiOrchestrator.generateProposal(
            'flow-countryball',
            '컨트리볼 쇼츠 만들어줘. 상대국이 주인공 국가볼의 특징을 무시하다가 직접 보고 태세 전환하는 플롯.'
        );

        expect(proposal.proposedNodes.map(node => node.blockType)).toEqual([
            'search',
            'countryball-brief',
            'countryball-script',
            'countryball-data',
            'countryball-analysis',
            'countryball-image',
            'countryball-tts',
            'countryball-video',
            'integration',
        ]);
        expect(proposal.proposedNodes.map(node => node.blockType)).not.toContain('content');
        expect(proposal.proposedNodes.map(node => node.blockType)).not.toContain('media-image');

        const scriptNode = proposal.proposedNodes.find(node => node.blockType === 'countryball-script');
        const imageNode = proposal.proposedNodes.find(node => node.blockType === 'countryball-image');
        expect(scriptNode?.config).toEqual(
            expect.objectContaining({
                topic: expect.stringContaining('컨트리볼 쇼츠'),
            })
        );
        expect(scriptNode?.config).not.toHaveProperty('scenes');
        expect(imageNode?.config).toEqual(
            expect.objectContaining({
                imageStyleId: 'countryball-comic',
            })
        );
        expect(imageNode?.config).not.toHaveProperty('count');
        expect(proposal.metadata?.['imageGeneration']).toEqual(
            expect.objectContaining({
                sceneCountSelectionMode: 'ai-recommended',
                sceneCount: 12,
                imageStyleId: 'countryball-comic',
            })
        );
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
        expectGenericPlannerCalled();
    });

    it('prioritizes explicit writing intent over incidental video words', async () => {
        const proposal = await openaiOrchestrator.generateProposal(
            'flow-blog-video-copy',
            '주술회전 홍보 하는 블로그 영상 글 쓸려고 하는데 글 만들어 줘'
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
        expectGenericPlannerCalled();
    });

    it('keeps platform or video-topic words as text when the requested output is writing', async () => {
        const proposal = await openaiOrchestrator.generateProposal('flow-youtube-copy', '주술회전 유튜브 홍보글 써줘');
        const recipe = DEFAULT_WORKFLOW_PACK_REGISTRY.getRecipe('text.blog.v1');

        expect(proposal.proposedNodes.map(node => node.blockType)).toEqual(
            recipe?.defaultBlocks.map(block => block.blockType)
        );
        expect(proposal.proposedNodes.map(node => node.blockType)).not.toContain('media-image');
        expect(proposal.proposedNodes.map(node => node.blockType)).not.toContain('media-tts');
        expect(proposal.proposedNodes.map(node => node.blockType)).not.toContain('media-video');
        expectGenericPlannerCalled();
    });

    it('treats standalone script writing as text unless a production recipe is requested', async () => {
        const proposal = await openaiOrchestrator.generateProposal(
            'flow-script-copy',
            '주술회전 회절옥절 소개 대본 써줘'
        );
        const recipe = DEFAULT_WORKFLOW_PACK_REGISTRY.getRecipe('text.blog.v1');

        expect(proposal.proposedNodes.map(node => node.blockType)).toEqual(
            recipe?.defaultBlocks.map(block => block.blockType)
        );
        expect(proposal.proposedNodes.map(node => node.blockType)).not.toContain('media-video');
        expectGenericPlannerCalled();
    });

    it('keeps image text composition requests on the image recipe instead of treating 글자 as blog writing', async () => {
        const proposal = await openaiOrchestrator.generateProposal(
            'flow-image-text',
            '주술회전 이미지에 큰 글자 넣어서 만들어줘'
        );
        const recipe = DEFAULT_WORKFLOW_PACK_REGISTRY.getRecipe('image.single.v1');

        expect(proposal.proposedNodes.map(node => node.blockType)).toEqual(
            recipe?.defaultBlocks.map(block => block.blockType)
        );
        expect(proposal.proposedNodes.map(node => node.blockType)).toContain('media-image');
        expect(proposal.proposedNodes.map(node => node.blockType)).not.toContain('media-video');
        expectGenericPlannerCalled();
    });

    it('does not downgrade explicit shortform production requests to text when writing words are present', async () => {
        const proposal = await openaiOrchestrator.generateProposal(
            'flow-shorts-writing',
            '주술회전 회절옥절 쇼츠 대본 글 만들어줘'
        );
        const recipe = DEFAULT_WORKFLOW_PACK_REGISTRY.getRecipe('shorts.info.v1');

        expect(proposal.proposedNodes.map(node => node.blockType)).toEqual(
            recipe?.defaultBlocks.map(block => block.blockType)
        );
        expect(proposal.proposedNodes.map(node => node.blockType)).toContain('integration');
        expect(proposal.metadata?.['contentProfile']).toEqual(
            expect.objectContaining({ contentProfileId: 'shorts.info.v1' })
        );
        expectGenericPlannerCalled();
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
        expectGenericPlannerCalled();
    });
});
