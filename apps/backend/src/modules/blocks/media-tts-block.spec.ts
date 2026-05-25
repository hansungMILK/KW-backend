import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mediaTtsBlock } from './media-tts-block';
import { ttsAdapter } from '../../adapters/ai/tts-adapter';
import { audioConcatAdapter } from '../../adapters/external/audio-concat-adapter';

vi.mock('../../config/env', () => ({
    env: {
        orchestratorMode: 'openai',
        elevenLabsTtsModel: 'eleven_flash_v2_5',
        elevenLabsTtsTimeoutMs: 120000,
        elevenLabsTtsVoiceId: 'pNInz6obpgDQGcFmaJgB',
        countryballTtsVoiceNarrator: 'pNInz6obpgDQGcFmaJgB',
        countryballTtsVoiceKr: 'TxGEqnHWrfWFTfGW9XjX',
        countryballTtsVoiceJp: 'EXAVITQu4vr4xnSDxMaL',
        countryballTtsVoiceUs: 'VR6AewLTigWG4xSOukaG',
        countryballTtsVoiceCn: 'ErXwobaYiN019PkySvjV',
        countryballTtsVoiceMainTired: 'TxGEqnHWrfWFTfGW9XjX',
        countryballTtsVoiceMainConfident: 'TxGEqnHWrfWFTfGW9XjX',
        countryballTtsVoiceRivalSmug: 'VR6AewLTigWG4xSOukaG',
        countryballTtsVoiceRivalAngry: 'EXAVITQu4vr4xnSDxMaL',
        countryballTtsVoiceNeutralSerious: 'VR6AewLTigWG4xSOukaG',
        countryballTtsVoicePanicHigh: 'ErXwobaYiN019PkySvjV',
        countryballTtsVoiceOldTeacher: 'pNInz6obpgDQGcFmaJgB',
    },
}));

vi.mock('../../adapters/ai/tts-adapter', () => ({
    ttsAdapter: {
        canUseElevenLabs: vi.fn(async () => true),
        synthesize: vi.fn(async ({ text, voiceId }) => ({
            audioBuffer: Buffer.from(`audio:${voiceId ?? 'default'}:${text}`),
            contentType: 'audio/mpeg',
            estimatedDurationSec: 8,
            provider: 'elevenlabs',
            model: 'eleven_flash_v2_5',
            voiceId: voiceId ?? 'pNInz6obpgDQGcFmaJgB',
        })),
    },
}));

vi.mock('../../adapters/external/audio-concat-adapter', () => ({
    audioConcatAdapter: {
        concatMp3: vi.fn(async segments =>
            Buffer.concat(segments.map((segment: { audioBuffer: Buffer }) => segment.audioBuffer))
        ),
    },
}));

vi.mock('../../adapters/aws/s3', () => ({
    getPublicUrl: (key: string) => `http://localhost:8800/_local-assets/${key}`,
    putObject: vi.fn(async () => undefined),
}));

vi.mock('../../services/trace-service', () => ({
    traceService: {
        record: vi.fn(async () => undefined),
    },
}));

