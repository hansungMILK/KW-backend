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
});
