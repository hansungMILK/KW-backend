import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mediaTtsBlock } from './media-tts-block';
import { ttsAdapter } from '../../adapters/ai/tts-adapter';

vi.mock('../../config/env', () => ({
    env: {
        orchestratorMode: 'openai',
    },
}));

vi.mock('../../adapters/ai/tts-adapter', () => ({
    ttsAdapter: {
        synthesize: vi.fn(async () => ({
            audioBuffer: Buffer.from('audio'),
            contentType: 'audio/mpeg',
            estimatedDurationSec: 8,
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

        expect(ttsAdapter.synthesize).toHaveBeenCalledWith({
            text: '처음 훅입니다. 두 번째 장면부터 실제 나레이션이 시작됩니다. 마지막 문장입니다.',
        });
        expect(result.output).toMatchObject({
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
});