describe('mediaTtsBlock', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(ttsAdapter.canUseElevenLabs).mockResolvedValue(true);
    });

    it('builds subtitle cues from the exact text sent to TTS and scales them to audio duration', async () => {
        const result = await mediaTtsBlock.execute({
            hook: '처음 훅입니다.',
            normalizedScenes: [
                {
                    sceneNumber: 1,
                    durationSec: 4,
                },
                {
                    sceneNumber: 2,
                    durationSec: 6,
                    narration: '두 번째 장면부터 실제 나레이션이 시작됩니다.',
                },
            ],
            metadata: {
                cta: '마지막 문장입니다.',
            },
        });

        expect(ttsAdapter.synthesize).toHaveBeenCalledWith(
            expect.objectContaining({
                text: '처음 훅입니다. 두 번째 장면부터 실제 나레이션이 시작됩니다. 마지막 문장입니다.',
            })
        );
        expect(result.output).toMatchObject({
            audio: {
                provider: 'elevenlabs',
                voiceId: 'pNInz6obpgDQGcFmaJgB',
            },
            subtitleCues: [
                {
                    sceneNumber: 1,
                    text: '처음 훅입니다.',
                    role: 'hook',
                    startSec: 0,
                },
                {
                    sceneNumber: 2,
                    text: '두 번째 장면부터 실제 나레이션이 시작됩니다.',
                    role: 'scene',
                },
                {
                    sceneNumber: 2,
                    text: '마지막 문장입니다.',
                    role: 'cta',
                    endSec: 8,
                },
            ],
        });
    });

    it('passes the execution abort signal into the TTS adapter', async () => {
        const controller = new AbortController();

        await mediaTtsBlock.execute(
            {
                normalizedScenes: [{ sceneNumber: 1, narration: '신호 전달 확인 문장입니다.' }],
            },
            undefined,
            {
                runId: 'run-tts-signal',
                nodeId: 'node-tts',
                abortSignal: controller.signal,
            }
        );

        expect(ttsAdapter.synthesize).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal }));
    });

    it('uses structured countryball dialogue lines as spoken Shorts segments', async () => {
        vi.mocked(ttsAdapter.canUseElevenLabs).mockResolvedValue(false);

        const result = await mediaTtsBlock.execute({
            normalizedScenes: [
                {
                    sceneNumber: 1,
                    narration: '한국볼과 일본볼이 협상장에 들어옵니다.',
                    dialogueLines: [
                        { speaker: 'KR', text: '도장 찍기 전에 읽어.' },
                        { speaker: 'JP', text: '잠깐, 조건이 이상한데?' },
                    ],
                },
            ],
            metadata: {
                presetId: 'countryball-shorts',
            },
        });

        expect(ttsAdapter.synthesize).toHaveBeenCalledWith(
            expect.objectContaining({
                text: '한국볼: 도장 찍기 전에 읽어. 일본볼: 잠깐, 조건이 이상한데?',
            })
        );
        expect(result.output['subtitleCues']).toMatchObject([
            {
                sceneNumber: 1,
                text: '한국볼: 도장 찍기 전에 읽어. 일본볼: 잠깐, 조건이 이상한데?',
                role: 'scene',
            },
        ]);
    });

    it('routes countryball dialogue through role voices and ignores explanatory narrator lines', async () => {
        const result = await mediaTtsBlock.execute({
            normalizedScenes: [
                {
                    sceneNumber: 1,
                    narration: '한국볼과 일본볼이 협상장에 들어옵니다.',
                    dialogueLines: [
                        {
                            country: '한국',
                            line: '도장 찍기 전에 읽어.',
                            speaker: 'KR',
                            text: '도장 찍기 전에 읽어.',
                            emotion: 'stern',
                            tone: '단호하게',
                            delivery: '단호하게',
                            voiceRole: 'main_confident',
                        },
                        {
                            country: '일본',
                            line: '잠깐, 조건이 이상한데?',
                            speaker: 'JP',
                            text: '잠깐, 조건이 이상한데?',
                            emotion: 'nervous',
                            tone: '당황한 말투',
                            delivery: '당황한 말투',
                            voiceRole: 'panic_high',
                        },
                    ],
                    narratorLine: {
                        text: '이 장면은 한국볼이 협상 주도권을 가져가는 상황극입니다.',
                        voiceRole: 'narrator',
                    },
                },
            ],
            metadata: {
                presetId: 'countryball-shorts',
            },
        });

        expect(ttsAdapter.synthesize).toHaveBeenCalledTimes(2);
        expect(ttsAdapter.synthesize).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                text: '도장 찍기 전에 읽어.',
                voiceId: 'TxGEqnHWrfWFTfGW9XjX',
            })
        );
        expect(ttsAdapter.synthesize).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                text: '잠깐, 조건이 이상한데?',
                voiceId: 'ErXwobaYiN019PkySvjV',
            })
        );
        expect(audioConcatAdapter.concatMp3).toHaveBeenCalledTimes(1);
        expect(result.output).toMatchObject({
            audio: {
                provider: 'elevenlabs',
                voiceId: 'pNInz6obpgDQGcFmaJgB',
                voiceMode: 'countryball-multi-voice',
            },
            narrationText: '도장 찍기 전에 읽어. 잠깐, 조건이 이상한데?',
            subtitleCues: [
                {
                    sceneNumber: 1,
                    text: '도장 찍기 전에 읽어.',
                    role: 'scene',
                    startSec: 0,
                    endSec: 8,
                },
                {
                    sceneNumber: 1,
                    text: '잠깐, 조건이 이상한데?',
                    role: 'scene',
                    startSec: 8,
                    endSec: 16,
                },
            ],
        });
    });

    it('preserves the TTS provider selected by the adapter', async () => {
        vi.mocked(ttsAdapter.canUseElevenLabs).mockResolvedValue(false);
        vi.mocked(ttsAdapter.synthesize).mockResolvedValueOnce({
            audioBuffer: Buffer.from('openai-audio'),
            contentType: 'audio/mpeg',
            estimatedDurationSec: 3,
            provider: 'openai',
            model: 'gpt-4o-mini-tts',
            voiceId: 'nova',
        });

        const result = await mediaTtsBlock.execute({
            normalizedScenes: [{ sceneNumber: 1, narration: '오픈AI 음성으로 읽습니다.' }],
        });

        expect(result.output).toMatchObject({
            audio: {
                provider: 'openai',
                model: 'gpt-4o-mini-tts',
                voiceId: 'nova',
            },
        });
    });
});
