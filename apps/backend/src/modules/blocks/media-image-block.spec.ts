import { describe, expect, it, vi } from 'vitest';

import { mediaImageBlock } from './media-image-block';
import { imageAdapter } from '../../adapters/ai/image-adapter';

vi.mock('../../config/env', () => ({
    env: {
        orchestratorMode: 'openai',
        openaiImageSceneConcurrency: 2,
        openaiImageSceneMaxAttempts: 1,
        openaiImageSceneTimeoutMs: 5000,
    },
}));

vi.mock('../../adapters/ai/image-adapter', () => ({
    imageAdapter: {
        generate: vi.fn(async ({ prompt }: { prompt: string }) => {
            if (prompt.includes('hang')) {
                return await new Promise(() => undefined);
            }
            if (prompt.includes('fail')) {
                throw new Error('image provider failed');
            }
            return {
                imageBuffer: Buffer.from('png'),
                contentType: 'image/png',
                width: 1024,
                height: 1536,
            };
        }),
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

describe('mediaImageBlock', () => {
    it('fails fast when one parallel scene fails instead of waiting for hung scenes', async () => {
        const startedAt = Date.now();

        await expect(
            mediaImageBlock.execute(
                {
                    normalizedScenes: [
                        {
                            sceneNumber: 1,
                            caption: '멈춘 장면',
                            imagePrompt: 'hang',
                            sourceRefs: [],
                            durationSec: 5,
                        },
                        {
                            sceneNumber: 2,
                            caption: '실패 장면',
                            imagePrompt: 'fail',
                            sourceRefs: [],
                            durationSec: 5,
                        },
                    ],
                },
                undefined,
                {
                    runId: 'run-test',
                    nodeId: 'node-image',
                    onProgress: vi.fn(async () => undefined),
                    onAsset: vi.fn(async () => undefined),
                    isCancelled: vi.fn(async () => false),
                }
            )
        ).rejects.toThrow(/image provider failed/);

        expect(Date.now() - startedAt).toBeLessThan(1000);
        expect(imageAdapter.generate).toHaveBeenCalledTimes(2);
    });
});
