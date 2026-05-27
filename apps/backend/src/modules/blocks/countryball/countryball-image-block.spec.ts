import { describe, expect, it, vi } from 'vitest';

import { countryballImageBlock } from './countryball-image-block';

vi.mock('../../../config/env', () => ({
    env: {
        orchestratorMode: 'mock',
        openaiImageQuality: 'medium',
        openaiImageSceneConcurrency: 12,
    },
    isAwsExecutionEnvironment: false,
    isOffline: false,
    isLocalStage: true,
}));

describe('countryballImageBlock', () => {
    it('turns scene contracts into visual-action prompts and leaves captions to video overlay', async () => {
        const result = await countryballImageBlock.execute({
            normalizedScenes: [
                {
                    sceneId: 'scene-1',
                    sceneNumber: 1,
                    scenePurpose: 'show the main conflict through action',
                    location: 'busy market table',
                    visualTone: 'chaotic comedy',
                    screenAction:
                        'A countryball slams a receipt on the table while B countryball sweats and leans back',
                    dialogueLines: [
                        { country: 'A', line: '계산 끝!', voiceRole: 'main_confident' },
                        { country: 'B', line: '잠깐!', voiceRole: 'panic_high' },
                    ],
                    expressionChanges: ['A has smug eyes', 'B has sweat drops'],
                    props: ['receipt', 'table', 'coin pile'],
                    captionOverlay: [
                        {
                            type: 'dialogue',
                            text: '계산 끝!',
                            speakerCountry: 'A',
                            anchorTarget: 'speaker',
                            preferredPosition: 'middle-left',
                            style: 'yellowBlack',
                        },
                    ],
                },
            ],
        });

        const image = (result.output['images'] as Array<Record<string, unknown>>)[0];
        expect(image).toMatchObject({
            sceneNumber: 1,
            width: 1080,
            height: 1920,
            captionOverlay: [
                expect.objectContaining({
                    type: 'dialogue',
                    speakerCountry: 'A',
                    anchorTarget: 'speaker',
                }),
            ],
        });
        expect(String(image['prompt'])).toContain('Visible action: A countryball slams a receipt');
        expect(String(image['prompt'])).not.toMatch(
            /speech bubbles?|blank balloons?|blank caption boxes?|empty text panels?|highlighted empty areas?|말풍선/i
        );
        expect(String(image['prompt'])).not.toContain('Leave clean empty space');
        expect(String(image['prompt'])).toContain('No embedded Korean text');
        expect(String(image['prompt'])).toContain('Do not put Korean dialogue');
        expect(String(image['prompt'])).not.toContain('계산 끝!');
    });
});
