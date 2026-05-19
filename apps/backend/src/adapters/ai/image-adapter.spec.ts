import { request as undiciRequest } from 'undici';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { imageAdapter } from './image-adapter';

vi.mock('undici', () => ({
    request: vi.fn(),
}));

vi.mock('./paid-openai-guard', () => ({
    ensurePaidOpenAIAllowed: vi.fn(),
}));

vi.mock('../../config/env', () => ({
    env: {
        openaiBaseUrl: 'https://api.openai.test/v1',
        openaiImageQuality: 'medium',
        openaiImageTimeoutMs: 25,
        openaiImageMaxAttempts: 1,
    },
}));

vi.mock('../../modules/image-generation/image-style', () => ({
    GPT_IMAGE_MODEL: 'gpt-image-2',
    normalizeImageQuality: (quality: string) => quality,
}));

vi.mock('../../services/credential-resolver', () => ({
    getProviderApiKey: vi.fn(async () => 'sk-test'),
}));

vi.mock('../../utils/logger', () => ({
    log: {
        info: vi.fn(),
        warn: vi.fn(),
    },
}));

const requestMock = vi.mocked(undiciRequest);

describe('imageAdapter', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('fails provider requests that never return headers', async () => {
        requestMock.mockImplementationOnce(() => new Promise(() => undefined));

        await expect(imageAdapter.generate({ prompt: 'hung image request' })).rejects.toThrow(
            /OpenAI image API timed out after/
        );

        expect(requestMock).toHaveBeenCalledWith(
            'https://api.openai.test/v1/images/generations',
            expect.objectContaining({
                headersTimeout: 25,
                bodyTimeout: 25,
            })
        );
    });

    it('fails provider responses whose body never settles', async () => {
        requestMock.mockResolvedValueOnce({
            statusCode: 200,
            body: {
                text: vi.fn(() => new Promise(() => undefined)),
            },
        } as never);

        await expect(imageAdapter.generate({ prompt: 'hung image body' })).rejects.toThrow(
            /OpenAI image API timed out after/
        );
    });

    it('returns image buffers from successful gpt-image-2 responses', async () => {
        requestMock.mockResolvedValueOnce({
            statusCode: 200,
            body: {
                text: vi.fn(async () =>
                    JSON.stringify({
                        data: [{ b64_json: Buffer.from('png').toString('base64') }],
                    })
                ),
            },
        } as never);

        await expect(imageAdapter.generate({ prompt: 'successful image request' })).resolves.toMatchObject({
            imageBuffer: Buffer.from('png'),
            contentType: 'image/png',
            width: 1024,
            height: 1536,
            model: 'gpt-image-2',
        });
    });
});
