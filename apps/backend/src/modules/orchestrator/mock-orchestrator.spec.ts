import { describe, expect, it, vi } from 'vitest';

import { mockOrchestrator } from './mock-orchestrator';

vi.mock('../../utils/id-generator', () => ({
    generateNumericId: vi.fn(() => 'node-id'),
}));

describe('mockOrchestrator content profile proposal metadata', () => {
    it('attaches inferred content profile preferences to proposal metadata and runtime node config', async () => {
        const proposal = await mockOrchestrator.generateProposal(
            'flow-1',
            '뉴스앵커형으로 대본 검수 후 쇼츠 만들어줘. 주제는 최신 AI 뉴스.'
        );

        expect(proposal.metadata?.['contentProfile']).toEqual(
            expect.objectContaining({
                contentProfileId: 'shorts.info.v1',
                scriptToneId: 'news-anchor',
                scriptToneIntensity: 'medium',
                reviewMode: 'script-first',
            })
        );

        expect(proposal.proposedNodes).toContainEqual(
            expect.objectContaining({
                blockType: 'search',
                config: expect.objectContaining({
                    contentProfileId: 'shorts.info.v1',
                    reviewMode: 'script-first',
                }),
            })
        );
        expect(proposal.proposedNodes).toContainEqual(
            expect.objectContaining({
                blockType: 'content',
                config: expect.objectContaining({
                    contentProfileId: 'shorts.info.v1',
                    scriptToneId: 'news-anchor',
                    scriptToneIntensity: 'medium',
                    reviewMode: 'script-first',
                }),
            })
        );
        expect(proposal.proposedNodes).toContainEqual(
            expect.objectContaining({
                blockType: 'media-video',
                config: expect.objectContaining({
                    contentProfileId: 'shorts.info.v1',
                    reviewMode: 'script-first',
                }),
            })
        );
    });
});
