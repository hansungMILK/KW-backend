import { beforeEach, describe, expect, it, vi } from 'vitest';

import { main } from './ffmpeg-overlay';
import { ffmpegAdapter } from '../../../adapters/external/ffmpeg-adapter';

import type { APIGatewayProxyEvent } from 'aws-lambda';

vi.mock('../../../adapters/external/ffmpeg-adapter', () => ({
    ffmpegAdapter: {
        compose: vi.fn(),
        probeVideo: vi.fn(),
    },
}));

const compose = vi.mocked(ffmpegAdapter.compose);
const probeVideo = vi.mocked(ffmpegAdapter.probeVideo);

describe('ffmpeg overlay diagnostics handler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.STAGE = 'local';
        delete process.env.APP_API_KEY;
        delete process.env.ALLOW_DIAGNOSTICS_ENDPOINTS;
    });

    it('runs a real composition path through the ffmpeg adapter', async () => {
        compose.mockResolvedValueOnce({
            videoBuffer: Buffer.from('mp4'),
            durationSec: 0.5,
            sizeBytes: 3,
        });
        probeVideo.mockResolvedValueOnce({
            hasVideo: true,
            hasAudio: false,
            width: 320,
            height: 568,
            durationSec: 0.5,
        });

        const response = await main({
            httpMethod: 'POST',
            path: '/diagnostics/ffmpeg-overlay',
            headers: {},
            body: '',
        } as APIGatewayProxyEvent);

        expect(response.statusCode).toBe(200);
        expect(compose).toHaveBeenCalledWith(
            expect.objectContaining({
                outputWidth: 320,
                outputHeight: 568,
                outputFormat: 'mp4',
                images: [
                    expect.objectContaining({
                        title: 'FFmpeg',
                        caption: 'overlay smoke',
                    }),
                ],
            })
        );
        expect(probeVideo).toHaveBeenCalledWith(Buffer.from('mp4'));
        expect(JSON.parse(response.body)).toEqual({
            ok: true,
            capability: 'ffmpeg-overlay',
            durationMs: expect.any(Number),
            video: {
                durationSec: 0.5,
                sizeBytes: 3,
                hasVideo: true,
                hasAudio: false,
                width: 320,
                height: 568,
            },
        });
    });

    it('blocks diagnostics in prod unless explicitly enabled', async () => {
        process.env.STAGE = 'prod';
        process.env.APP_API_KEY = 'test-app-key';

        const response = await main({
            httpMethod: 'POST',
            path: '/diagnostics/ffmpeg-overlay',
            headers: { 'x-api-key': 'test-app-key' },
            body: '',
        } as APIGatewayProxyEvent);

        expect(response.statusCode).toBe(403);
        expect(compose).not.toHaveBeenCalled();
    });
});
