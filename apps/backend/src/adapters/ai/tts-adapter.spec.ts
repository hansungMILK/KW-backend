import { spawnSync } from 'child_process';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ttsAdapter } from './tts-adapter';
import { getProviderApiKey } from '../../services/credential-resolver';

vi.mock('../../config/env', () => ({
    env: {
        elevenLabsTtsMaxAttempts: 1,
        elevenLabsTtsModel: 'eleven_flash_v2_5',
        elevenLabsTtsOutputFormat: 'mp3_44100_128',
        elevenLabsTtsTimeoutMs: 120000,
        elevenLabsTtsVoiceId: 'eleven-voice',
        openaiBaseUrl: 'https://api.openai.com/v1',
        openaiTtsMaxAttempts: 1,
        openaiTtsModel: 'gpt-4o-mini-tts',
        openaiTtsTimeoutMs: 120000,
        openaiTtsVoice: 'nova',
    },
}));

vi.mock('../../services/credential-resolver', () => ({
    getProviderApiKey: vi.fn(),
}));

vi.mock('../../utils/logger', () => ({
    log: {
        info: vi.fn(),
        warn: vi.fn(),
    },
}));

vi.mock('child_process', () => ({
    spawnSync: vi.fn(() => ({ status: 0, stdout: '2.5' })),
}));

const getProviderApiKeyMock = vi.mocked(getProviderApiKey);
const spawnSyncMock = vi.mocked(spawnSync);

const mockAudioResponse = () =>
    ({
        ok: true,
        arrayBuffer: vi.fn(async () => Uint8Array.from([1, 2, 3]).buffer),
    }) as unknown as Response;

describe('ttsAdapter', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => mockAudioResponse())
        );
        spawnSyncMock.mockReturnValue({ status: 0, stdout: '2.5' } as ReturnType<typeof spawnSync>);
    });

    it('uses ElevenLabs when an ElevenLabs key is configured', async () => {
        getProviderApiKeyMock.mockImplementation(async provider => (provider === 'elevenlabs' ? 'eleven-key' : null));

        const result = await ttsAdapter.synthesize({ text: '테스트 나레이션' });

        expect(result).toMatchObject({
            provider: 'elevenlabs',
            model: 'eleven_flash_v2_5',
            voiceId: 'eleven-voice',
            estimatedDurationSec: 2.5,
        });
        expect(fetch).toHaveBeenCalledWith(
            expect.stringContaining('/text-to-speech/eleven-voice'),
            expect.objectContaining({
                headers: expect.objectContaining({ 'xi-api-key': 'eleven-key' }),
            })
        );
        expect(getProviderApiKeyMock).not.toHaveBeenCalledWith('openai');
    });

    it('falls back to OpenAI TTS when ElevenLabs is not configured', async () => {
        getProviderApiKeyMock.mockImplementation(async provider => (provider === 'openai' ? 'openai-key' : null));

        const result = await ttsAdapter.synthesize({ text: '오픈AI 나레이션' });

        expect(result).toMatchObject({
            provider: 'openai',
            model: 'gpt-4o-mini-tts',
            voiceId: 'nova',
            estimatedDurationSec: 2.5,
        });
        expect(fetch).toHaveBeenCalledWith(
            'https://api.openai.com/v1/audio/speech',
            expect.objectContaining({
                headers: expect.objectContaining({ Authorization: 'Bearer openai-key' }),
                body: expect.stringContaining('"response_format":"mp3"'),
            })
        );
    });

    it('fails clearly when neither TTS provider is configured', async () => {
        getProviderApiKeyMock.mockResolvedValue(null);

        await expect(ttsAdapter.synthesize({ text: '키 없음' })).rejects.toThrow(
            'Provider credential not configured: elevenlabs or openai'
        );
    });
});
