import { describe, expect, it, vi } from 'vitest';

import { countryballTtsBlock, __test__ as countryballTtsTest } from './countryball-tts-block';

vi.mock('../../../config/env', () => ({
    env: {
        orchestratorMode: 'mock',
        countryballTtsVoiceNarrator: 'voice-narrator',
        countryballTtsVoiceMainTired: 'voice-main-tired',
        countryballTtsVoiceMainConfident: 'voice-main-confident',
        countryballTtsVoiceRivalSmug: 'voice-rival-smug',
        countryballTtsVoiceRivalAngry: 'voice-rival-angry',
        countryballTtsVoiceNeutralSerious: 'voice-neutral-serious',
        countryballTtsVoicePanicHigh: 'voice-panic-high',
        countryballTtsVoiceOldTeacher: 'voice-old-teacher',
    },
    isAwsExecutionEnvironment: false,
    isOffline: false,
    isLocalStage: true,
}));

describe('countryballTtsBlock', () => {
    it('maps dialogue lines to role-based voice segments without literal provider ids', async () => {
        const result = await countryballTtsBlock.execute({
            normalizedScenes: [
                {
                    sceneId: 'scene-1',
                    sceneNumber: 1,
                    narratorLine: { text: '오늘의 상황', voiceRole: 'narrator_short' },
                    dialogueLines: [
                        {
                            country: 'A',
                            line: '지금 바로 간다!',
                            voiceRole: 'main_confident',
                            pauseAfterMs: 200,
                        },
                        {
                            country: 'B',
                            line: '벌써?',
                            voiceRole: 'panic_high',
                        },
                    ],
                },
            ],
        });

        expect(result.output).toMatchObject({
            audio: {
                voiceMode: 'countryball-role-voices',
                voiceSegments: [
                    expect.objectContaining({
                        country: 'narrator',
                        text: '오늘의 상황',
                        voiceRole: 'narrator_short',
                        voiceId: 'voice-narrator',
                    }),
                    expect.objectContaining({
                        country: 'A',
                        text: '지금 바로 간다!',
                        voiceRole: 'main_confident',
                        voiceId: 'voice-main-confident',
                    }),
                    expect.objectContaining({
                        country: 'B',
                        text: '벌써?',
                        voiceRole: 'panic_high',
                        voiceId: 'voice-panic-high',
                    }),
                ],
            },
            subtitleCues: [
                expect.objectContaining({ role: 'title', text: '오늘의 상황' }),
                expect.objectContaining({ role: 'dialogue', speakerCountry: 'A', text: '지금 바로 간다!' }),
                expect.objectContaining({ role: 'dialogue', speakerCountry: 'B', text: '벌써?' }),
            ],
        });
    });

    it('ignores long narrator explanations and keeps dialogue as the speech source', async () => {
        const result = await countryballTtsBlock.execute({
            normalizedScenes: [
                {
                    sceneNumber: 1,
                    narratorLine: {
                        text: '이 장면은 길게 상황을 설명하는 내레이션이라 컨트리볼 대사 중심 구조에서는 읽으면 안 됩니다.',
                    },
                    dialogueLines: [{ country: 'A', line: '짧게 보여줘!', voiceRole: 'main_confident' }],
                },
            ],
        });

        expect(result.output['narrationText']).toBe('짧게 보여줘!');
        expect(JSON.stringify(result.output['subtitleCues'])).not.toContain('길게 상황을 설명');
    });

    it('rejects collapsed voice ids when multiple countryball roles speak', () => {
        expect(() =>
            countryballTtsTest.buildRoleVoiceMap(
                [
                    {
                        sceneNumber: 1,
                        country: '한국',
                        text: '내가 간다!',
                        role: 'dialogue',
                        speakerCountry: '한국',
                        voiceRole: 'main_confident',
                    },
                    {
                        sceneNumber: 1,
                        country: '미국',
                        text: '잠깐, 나도 말할래!',
                        role: 'dialogue',
                        speakerCountry: '미국',
                        voiceRole: 'panic_high',
                    },
                ],
                () => 'same-elevenlabs-voice',
                []
            )
        ).toThrow(/distinct role voice IDs/);
    });

    it('assigns distinct provider voices dynamically when role env ids are not configured', () => {
        const roleVoiceMap = countryballTtsTest.buildRoleVoiceMap(
            [
                {
                    sceneNumber: 1,
                    country: '한국',
                    text: '내가 간다!',
                    role: 'dialogue',
                    speakerCountry: '한국',
                    voiceRole: 'main_confident',
                },
                {
                    sceneNumber: 1,
                    country: '미국',
                    text: '잠깐, 나도 말할래!',
                    role: 'dialogue',
                    speakerCountry: '미국',
                    voiceRole: 'panic_high',
                },
            ],
            () => '',
            ['voice-a', 'voice-b']
        );

        expect(roleVoiceMap.get('main_confident')).toBe('voice-a');
        expect(roleVoiceMap.get('panic_high')).toBe('voice-b');
    });

    it('does not add subtitle gaps for pauseAfterMs unless audio includes silence', () => {
        const cues = countryballTtsTest.buildTimedSubtitleCues(
            [
                {
                    sceneNumber: 1,
                    country: '한국',
                    text: '첫 대사',
                    role: 'dialogue',
                    speakerCountry: '한국',
                    voiceRole: 'main_confident',
                    pauseAfterMs: 500,
                },
                {
                    sceneNumber: 1,
                    country: '미국',
                    text: '두 번째 대사',
                    role: 'dialogue',
                    speakerCountry: '미국',
                    voiceRole: 'panic_high',
                },
            ],
            [1, 1]
        );

        expect(cues[0]).toMatchObject({ startSec: 0, endSec: 1 });
        expect(cues[1]).toMatchObject({ startSec: 1, endSec: 2 });
    });
});
