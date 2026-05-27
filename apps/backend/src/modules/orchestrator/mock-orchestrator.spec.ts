import { describe, expect, it, vi } from 'vitest';

import { mockOrchestrator } from './mock-orchestrator';

vi.mock('../../utils/id-generator', () => ({
    generateNumericId: vi.fn(() => 'node-id'),
}));

describe('mockOrchestrator content profile proposal metadata', () => {
    it('treats draw-action requests as standalone image generation proposals', async () => {
        const proposal = await mockOrchestrator.generateProposal('flow-1', '우주 고래가 도시 위를 나는 상황을 그려줘');

        expect(proposal.proposedNodes.map(node => node.blockType)).toEqual(['content', 'media-image']);
        expect(proposal.metadata?.['contentProfile']).toEqual(
            expect.objectContaining({
                contentProfileId: 'image.single.v1',
            })
        );
        expect(proposal.proposedNodes.map(node => node.blockType)).not.toContain('media-video');
    });

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
        expect(proposal.proposedNodes.map(node => node.blockType)).not.toContain('countryball-brief');
    });

    it('routes explicit countryball Shorts through the isolated countryball product flow', async () => {
        const proposal = await mockOrchestrator.generateProposal(
            'flow-1',
            '국뽕 컨트리볼쇼츠 주제 추천해서 리비아 대수로 공사로 만들어줘'
        );

        const blockTypes = proposal.proposedNodes.map(node => node.blockType);
        expect(blockTypes).toEqual([
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
        expect(proposal.metadata?.['contentProfile']).toEqual(
            expect.objectContaining({
                contentProfileId: 'shorts.countryball.v1',
                narrativeMode: 'countryball-situation-reenactment',
                requestBasis: 'user-requested',
            })
        );

        const nodeByType = Object.fromEntries(proposal.proposedNodes.map(node => [node.blockType, node.id]));
        expect(proposal.proposedEdges).toContainEqual(
            expect.objectContaining({
                sourceNodeId: nodeByType['search'],
                targetNodeId: nodeByType['countryball-brief'],
            })
        );
        expect(proposal.proposedEdges).toContainEqual(
            expect.objectContaining({
                sourceNodeId: nodeByType['countryball-brief'],
                targetNodeId: nodeByType['countryball-script'],
            })
        );
        expect(proposal.proposedEdges).toContainEqual(
            expect.objectContaining({
                sourceNodeId: nodeByType['countryball-analysis'],
                targetNodeId: nodeByType['countryball-image'],
            })
        );
        expect(proposal.proposedEdges).toContainEqual(
            expect.objectContaining({
                sourceNodeId: nodeByType['countryball-analysis'],
                targetNodeId: nodeByType['countryball-tts'],
            })
        );
    });

    it('proposes a user-facing longform production flow with Gate B blocked until review approval', async () => {
        const proposal = await mockOrchestrator.generateProposal('flow-1', '롱폼 제작해줘. 주제는 AI 에이전트의 미래');

        expect(proposal.metadata?.['contentProfile']).toEqual(
            expect.objectContaining({
                contentProfileId: 'longform.explainer.v1',
                reviewMode: 'script-first',
            })
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
    });

    it('preserves requested longform duration in the Gate A content config', async () => {
        const proposal = await mockOrchestrator.generateProposal(
            'flow-1',
            '10분 롱폼 제작해줘. 주제는 AI 에이전트의 미래'
        );

        expect(proposal.proposedNodes).toContainEqual(
            expect.objectContaining({
                blockType: 'longform-brief',
                config: expect.objectContaining({
                    mode: 'longform-gate-a',
                    targetDurationSec: 600,
                    maxDurationSec: 600,
                }),
            })
        );
    });
});
