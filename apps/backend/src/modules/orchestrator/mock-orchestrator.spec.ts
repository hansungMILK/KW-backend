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

    it('proposes a longform Gate A plan without paid media execution blocks', async () => {
        const proposal = await mockOrchestrator.generateProposal('flow-1', '롱폼 제작해줘. 주제는 AI 에이전트의 미래');

        expect(proposal.metadata?.['contentProfile']).toEqual(
            expect.objectContaining({
                contentProfileId: 'longform.explainer.v1',
                reviewMode: 'script-first',
            })
        );

        const blockTypes = proposal.proposedNodes.map(node => node.blockType);
        expect(blockTypes).toEqual(['search', 'content', 'data', 'analysis']);
        expect(blockTypes).not.toContain('media-image');
        expect(blockTypes).not.toContain('media-tts');
        expect(blockTypes).not.toContain('media-video');

        expect(proposal.proposedNodes).toContainEqual(
            expect.objectContaining({
                blockType: 'content',
                config: expect.objectContaining({
                    mode: 'longform-gate-a',
                    contentProfileId: 'longform.explainer.v1',
                    reviewMode: 'script-first',
                    rendererRoute: 'hyperframes',
                }),
            })
        );
        expect(proposal.estimatedCost.total).toBeLessThan(0.5);
        expect(proposal.assistantMessage).toContain('롱폼 Gate A');
    });

    it('preserves requested longform duration in the Gate A content config', async () => {
        const proposal = await mockOrchestrator.generateProposal(
            'flow-1',
            '10분 롱폼 제작해줘. 주제는 AI 에이전트의 미래'
        );

        expect(proposal.proposedNodes).toContainEqual(
            expect.objectContaining({
                blockType: 'content',
                config: expect.objectContaining({
                    mode: 'longform-gate-a',
                    targetDurationSec: 600,
                    maxDurationSec: 600,
                }),
            })
        );
    });
});
