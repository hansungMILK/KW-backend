import { describe, expect, it } from 'vitest';

import { __test__ as countryballVideoTest } from './countryball-video-block';

describe('countryballVideoBlock helpers', () => {
    it('builds video captions from TTS voice segments instead of one scene caption', () => {
        const composeImages = countryballVideoTest.buildCountryballComposeImages({
            images: [
                {
                    sceneNumber: 1,
                    url: 'fake://scene-1.png',
                    captionOverlay: [
                        {
                            type: 'dialogue',
                            text: '이 시간에 골목이 이렇게 밝다고?',
                            speakerCountry: '한국',
                            anchorTarget: 'speaker',
                            preferredPosition: 'middle-right',
                            style: 'yellowBlack',
                        },
                        {
                            type: 'dialogue',
                            text: '잠깐, 왜 아무도 안 무서워해?',
                            speakerCountry: '미국',
                            anchorTarget: 'speaker',
                            preferredPosition: 'middle-left',
                            style: 'whiteBlack',
                        },
                    ],
                },
            ],
            scenes: [
                {
                    sceneNumber: 1,
                    captionOverlay: [
                        {
                            type: 'dialogue',
                            text: '옛 자막',
                            speakerCountry: '한국',
                            anchorTarget: 'speaker',
                            preferredPosition: 'middle-right',
                            style: 'yellowBlack',
                        },
                    ],
                },
            ],
            audio: {
                voiceSegments: [
                    { sceneNumber: 1, country: '한국', text: '이 시간에 골목이 이렇게 밝다고?', durationSec: 1.35 },
                    { sceneNumber: 1, country: '미국', text: '잠깐, 왜 아무도 안 무서워해?', durationSec: 1.65 },
                ],
            },
            title: '새벽배송은 밤이 안전해야',
        });

        expect(composeImages).toEqual([
            expect.objectContaining({
                url: 'fake://scene-1.png',
                durationSec: 1.35,
                caption: '이 시간에 골목이 이렇게 밝다고?',
                captionPosition: 'middle-right',
                captionStyle: 'yellowBlack',
            }),
            expect.objectContaining({
                url: 'fake://scene-1.png',
                durationSec: 1.65,
                caption: '잠깐, 왜 아무도 안 무서워해?',
                captionPosition: 'middle-left',
                captionStyle: 'whiteBlack',
            }),
        ]);
    });
});
