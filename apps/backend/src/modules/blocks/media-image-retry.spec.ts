import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
    vi.doUnmock('../../config/env');
    vi.doUnmock('../../adapters/ai/image-adapter');
    vi.doUnmock('../../adapters/aws/s3');
    vi.doUnmock('../../services/trace-service');
    vi.resetModules();
});

describe('mediaImageBlock scene retry', () => {
    it('retries a timed out scene and publishes only the successful retry result', async () => {
        vi.doMock('../../config/env', () => ({
            env: {
                orchestratorMode: 'openai',
                openaiImageSceneConcurrency: 1,
                openaiImageSceneMaxAttempts: 2,
                openaiImageSceneTimeoutMs: 20,
                openaiImageBatchTimeoutBufferMs: 20,
                openaiImageModel: 'gpt-image-2',
                openaiImageQuality: 'medium',
            },
        }));

        const generate = vi.fn(async ({ signal }: { signal?: AbortSignal }) => {
            if (generate.mock.calls.length === 1) {
                return await new Promise((_, reject) => {
                    signal?.addEventListener(
                        'abort',
                        () => reject(signal.reason instanceof Error ? signal.reason : new Error('aborted')),
                        { once: true }
                    );
                });
            }

            return {
                imageBuffer: Buffer.from('retry-success'),
                contentType: 'image/png',
                width: 1024,
                height: 1536,
            };
        });
        const traceRecord = vi.fn(async () => undefined);

        vi.doMock('../../adapters/ai/image-adapter', () => ({
            imageAdapter: { generate },
        }));
        vi.doMock('../../adapters/aws/s3', () => ({
            deleteObject: vi.fn(async () => undefined),
            getPublicUrl: (key: string) => `http://localhost:8800/_local-assets/${key}`,
            putObject: vi.fn(async () => undefined),
        }));
        vi.doMock('../../services/trace-service', () => ({
            traceService: { record: traceRecord },
        }));

        const { mediaImageBlock } = await import('./media-image-block');

        const result = await mediaImageBlock.execute(
            {
                normalizedScenes: [
                    {
                        sceneNumber: 1,
                        caption: '재시도 장면',
                        imagePrompt: 'first attempt hangs, second succeeds',
                        sourceRefs: [],
                        durationSec: 5,
                    },
                ],
            },
            undefined,
            {
                runId: 'run-retry',
                nodeId: 'node-image',
                onProgress: vi.fn(async () => undefined),
                onAsset: vi.fn(async () => undefined),
                isCancelled: vi.fn(async () => false),
            }
        );

        expect(generate).toHaveBeenCalledTimes(2);
        expect(result.assets).toHaveLength(1);
        expect(result.output.images).toHaveLength(1);

        const events = traceRecord.mock.calls
            .map(call => call[4] as { event?: string; sceneNumber?: number; attempt?: number } | undefined)
            .filter(Boolean);

        expect(events).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ event: 'scene.timeout', sceneNumber: 1, attempt: 1 }),
                expect.objectContaining({ event: 'scene.completed', sceneNumber: 1, attempt: 2 }),
                expect.objectContaining({ event: 'batch.completed' }),
            ])
        );
    });

    it('does not spend retry attempts on non-retryable provider errors', async () => {
        vi.doMock('../../config/env', () => ({
            env: {
                orchestratorMode: 'openai',
                openaiImageSceneConcurrency: 1,
                openaiImageSceneMaxAttempts: 2,
                openaiImageSceneTimeoutMs: 20,
                openaiImageBatchTimeoutBufferMs: 20,
                openaiImageModel: 'gpt-image-2',
                openaiImageQuality: 'medium',
            },
        }));

        const generate = vi.fn(async () => {
            throw new Error('OpenAI image API error 403: organization verification required');
        });
        const traceRecord = vi.fn(async () => undefined);

        vi.doMock('../../adapters/ai/image-adapter', () => ({
            imageAdapter: { generate },
        }));
        vi.doMock('../../adapters/aws/s3', () => ({
            deleteObject: vi.fn(async () => undefined),
            getPublicUrl: (key: string) => `http://localhost:8800/_local-assets/${key}`,
            putObject: vi.fn(async () => undefined),
        }));
        vi.doMock('../../services/trace-service', () => ({
            traceService: { record: traceRecord },
        }));

        const { mediaImageBlock } = await import('./media-image-block');

        await expect(
            mediaImageBlock.execute(
                {
                    normalizedScenes: [
                        {
                            sceneNumber: 1,
                            caption: '검증 오류 장면',
                            imagePrompt: 'non retryable provider error',
                            sourceRefs: [],
                            durationSec: 5,
                        },
                    ],
                },
                undefined,
                {
                    runId: 'run-non-retryable',
                    nodeId: 'node-image',
                    onProgress: vi.fn(async () => undefined),
                    onAsset: vi.fn(async () => undefined),
                    isCancelled: vi.fn(async () => false),
                }
            )
        ).rejects.toThrow(/organization verification required/);

        expect(generate).toHaveBeenCalledTimes(1);

        const events = traceRecord.mock.calls
            .map(
                call =>
                    call[4] as
                        | { event?: string; sceneNumber?: number; attempt?: number; errorCode?: string }
                        | undefined
            )
            .filter(Boolean);

        expect(events).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    event: 'scene.retry.skipped',
                    sceneNumber: 1,
                    attempt: 1,
                    errorCode: 'IMAGE_PROVIDER_403',
                }),
                expect.objectContaining({
                    event: 'batch.failed',
                    errorCode: 'IMAGE_PROVIDER_403',
                }),
            ])
        );
    });

    it('retries transient provider transport errors such as closed image HTTP connections', async () => {
        vi.doMock('../../config/env', () => ({
            env: {
                orchestratorMode: 'openai',
                openaiImageSceneConcurrency: 1,
                openaiImageSceneMaxAttempts: 2,
                openaiImageSceneTimeoutMs: 200,
                openaiImageBatchTimeoutBufferMs: 20,
                openaiImageModel: 'gpt-image-2',
                openaiImageQuality: 'medium',
            },
        }));

        const generate = vi.fn(async () => {
            if (generate.mock.calls.length === 1) {
                throw new Error('other side closed');
            }

            return {
                imageBuffer: Buffer.from('retry-success'),
                contentType: 'image/png',
                width: 1024,
                height: 1536,
            };
        });
        const traceRecord = vi.fn(async () => undefined);

        vi.doMock('../../adapters/ai/image-adapter', () => ({
            imageAdapter: { generate },
        }));
        vi.doMock('../../adapters/aws/s3', () => ({
            deleteObject: vi.fn(async () => undefined),
            getPublicUrl: (key: string) => `http://localhost:8800/_local-assets/${key}`,
            putObject: vi.fn(async () => undefined),
        }));
        vi.doMock('../../services/trace-service', () => ({
            traceService: { record: traceRecord },
        }));

        const { mediaImageBlock } = await import('./media-image-block');

        const result = await mediaImageBlock.execute(
            {
                normalizedScenes: [
                    {
                        sceneNumber: 5,
                        caption: '연결 재시도 장면',
                        imagePrompt: 'first attempt connection closes, second succeeds',
                        sourceRefs: [],
                        durationSec: 5,
                    },
                ],
            },
            undefined,
            {
                runId: 'run-transport-retry',
                nodeId: 'node-image',
                onProgress: vi.fn(async () => undefined),
                onAsset: vi.fn(async () => undefined),
                isCancelled: vi.fn(async () => false),
            }
        );

        expect(generate).toHaveBeenCalledTimes(2);
        expect(result.assets).toHaveLength(1);
        expect(result.output.images).toHaveLength(1);

        const events = traceRecord.mock.calls
            .map(
                call =>
                    call[4] as
                        | { event?: string; sceneNumber?: number; attempt?: number; errorCode?: string }
                        | undefined
            )
            .filter(Boolean);

        expect(events).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    event: 'scene.failed',
                    sceneNumber: 5,
                    attempt: 1,
                    errorCode: 'IMAGE_PROVIDER_TRANSPORT',
                }),
                expect.objectContaining({ event: 'scene.completed', sceneNumber: 5, attempt: 2 }),
                expect.objectContaining({ event: 'batch.completed' }),
            ])
        );
    });
});
