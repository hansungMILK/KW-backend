import { beforeEach, describe, expect, it, vi } from 'vitest';

import { openaiOrchestrator } from './openai-orchestrator';
import { openaiAdapter } from '../../adapters/ai/openai-adapter';
import { DEFAULT_WORKFLOW_PACK_REGISTRY } from '../workflow-packs';

// Standalone image generation (N<=12) routing tests. Filename contains "image" so
// the repo's targeted test gate (which filters by the "image" token) exercises them.

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

const imageDecision = (userMessage: string, focusEntities: string[]) => ({
    intent: 'single-image',
    recipeId: 'image.single.v1',
    outputKind: 'image',
    mode: 'unknown',
    needsSearch: false,
    needsScript: false,
    needsImagePrompt: true,
    scriptToneId: 'informative-reframe',
    reason: 'AI planner가 이미지 요청을 골랐습니다.',
    confidence: 0.95,
    understanding: {
        surfaceTerms: [userMessage],
        focusEntities,
        actions: [],
        constraints: [],
        styleHints: [],
    },
});

function mockImagePlanner(focusEntities: string[]) {
    vi.mocked(openaiAdapter.chatJson).mockImplementation(async request => {
        if (request.systemPrompt.includes('request intent and recipe planner')) {
            const userMessage =
                request.userMessage.match(/USER_REQUEST:\n([\s\S]*?)(?:\n\nCURRENT_CONTEXT:|$)/)?.[1] ?? '';
            return {
                content: JSON.stringify(imageDecision(userMessage, focusEntities)),
                model: 'gpt-test',
                inputTokens: 1,
                outputTokens: 1,
                latencyMs: 1,
            };
        }
        throw new Error('full workflow planner should not be called for an AI-selected image recipe');
    });
}

function findConfig(
    proposal: Awaited<ReturnType<typeof openaiOrchestrator.generateProposal>>,
    blockType: string
): Record<string, unknown> | undefined {
    return proposal.proposedNodes.find(node => node.blockType === blockType)?.config;
}

describe('openaiOrchestrator standalone image generation (N<=12)', () => {
    beforeEach(() => {
        idState.next = 0;
        vi.clearAllMocks();
    });

    it('keeps single-image mode and one scene for a plain single image request', async () => {
        mockImagePlanner(['바나나']);
        const proposal = await openaiOrchestrator.generateProposal('flow-single', '바나나 이미지 생성해줘');

        expect(proposal.proposedNodes.map(node => node.blockType)).toEqual(
            DEFAULT_WORKFLOW_PACK_REGISTRY.getRecipe('image.single.v1')?.defaultBlocks.map(block => block.blockType)
        );
        expect(findConfig(proposal, 'content')).toEqual(
            expect.objectContaining({ mode: 'single-image', scenes: 1, needsImagePrompt: true })
        );
        expect(findConfig(proposal, 'media-image')).toEqual(
            expect.objectContaining({ count: 1, style: 'single-image' })
        );
        expect(proposal.metadata?.['imageGeneration']).toEqual(
            expect.objectContaining({
                format: 'single-image',
                sceneCount: 1,
                sceneCountOptions: [{ count: 1, label: '1장' }],
            })
        );
    });

    it('honors an explicit count and drives the N-scene path without single-image mode', async () => {
        mockImagePlanner(['에펠타워']);
        const proposal = await openaiOrchestrator.generateProposal('flow-four', '에펠타워 이미지 4장 생성해줘');

        const contentConfig = findConfig(proposal, 'content');
        expect(contentConfig).not.toHaveProperty('mode', 'single-image');
        expect(contentConfig).toEqual(expect.objectContaining({ scenes: 4, needsImagePrompt: true }));
        expect(findConfig(proposal, 'media-image')).toEqual(
            expect.objectContaining({ count: 4, style: 'single-image' })
        );
        expect(proposal.metadata?.['imageGeneration']).toEqual(
            expect.objectContaining({
                format: 'single-image',
                sceneCount: 4,
                sceneCountOptions: [{ count: 4, label: '4장' }],
            })
        );
    });

    it('generates one image per subject for multi-subject requests', async () => {
        const userMessage = '63빌딩, 에펠타워 이미지 생성해줘';
        mockImagePlanner(['63빌딩', '에펠타워']);
        const proposal = await openaiOrchestrator.generateProposal('flow-multi-subject', userMessage);

        expect(findConfig(proposal, 'content')).not.toHaveProperty('mode', 'single-image');
        expect(findConfig(proposal, 'content')).toEqual(expect.objectContaining({ scenes: 2 }));
        expect(findConfig(proposal, 'media-image')).toEqual(
            expect.objectContaining({ count: 2, style: 'single-image' })
        );
        expect(proposal.metadata?.['imageGeneration']).toEqual(
            expect.objectContaining({
                format: 'single-image',
                sceneCount: 2,
                sceneCountOptions: [{ count: 2, label: '2장' }],
            })
        );
        expect(proposal.proposedNodes.map(node => node.blockType)).not.toContain('media-video');
    });

    it('counts comma-separated subjects from the message when the planner returns no distinct entities', async () => {
        // "63빌딩, 에펠타워 두장 이미지 생성해줘" → 2 (one per subject). Forces the
        // splitImageSubjects fallback by giving the planner no usable focusEntities,
        // mirroring the planner's tendency to return the whole message as one blob.
        const userMessage = '63빌딩, 에펠타워 두장 이미지 생성해줘';
        mockImagePlanner([userMessage]);
        const proposal = await openaiOrchestrator.generateProposal('flow-comma-subjects', userMessage);

        expect(findConfig(proposal, 'content')).not.toHaveProperty('mode', 'single-image');
        expect(findConfig(proposal, 'media-image')).toEqual(
            expect.objectContaining({ count: 2, style: 'single-image' })
        );
        expect(proposal.metadata?.['imageGeneration']).toEqual(expect.objectContaining({ sceneCount: 2 }));
    });

    it('lets the subject count win when an explicit count is smaller', async () => {
        const userMessage = '63빌딩, 에펠타워, 남산타워 이미지 1장 생성해줘';
        mockImagePlanner(['63빌딩', '에펠타워', '남산타워']);
        const proposal = await openaiOrchestrator.generateProposal('flow-count-below', userMessage);

        expect(findConfig(proposal, 'media-image')).toEqual(expect.objectContaining({ count: 3 }));
        expect(proposal.metadata?.['imageGeneration']).toEqual(expect.objectContaining({ sceneCount: 3 }));
    });

    it('clamps the standalone image batch to 12 even for very large requests', async () => {
        mockImagePlanner(['바나나']);
        const proposal = await openaiOrchestrator.generateProposal('flow-huge', '바나나 이미지 10,000장 생성해줘');

        expect(findConfig(proposal, 'media-image')).toEqual(expect.objectContaining({ count: 12 }));
        expect(proposal.metadata?.['imageGeneration']).toEqual(
            expect.objectContaining({
                format: 'single-image',
                sceneCount: 12,
                sceneCountOptions: [{ count: 12, label: '12장' }],
            })
        );
    });

    it('passes aspect-ratio options through to the media-image config', async () => {
        mockImagePlanner(['에펠타워']);
        const proposal = await openaiOrchestrator.generateProposal(
            'flow-options',
            '에펠타워 이미지 4장 16:9 비율로 생성해줘'
        );

        expect(findConfig(proposal, 'media-image')).toEqual(
            expect.objectContaining({ count: 4, style: 'single-image', aspectRatio: '16:9' })
        );
    });
});
