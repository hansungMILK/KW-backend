import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mediaTtsBlock } from './media-tts-block';
import { ttsAdapter } from '../../adapters/ai/tts-adapter';

vi.mock('../../config/env', () => ({
    env: {
        orchestratorMode: 'openai',
        elevenLabsTtsModel: 'eleven_flash_v2_5',
        elevenLabsTtsTimeoutMs: 120000,
        elevenLabsTtsVoiceId: 'pNInz6obpgDQGcFmaJgB',
    },
}));

vi.mock('../../adapters/ai/tts-adapter', () => ({
    ttsAdapter: {
        synthesize: vi.fn(async () => ({
            audioBuffer: Buffer.from('audio'),
            contentType: 'audio/mpeg',
            estimatedDurationSec: 8,
            provider: 'elevenlabs',
            model: 'eleven_flash_v2_5',
            voiceId: 'pNInz6obpgDQGcFmaJgB',
        })),
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

    it('preserves the TTS provider selected by the adapter', async () => {
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
