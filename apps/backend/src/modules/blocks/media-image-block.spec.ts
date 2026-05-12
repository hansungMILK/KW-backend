import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mediaImageBlock } from './media-image-block';
import { imageAdapter } from '../../adapters/ai/image-adapter';
import { deleteObject } from '../../adapters/aws/s3';
import { traceService } from '../../services/trace-service';
import { buildGptImage2ScenePrompt } from '../image-generation/image-style';

vi.mock('../../config/env', () => ({
    env: {
        orchestratorMode: 'openai',
        openaiImageSceneConcurrency: 2,
        openaiImageSceneMaxAttempts: 1,
        openaiImageSceneTimeoutMs: 50,
        openaiImageBatchTimeoutBufferMs: 10,
        openaiImageModel: 'gpt-image-2',
        openaiImageQuality: 'medium',
    },
}));

vi.mock('../../adapters/ai/image-adapter', () => ({
    imageAdapter: {
        generate: vi.fn(async ({ prompt, signal }: { prompt: string; signal?: AbortSignal }) => {
            if (prompt.includes('abort-timeout')) {
                return await new Promise((_, reject) => {
                    if (signal?.aborted) {
                        reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
                        return;
                    }
                    signal?.addEventListener(
                        'abort',
                        () => reject(signal.reason instanceof Error ? signal.reason : new Error('aborted')),
                        { once: true }
                    );
                });
            }
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
    deleteObject: vi.fn(async () => undefined),
    getPublicUrl: (key: string) => `http://localhost:8800/_local-assets/${key}`,
    putObject: vi.fn(async () => undefined),
}));

vi.mock('../../services/trace-service', () => ({
    traceService: {
        record: vi.fn(async () => undefined),
    },
}));

const traceRecord = vi.mocked(traceService.record);
const generateImage = vi.mocked(imageAdapter.generate);
const deleteUploadedObject = vi.mocked(deleteObject);

describe('mediaImageBlock', () => {
    beforeEach(() => {
        traceRecord.mockClear();
        generateImage.mockClear();
        deleteUploadedObject.mockClear();
    });

    it('passes the selected image style and quality into GPT image generation requests', async () => {
        await mediaImageBlock.execute(
            {
                normalizedScenes: [
                    {
                        sceneNumber: 1,
                        caption: '애니 장면',
                        narration: '기술 이슈를 애니메이션 장면으로 보여줍니다.',
                        imagePrompt: 'a public debate visualized as animated characters',
                        sourceRefs: [],
                        durationSec: 5,
                    },
                ],
            },
            { imageStyleId: 'animation', imageQuality: 'low' },
            {
                runId: 'run-style',
                nodeId: 'node-image',
                onProgress: vi.fn(async () => undefined),
                onAsset: vi.fn(async () => undefined),
                isCancelled: vi.fn(async () => false),
            }
        );

        expect(generateImage).toHaveBeenCalledWith(
            expect.objectContaining({
                style: 'animation',
                quality: 'low',
                prompt: expect.stringContaining('high-end Korean animation still'),
            })
        );
    });

    it('builds GPT-image-2 prompts that allow useful in-scene text without delegating final overlays', () => {
        const prompt = buildGptImage2ScenePrompt({
            styleId: 'animation',
            title: '기술 이슈',
            caption: '핵심은 여기',
            narration: '이 논란은 숫자보다 신뢰 문제입니다.',
            visualPrompt: 'animated people arguing around a statistics dashboard',
        });

        expect(prompt).toContain('high-end Korean animation still');
        expect(prompt).toContain('Short Korean or English in-scene signage');
        expect(prompt).toContain('이 논란은 숫자보다 신뢰 문제입니다.');
    });

    it('keeps selected photorealistic style from being overridden by stale comic scene words', () => {
        const prompt = buildGptImage2ScenePrompt({
            styleId: 'photo-real',
            title: '세레브라스 상장',
            caption: '나스닥 간다',
            narration: '세레브라스가 IPO 절차에 들어갔습니다.',
            visualPrompt: 'comic-style newsroom scene with cartoon presenter holding a chip document',
        });

        expect(prompt).toContain('photorealistic editorial image');
        expect(prompt).not.toContain('comic-style');
        expect(prompt).not.toContain('cartoon');
        expect(prompt).toContain('newsroom scene with presenter holding a chip document');
    });

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

    it('records structured batch and scene traces for successful image generation', async () => {
        const onAsset = vi.fn(async () => undefined);

        const result = await mediaImageBlock.execute(
            {
                normalizedScenes: [
                    {
                        sceneNumber: 1,
                        caption: '첫 장면',
                        imagePrompt: 'success one',
                        sourceRefs: [],
                        durationSec: 5,
                    },
                    {
                        sceneNumber: 2,
                        caption: '둘째 장면',
                        imagePrompt: 'success two',
                        sourceRefs: [],
                        durationSec: 5,
                    },
                ],
            },
            undefined,
            {
                runId: 'run-trace',
                nodeId: 'node-image',
                onProgress: vi.fn(async () => undefined),
                onAsset,
                isCancelled: vi.fn(async () => false),
            }
        );

        expect(result.assets).toHaveLength(2);
        expect(onAsset).not.toHaveBeenCalled();

        const events = traceRecord.mock.calls
            .map(call => call[4] as { event?: string; sceneNumber?: number; expectedSceneCount?: number } | undefined)
            .filter(Boolean);

        expect(events).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    event: 'batch.started',
                    expectedSceneCount: 2,
                }),
                expect.objectContaining({
                    event: 'scene.openai.requested',
                    sceneNumber: 1,
                    expectedSceneCount: 2,
                }),
                expect.objectContaining({
                    event: 'scene.openai.completed',
                    sceneNumber: 1,
                    expectedSceneCount: 2,
                }),
                expect.objectContaining({
                    event: 'scene.upload.completed',
                    sceneNumber: 1,
                    expectedSceneCount: 2,
                }),
                expect.objectContaining({
                    event: 'batch.completed',
                    expectedSceneCount: 2,
                }),
            ])
        );
    });

    it('records structured failure traces when a scene fails', async () => {
        const onAsset = vi.fn(async () => undefined);

        await expect(
            mediaImageBlock.execute(
                {
                    normalizedScenes: [
                        {
                            sceneNumber: 1,
                            caption: '성공 장면',
                            imagePrompt: 'success one',
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
                    runId: 'run-failure-trace',
                    nodeId: 'node-image',
                    onProgress: vi.fn(async () => undefined),
                    onAsset,
                    isCancelled: vi.fn(async () => false),
                }
            )
        ).rejects.toThrow(/image provider failed/);

        expect(onAsset).not.toHaveBeenCalled();

        const events = traceRecord.mock.calls
            .map(call => call[4] as { event?: string; sceneNumber?: number; errorCode?: string } | undefined)
            .filter(Boolean);

        expect(events).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    event: 'scene.failed',
                    sceneNumber: 2,
                    errorCode: 'IMAGE_PROVIDER_ERROR',
                }),
                expect.objectContaining({
                    event: 'batch.failed',
                    errorCode: 'IMAGE_PROVIDER_ERROR',
                }),
            ])
        );
        expect(deleteUploadedObject).toHaveBeenCalledWith(expect.stringMatching(/scene-001\.png$/));
    });

    it('records scene.timeout when a provider request hangs past the scene timeout', async () => {
        await expect(
            mediaImageBlock.execute(
                {
                    normalizedScenes: [
                        {
                            sceneNumber: 1,
                            caption: '타임아웃 장면',
                            imagePrompt: 'hang',
                            sourceRefs: [],
                            durationSec: 5,
                        },
                    ],
                },
                undefined,
                {
                    runId: 'run-timeout-trace',
                    nodeId: 'node-image',
                    onProgress: vi.fn(async () => undefined),
                    onAsset: vi.fn(async () => undefined),
                    isCancelled: vi.fn(async () => false),
                }
            )
        ).rejects.toThrow(/timed out/i);

        const events = traceRecord.mock.calls
            .map(call => call[4] as { event?: string; sceneNumber?: number; errorCode?: string } | undefined)
            .filter(Boolean);

        expect(events).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    event: 'scene.timeout',
                    sceneNumber: 1,
                    errorCode: 'IMAGE_TIMEOUT',
                }),
            ])
        );
    });

    it('records scene.timeout exactly once when the provider rejects on abort', async () => {
        await expect(
            mediaImageBlock.execute(
                {
                    normalizedScenes: [
                        {
                            sceneNumber: 1,
                            caption: 'abort-aware timeout',
                            imagePrompt: 'abort-timeout',
                            sourceRefs: [],
                            durationSec: 5,
                        },
                    ],
                },
                undefined,
                {
                    runId: 'run-abort-timeout-trace',
                    nodeId: 'node-image',
                    onProgress: vi.fn(async () => undefined),
                    onAsset: vi.fn(async () => undefined),
                    isCancelled: vi.fn(async () => false),
                }
            )
        ).rejects.toThrow(/timed out/i);

        const timeoutEvents = traceRecord.mock.calls
            .map(call => call[4] as { event?: string; sceneNumber?: number; errorCode?: string } | undefined)
            .filter(event => event?.event === 'scene.timeout');

        expect(timeoutEvents).toHaveLength(1);
        expect(timeoutEvents[0]).toEqual(
            expect.objectContaining({
                sceneNumber: 1,
                errorCode: 'IMAGE_TIMEOUT',
            })
        );
    });

    it('fails a stuck image batch with a batch timeout before waiting for scene timeouts', async () => {
        const startedAt = Date.now();

        await expect(
            mediaImageBlock.execute(
                {
                    normalizedScenes: [
                        {
                            sceneNumber: 1,
                            caption: '멈춘 장면 1',
                            imagePrompt: 'hang scene one',
                            sourceRefs: [],
                            durationSec: 5,
                        },
                        {
                            sceneNumber: 2,
                            caption: '멈춘 장면 2',
                            imagePrompt: 'hang scene two',
                            sourceRefs: [],
                            durationSec: 5,
                        },
                    ],
                },
                { imageBatchTimeoutMs: 20 },
                {
                    runId: 'run-batch-timeout',
                    nodeId: 'node-image',
                    onProgress: vi.fn(async () => undefined),
                    onAsset: vi.fn(async () => undefined),
                    isCancelled: vi.fn(async () => false),
                }
            )
        ).rejects.toThrow(/batch timed out/i);

        expect(Date.now() - startedAt).toBeLessThan(200);

        const events = traceRecord.mock.calls
            .map(call => call[4] as { event?: string; pendingScenes?: number[]; errorCode?: string } | undefined)
            .filter(Boolean);

        expect(events).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    event: 'batch.timeout',
                    errorCode: 'IMAGE_TIMEOUT',
                    pendingScenes: [1, 2],
                }),
                expect.objectContaining({
                    event: 'batch.failed',
                    errorCode: 'IMAGE_TIMEOUT',
                    pendingScenes: [1, 2],
                }),
            ])
        );
    });

    it('enforces batch timeout even if timeout trace reporting hangs', async () => {
        traceRecord.mockImplementation(async (_runId, _nodeId, _traceType, message) => {
            if (message === 'media-image:batch.timeout') {
                return await new Promise(() => undefined);
            }
            return undefined;
        });
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
                    ],
                },
                { imageBatchTimeoutMs: 20 },
                {
                    runId: 'run-hanging-timeout-trace',
                    nodeId: 'node-image',
                    onProgress: vi.fn(async () => undefined),
                    onAsset: vi.fn(async () => undefined),
                    isCancelled: vi.fn(async () => false),
                }
            )
        ).rejects.toThrow(/batch timed out/i);

        expect(Date.now() - startedAt).toBeLessThan(200);
    });
});
