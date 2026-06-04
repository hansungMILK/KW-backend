import { beforeEach, describe, expect, it, vi } from 'vitest';

import { openaiOrchestrator } from './openai-orchestrator';
import { openaiAdapter } from '../../adapters/ai/openai-adapter';
import { DEFAULT_WORKFLOW_PACK_REGISTRY } from '../workflow-packs';

// Blog v2 routing tests. Filename contains "blog" so the repo's targeted test gate (which
// filters by the "blog" token) exercises them. These mock the planner to return text.blog.v2
// directly, mirroring the isolated pattern in openai-orchestrator-image.spec.ts so the shared
// decision helper in openai-orchestrator.spec.ts stays untouched (v1 path preserved there).

const idState = vi.hoisted(() => ({ next: 0 }));

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
    generateNumericId: vi.fn(() => `node-id-${++idState.next}`),
}));

const blogDecision = (userMessage: string, includeImages: boolean) => ({
    intent: 'blog-post',
    recipeId: 'text.blog.v2',
    outputKind: 'text',
    mode: 'unknown',
    needsSearch: false,
    needsScript: false,
    needsImagePrompt: includeImages,
    scriptToneId: 'informative-reframe',
    reason: 'AI planner가 네이버 블로그 완성형을 골랐습니다.',
    confidence: 0.95,
    understanding: {
        surfaceTerms: [userMessage],
        focusEntities: [userMessage],
        actions: [],
        constraints: [],
        styleHints: [],
    },
});

function mockBlogPlanner(includeImages: boolean) {
    vi.mocked(openaiAdapter.chatJson).mockImplementation(async request => {
        if (request.systemPrompt.includes('request intent and recipe planner')) {
            const userMessage =
                request.userMessage.match(/USER_REQUEST:\n([\s\S]*?)(?:\n\nCURRENT_CONTEXT:|$)/)?.[1] ?? '';
            return {
                content: JSON.stringify(blogDecision(userMessage, includeImages)),
                model: 'gpt-test',
                inputTokens: 1,
                outputTokens: 1,
                latencyMs: 1,
            };
        }
        throw new Error('full workflow planner should not be called for an AI-selected blog v2 recipe');
    });
}

function findConfig(
    proposal: Awaited<ReturnType<typeof openaiOrchestrator.generateProposal>>,
    blockType: string
): Record<string, unknown> | undefined {
    return proposal.proposedNodes.find(node => node.blockType === blockType)?.config;
}

describe('openaiOrchestrator blog v2 routing', () => {
    beforeEach(() => {
        idState.next = 0;
        vi.clearAllMocks();
    });

    it('routes a blog request to the text.blog.v2 pipeline (9 blog blocks, no video)', async () => {
        mockBlogPlanner(false);
        const proposal = await openaiOrchestrator.generateProposal('flow-blog-v2', '새벽배송 블로그 글 써줘');

        expect(proposal.proposedNodes.map(node => node.blockType)).toEqual(
            DEFAULT_WORKFLOW_PACK_REGISTRY.getRecipe('text.blog.v2')?.defaultBlocks.map(block => block.blockType)
        );
        expect(proposal.proposedNodes.map(node => node.blockType)).not.toContain('media-video');
        expect(proposal.proposedNodes.map(node => node.blockType)).not.toContain('content');
        // includeImages off by default → image-plan/images receive includeImages:false.
        expect(findConfig(proposal, 'blog-image-plan')).toEqual(expect.objectContaining({ includeImages: false }));
        expect(findConfig(proposal, 'blog-images')).toEqual(expect.objectContaining({ includeImages: false }));
    });

    it('toggles includeImages on when the request asks for images too', async () => {
        mockBlogPlanner(true);
        const proposal = await openaiOrchestrator.generateProposal(
            'flow-blog-v2-images',
            '새벽배송 블로그 글 써주고 이미지도 넣어줘'
        );

        expect(proposal.proposedNodes.map(node => node.blockType)).toEqual(
            DEFAULT_WORKFLOW_PACK_REGISTRY.getRecipe('text.blog.v2')?.defaultBlocks.map(block => block.blockType)
        );
        expect(findConfig(proposal, 'blog-image-plan')).toEqual(expect.objectContaining({ includeImages: true }));
        expect(findConfig(proposal, 'blog-images')).toEqual(expect.objectContaining({ includeImages: true }));
    });
});
