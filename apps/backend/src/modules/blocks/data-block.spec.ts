import { describe, expect, it, vi } from 'vitest';

import { dataBlock } from './data-block';

vi.mock('../../config/env', () => ({
    env: {
        orchestratorMode: 'openai',
    },
}));

describe('dataBlock', () => {
    it('downgrades unsourced question hooks from fact to opinion and strips inline markdown', async () => {
        const result = await dataBlock.execute({
            title: 'KTX 표가 없는 진짜 이유',
            scenes: [
                {
                    sceneNumber: 1,
                    caption: '**또 매진이야?**',
                    visualText: '**또 매진이야?**',
                    narration: '왜 KTX는 자꾸 매진일까?',
                    imagePrompt: 'A frustrated traveler looking at a sold out train booking app.',
                    claimType: 'fact',
                    sourceRefs: [],
                    durationSec: 5,
                },
            ],
        });

        const output = result.output as { normalizedScenes: Array<Record<string, unknown>> };
        expect(output.normalizedScenes[0]).toMatchObject({
            caption: '또 매진이야?',
            visualText: '또 매진이야?',
            claimType: 'opinion',
        });
    });

    it('keeps sourced fact scenes as fact', async () => {
        const result = await dataBlock.execute({
            title: 'KTX 병목',
            scenes: [
                {
                    sceneNumber: 1,
                    caption: '평택-오송 병목',
                    narration: '평택-오송 구간은 주요 노선이 모이는 병목 구간입니다.',
                    imagePrompt: 'Korean high speed rail bottleneck infographic scene.',
                    claimType: 'fact',
                    sourceRefs: ['source-1'],
                    durationSec: 5,
                },
            ],
        });

        const output = result.output as { normalizedScenes: Array<Record<string, unknown>> };
        expect(output.normalizedScenes[0]).toMatchObject({
            claimType: 'fact',
            sourceRefs: ['source-1'],
        });
    });

    it('backfills fact scene sourceRefs from upstream source metadata', async () => {
        const result = await dataBlock.execute({
            title: '원문 기반 쇼츠',
            scenes: [
                {
                    sceneNumber: 1,
                    caption: '핵심 주장',
                    narration: '원문에서 확인한 핵심 주장을 짧게 설명합니다.',
                    imagePrompt: 'A person reviewing a source article.',
                    claimType: 'fact',
                    sourceRefs: [],
                    durationSec: 5,
                },
            ],
            sources: [{ id: 'source-1', title: '원문 기사' }],
        });

        const output = result.output as { normalizedScenes: Array<Record<string, unknown>> };
        expect(output.normalizedScenes[0]).toMatchObject({
            claimType: 'fact',
            sourceRefs: ['source-1'],
        });
    });

    it('downgrades unsourced non-concrete fact labels to opinion', async () => {
        const result = await dataBlock.execute({
            title: '일반 조언',
            scenes: [
                {
                    sceneNumber: 1,
                    caption: '생활 습관',
                    narration: '생활 습관을 천천히 바꾸는 접근이 좋습니다.',
                    imagePrompt: 'A calm lifestyle explainer scene.',
                    claimType: 'fact',
                    sourceRefs: [],
                    durationSec: 5,
                },
            ],
        });

        const output = result.output as { normalizedScenes: Array<Record<string, unknown>> };
        expect(output.normalizedScenes[0]).toMatchObject({
            claimType: 'opinion',
            sourceRefs: [],
        });
    });

    it('normalizes longform Gate A artifacts without requiring Shorts scenes', async () => {
        const result = await dataBlock.execute(
            {
                gate: 'A',
                mode: 'longform-gate-a',
                outline: [{ title: '도입', summary: 'AI 에이전트가 왜 필요한지' }],
                fullScriptDraft: 'AI 에이전트의 미래를 설명하는 롱폼 대본 초안입니다.',
                scenePlan: [{ sceneNumber: 1, title: '도입', durationSec: 40 }],
                estimatedDurationSec: 240,
                estimatedCost: { currency: 'USD', total: 0.18 },
                rendererRoute: 'hyperframes',
                qaChecklist: ['출처 검수'],
                mediaExecutionAllowed: false,
            },
            { mode: 'longform-gate-a' }
        );

        expect(result.output).toMatchObject({
            gate: 'A',
            mode: 'longform-gate-a',
            outline: expect.any(Array),
            fullScriptDraft: 'AI 에이전트의 미래를 설명하는 롱폼 대본 초안입니다.',
            scenePlan: expect.any(Array),
            estimatedDurationSec: 240,
            estimatedCost: { currency: 'USD', total: 0.18 },
            rendererRoute: 'hyperframes',
            mediaExecutionAllowed: false,
        });
        expect(result.output['normalizedScenes']).toBeUndefined();
    });

    it('does not treat a generic gate A marker as longform without longform mode or profile', async () => {
        const result = await dataBlock.execute(
            {
                title: '일반 씬',
                scenes: [
                    {
                        sceneNumber: 1,
                        caption: '일반 검수',
                        narration: '일반 콘텐츠의 검수 게이트를 통과하는 장면입니다.',
                        imagePrompt: 'A generic review scene.',
                        claimType: 'opinion',
                        sourceRefs: [],
                        durationSec: 5,
                    },
                ],
            },
            { gate: 'A' }
        );

        expect(result.output).toHaveProperty('normalizedScenes');
        expect(result.output['mode']).toBeUndefined();
    });

    it('carries the exact requested topic into metadata for downstream quality checks', async () => {
        const result = await dataBlock.execute({
            requestTopic: '쇼츠생성해줘. 무한도전 yes or no 편 설명',
            requestSpec: {
                userRequest: '쇼츠생성해줘. 무한도전 yes or no 편 설명',
                contentIntent: 'shorts',
                outputKind: 'video',
                focusTerms: ['무한도전', 'yes', 'no'],
                exactSubjectRequired: true,
            },
            title: '무한도전 YES or NO',
            scenes: [
                {
                    sceneNumber: 1,
                    caption: '왜 레전드?',
                    narration: '무한도전의 일반 포맷을 설명합니다.',
                    imagePrompt: 'generic variety show board',
                    claimType: 'opinion',
                    sourceRefs: [],
                    durationSec: 5,
                },
            ],
        });

        expect(result.output['metadata']).toMatchObject({
            requestTopic: '쇼츠생성해줘. 무한도전 yes or no 편 설명',
            requestSpec: expect.objectContaining({
                contentIntent: 'shorts',
                outputKind: 'video',
                focusTerms: ['무한도전', 'yes', 'no'],
            }),
            outputContract: expect.objectContaining({
                outputKind: 'video',
                requiredCoverageTerms: ['무한도전', 'yes', 'no'],
                exactSubjectRequired: true,
            }),
        });
    });

    it('preserves creative simulation mode for downstream analysis and media blocks', async () => {
        const result = await dataBlock.execute({
            requestTopic: '두 캐릭터가 맞붙는 가상 상황을 쇼츠로 구성해줘',
            requestSpec: {
                userRequest: '두 캐릭터가 맞붙는 가상 상황을 쇼츠로 구성해줘',
                contentIntent: 'shorts',
                outputKind: 'video',
                contentMode: 'creative-simulation',
                focusTerms: ['캐릭터'],
                exactSubjectRequired: true,
            },
            title: '가상 대결',
            scenes: [
                {
                    sceneNumber: 1,
                    caption: '첫 충돌',
                    narration: '두 캐릭터가 첫 합을 겨루는 가상 장면입니다.',
                    imagePrompt: 'A fictional character duel opening beat.',
                    claimType: 'hypothetical',
                    sourceRefs: [],
                    durationSec: 5,
                },
            ],
        });

        expect(result.output['metadata']).toMatchObject({
            requestSpec: expect.objectContaining({
                contentMode: 'creative-simulation',
            }),
            outputContract: expect.objectContaining({
                contentMode: 'creative-simulation',
            }),
        });
    });
});
