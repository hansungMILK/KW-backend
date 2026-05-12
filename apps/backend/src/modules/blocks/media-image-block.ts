import { randomUUID } from 'crypto';

import { runWithConcurrency } from './concurrency';
import { imageAdapter } from '../../adapters/ai/image-adapter';
import { deleteObject, getPublicUrl, putObject } from '../../adapters/aws/s3';
import { env } from '../../config/env';
import { traceService } from '../../services/trace-service';
import {
    GPT_IMAGE_MODEL,
    buildGptImage2ScenePrompt,
    getImageStylePreset,
    normalizeImageQuality,
} from '../image-generation/image-style';
import { sourceRefsToLabel } from '../shorts/rulepacks/base-shorts-rulepack';
import { selectShortsRulepack } from '../shorts/topic-router';

import type { BlockExecutor, BlockExecutorContext, BlockExecutorResult } from './types';

const IMAGE_SCENE_TIMEOUT_MS = env.openaiImageSceneTimeoutMs;
const IMAGE_SCENE_MAX_ATTEMPTS = env.openaiImageSceneMaxAttempts;
const IMAGE_SCENE_CONCURRENCY = env.openaiImageSceneConcurrency;
const IMAGE_BATCH_TIMEOUT_BUFFER_MS = env.openaiImageBatchTimeoutBufferMs;

class BlockCancelledError extends Error {
    constructor(message = 'Run cancelled during media-image execution') {
        super(message);
        this.name = 'BlockCancelledError';
    }
}

// ─── dummy output ─────────────────────────────────────────────────────────────

function dummyImageOutput() {
    return {
        images: Array.from({ length: 10 }, (_, index) => ({
            sceneNumber: index + 1,
            url: `fake://cdn.example.com/images/scene-${String(index + 1).padStart(3, '0')}-generic-summary.jpg`,
            width: 1080,
            height: 1920,
            prompt: `[dummy] Generic Korean information explainer scene ${index + 1}, clean vertical shorts framing, concise in-scene text allowed`,
        })),
    };
}

// ─── block ───────────────────────────────────────────────────────────────────

export const mediaImageBlock: BlockExecutor = {
    blockType: 'media-image',

    async execute(
        input: unknown,
        config?: Record<string, unknown>,
        context?: BlockExecutorContext
    ): Promise<BlockExecutorResult> {
        const start = Date.now();

        if (env.orchestratorMode === 'mock') {
            const output = dummyImageOutput();
            return {
                output,
                durationMs: Date.now() - start,
                assets: output.images.map(image => ({
                    assetType: 'IMAGE',
                    mimeType: 'image/png',
                    data: image.url,
                    metadata: {
                        sceneNumber: image.sceneNumber,
                        width: image.width,
                        height: image.height,
                        prompt: image.prompt,
                    },
                })),
            };
        }

        // ── Real mode ──────────────────────────────────────────────────────────
        await throwIfCancelled(context);

        // Extract scene image prompts from upstream data/content block output.
        // Supports two upstream shapes:
        //   data block:    { normalizedScenes: [{ sceneNumber, imagePrompt, ... }] }
        //   content block: { scenes: [{ sceneNumber, imagePrompt, ... }] }
        const inp = input as Record<string, unknown> | null;
        type RawScene = {
            sceneNumber?: number;
            caption?: string;
            narration?: string;
            imagePrompt?: string;
            visualText?: string;
            visual?: {
                topTitle?: string;
                mainCaption?: string;
                sourceLabel?: string;
            };
            topTitle?: string;
            sourceRefs?: unknown[];
            durationSec?: number;
        };
        const rawScenes: RawScene[] =
            (inp?.normalizedScenes as RawScene[] | undefined) ?? (inp?.scenes as RawScene[] | undefined) ?? [];
        const metadata = inp?.metadata as Record<string, unknown> | undefined;
        const rulepack = selectShortsRulepack({
            title: metadata?.title,
            keywords: rawScenes.flatMap(scene => (Array.isArray(scene.sourceRefs) ? scene.sourceRefs : [])),
            presetId: metadata?.presetId,
        });
        const sources = metadata?.sources;
        const sceneTopTitle = rawScenes.find(scene => scene.visual?.topTitle || scene.topTitle);
        const frameTitle =
            sceneTopTitle?.visual?.topTitle ??
            sceneTopTitle?.topTitle ??
            (typeof metadata?.title === 'string' ? metadata.title : undefined) ??
            (typeof inp?.title === 'string' ? inp.title : undefined) ??
            '핵심 이슈 정리';
        const imageStyle = getImageStylePreset(config?.['imageStyleId'] ?? config?.['style']);
        const imageQuality = normalizeImageQuality(config?.['imageQuality'] ?? env.openaiImageQuality);

        if (rawScenes.length === 0) {
            throw new Error('media-image requires upstream scenes or normalizedScenes in real execution mode');
        }

        const scenePrompts: Array<{
            sceneNumber: number;
            caption: string;
            narration: string;
            durationSec: number;
            prompt: string;
            visualText?: string;
            sourceRefs?: unknown[];
            sourceLabel?: string;
        }> = rawScenes.map((s, i) => {
            const caption =
                s.visual?.mainCaption ?? s.visualText ?? s.caption ?? s.narration?.slice(0, 22) ?? `장면 ${i + 1}`;
            const title = s.visual?.topTitle ?? s.topTitle ?? frameTitle;
            const sourceLabel =
                cleanSourceLabel(s.visual?.sourceLabel) || sourceRefsToLabel(s.sourceRefs, sources) || undefined;
            return {
                sceneNumber: s.sceneNumber ?? i + 1,
                caption,
                narration: s.narration ?? '',
                durationSec: s.durationSec ?? 5,
                visualText: s.visualText ?? caption,
                sourceRefs: s.sourceRefs ?? [],
                sourceLabel,
                prompt: buildGptImage2ScenePrompt({
                    styleId: imageStyle.id,
                    title,
                    caption,
                    narration: s.narration,
                    visualPrompt: s.imagePrompt,
                    sourceLabel,
                    presetImageRules: rulepack.imagePrompt,
                    format: config?.['style'] === 'single-image' ? 'single-image' : 'shorts-frame',
                }),
            };
        });

        // Unique prefix for this execution batch
        const batchPrefix = `media/images/${randomUUID()}`;
        const batchId = batchPrefix.split('/').pop() ?? batchPrefix;

        type ImageResult = {
            sceneNumber: number;
            url: string;
            width: number;
            height: number;
            prompt: string;
            caption?: string;
            narration?: string;
            durationSec?: number;
            visualText?: string;
            sourceRefs?: unknown[];
            sourceLabel?: string;
        };

        console.info(
            `[media-image-block] generating ${scenePrompts.length} scenes with concurrency ${IMAGE_SCENE_CONCURRENCY}`
        );

        const totalScenes = scenePrompts.length;
        const batchTimeoutMs = readPositiveInt(
            config?.['imageBatchTimeoutMs'],
            calculateImageBatchTimeoutMs(totalScenes, IMAGE_SCENE_CONCURRENCY)
        );
        let completedScenes = 0;
        const completedSceneNumbers = new Set<number>();
        const traceBase = {
            batchId,
            concurrency: IMAGE_SCENE_CONCURRENCY,
            batchTimeoutMs,
            expectedSceneCount: totalScenes,
            maxProviderRequests: totalScenes * IMAGE_SCENE_MAX_ATTEMPTS,
            provider: 'openai',
            model: GPT_IMAGE_MODEL,
            quality: imageQuality,
            imageStyleId: imageStyle.id,
            imageStyleLabel: imageStyle.label,
        } as const;

        const recordImageTrace = async (
            event: string,
            traceType: 'STATUS' | 'ERROR',
            data?: Record<string, unknown>
        ): Promise<void> => {
            try {
                await traceService.record(
                    context?.runId ?? 'pending',
                    context?.nodeId ?? null,
                    traceType,
                    `media-image:${event}`,
                    {
                        event,
                        ...traceBase,
                        assetCountSoFar: completedScenes,
                        ...data,
                    }
                );
            } catch {
                /* traceService is already non-fatal */
            }
        };

        const pendingSceneNumbers = (): number[] =>
            scenePrompts.map(scene => scene.sceneNumber).filter(sceneNumber => !completedSceneNumbers.has(sceneNumber));

        await recordImageTrace('batch.started', 'STATUS', {
            timeoutMs: batchTimeoutMs,
        });

        const reportSceneComplete = async (sceneNumber: number): Promise<void> => {
            await throwIfCancelled(context);
            completedSceneNumbers.add(sceneNumber);
            completedScenes += 1;
            const progress = 25 + (completedScenes / totalScenes) * 60;
            await context?.onProgress?.(
                progress,
                `이미지 ${completedScenes}/${totalScenes} 생성 완료 (scene ${sceneNumber})`
            );
        };

        const activeSceneAttempts = new Map<number, string>();
        const recordedTimeoutAttempts = new Set<string>();
        const uploadedKeys = new Set<string>();
        const maxProviderRequests = totalScenes * IMAGE_SCENE_MAX_ATTEMPTS;
        let providerRequestsStarted = 0;

        const cleanupUploadedKeys = async (): Promise<void> => {
            for (const key of [...uploadedKeys].reverse()) {
                try {
                    await deleteObject(key);
                    uploadedKeys.delete(key);
                } catch (err) {
                    await recordImageTrace('storage.cleanup.failed', 'ERROR', {
                        s3Key: key,
                        errorMessage: err instanceof Error ? err.message : String(err),
                    });
                }
            }
        };

        const recordSceneTimeoutOnce = async (
            sceneNumber: number,
            attempt: number,
            durationMs: number,
            errorMessage: string
        ): Promise<void> => {
            const key = `${sceneNumber}:${attempt}`;
            if (recordedTimeoutAttempts.has(key)) return;
            recordedTimeoutAttempts.add(key);
            await recordImageTrace('scene.timeout', 'ERROR', {
                sceneNumber,
                attempt,
                durationMs,
                errorCode: 'IMAGE_TIMEOUT',
                errorMessage,
            });
        };

        const reserveProviderRequest = async (sceneNumber: number, attempt: number): Promise<number> => {
            if (providerRequestsStarted >= maxProviderRequests) {
                const error = new Error(
                    `media-image provider request budget exceeded (${maxProviderRequests} requests)`
                );
                await recordImageTrace('batch.provider_request_budget_exceeded', 'ERROR', {
                    sceneNumber,
                    attempt,
                    providerRequestsStarted,
                    maxProviderRequests,
                    errorCode: 'IMAGE_PROVIDER_REQUEST_BUDGET_EXCEEDED',
                    errorMessage: error.message,
                });
                throw error;
            }

            providerRequestsStarted += 1;
            return providerRequestsStarted;
        };

        const generateSceneImage = async (
            scene: (typeof scenePrompts)[number],
            attemptId: string,
            attempt: number,
            signal: AbortSignal
        ): Promise<{ image: ImageResult; asset: NonNullable<BlockExecutorResult['assets']>[number] }> => {
            const sceneStart = Date.now();
            try {
                await throwIfCancelled(context);
                await recordImageTrace('scene.started', 'STATUS', {
                    sceneNumber: scene.sceneNumber,
                    attempt,
                });

                // 1. Generate image via the configured OpenAI image model.
                const providerRequestNumber = await reserveProviderRequest(scene.sceneNumber, attempt);
                await recordImageTrace('scene.openai.requested', 'STATUS', {
                    sceneNumber: scene.sceneNumber,
                    attempt,
                    providerRequestNumber,
                    maxProviderRequests,
                });
                const openAiStart = Date.now();
                const generated = await imageAdapter.generate({
                    prompt: scene.prompt,
                    width: 1080,
                    height: 1920,
                    style: imageStyle.id,
                    quality: imageQuality,
                    signal,
                });
                await recordImageTrace('scene.openai.completed', 'STATUS', {
                    sceneNumber: scene.sceneNumber,
                    attempt,
                    providerRequestNumber,
                    durationMs: Date.now() - openAiStart,
                });
                throwIfAborted(signal);
                await throwIfCancelled(context);

                // 2. Fetch the temporary image URL and upload to S3
                let imageBuffer = generated.imageBuffer;
                if (!imageBuffer && generated.imageUrl) {
                    throwIfAborted(signal);
                    const imageResponse = await fetch(generated.imageUrl, { signal });
                    if (!imageResponse.ok) {
                        throw new Error(`Failed to fetch generated image: ${imageResponse.status}`);
                    }
                    imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
                }
                throwIfAborted(signal);
                if (!imageBuffer) throw new Error('Image provider returned no downloadable image');
                await throwIfCancelled(context);

                const s3Key = `${batchPrefix}/scene-${String(scene.sceneNumber).padStart(3, '0')}.png`;
                throwIfAborted(signal);
                await recordImageTrace('scene.upload.started', 'STATUS', {
                    sceneNumber: scene.sceneNumber,
                    attempt,
                });
                const uploadStart = Date.now();
                await putObject(s3Key, imageBuffer, generated.contentType);
                uploadedKeys.add(s3Key);
                await recordImageTrace('scene.upload.completed', 'STATUS', {
                    sceneNumber: scene.sceneNumber,
                    attempt,
                    durationMs: Date.now() - uploadStart,
                    s3Key,
                });
                throwIfAborted(signal);
                await throwIfCancelled(context);

                if (activeSceneAttempts.get(scene.sceneNumber) !== attemptId) {
                    throw new Error(`stale scene ${scene.sceneNumber} image attempt ignored`);
                }

                const publicUrl = getPublicUrl(s3Key);
                const durationMs = Date.now() - sceneStart;

                const image: ImageResult = {
                    sceneNumber: scene.sceneNumber,
                    url: publicUrl,
                    width: generated.width,
                    height: generated.height,
                    prompt: scene.prompt,
                    caption: scene.caption,
                    narration: scene.narration,
                    durationSec: scene.durationSec,
                    visualText: scene.visualText,
                    sourceRefs: scene.sourceRefs,
                    sourceLabel: scene.sourceLabel,
                };

                const asset: NonNullable<BlockExecutorResult['assets']>[number] = {
                    assetType: 'IMAGE',
                    mimeType: generated.contentType,
                    data: imageBuffer,
                    metadata: {
                        sceneNumber: scene.sceneNumber,
                        s3Key,
                        width: generated.width,
                        height: generated.height,
                        prompt: scene.prompt,
                        caption: scene.caption,
                        narration: scene.narration,
                        durationSec: scene.durationSec,
                        visualText: scene.visualText,
                        sourceRefs: scene.sourceRefs,
                        sourceLabel: scene.sourceLabel,
                        durationMs,
                    },
                };

                await recordImageTrace('scene.completed', 'STATUS', {
                    sceneNumber: scene.sceneNumber,
                    attempt,
                    durationMs,
                    s3Key,
                });

                await throwIfCancelled(context);
                await reportSceneComplete(scene.sceneNumber);

                return { image, asset };
            } catch (err: unknown) {
                if (isCancellationError(context, err)) {
                    throw new BlockCancelledError();
                }

                const msg = err instanceof Error ? err.message : String(err);
                const errorCode = classifyImageError(err);
                console.error(`[media-image-block] scene ${scene.sceneNumber} failed: ${msg}`);
                if (errorCode === 'IMAGE_TIMEOUT') {
                    await recordSceneTimeoutOnce(scene.sceneNumber, attempt, Date.now() - sceneStart, msg);
                } else {
                    await recordImageTrace('scene.failed', 'ERROR', {
                        sceneNumber: scene.sceneNumber,
                        attempt,
                        durationMs: Date.now() - sceneStart,
                        errorCode,
                        errorMessage: msg,
                    });
                }
                throw new Error(`media-image scene ${scene.sceneNumber} failed: ${msg}`);
            }
        };

        const generateSceneImageWithRetries = async (
            scene: (typeof scenePrompts)[number],
            parentSignal: AbortSignal
        ): Promise<{ image: ImageResult; asset: NonNullable<BlockExecutorResult['assets']>[number] }> => {
            let lastError: unknown;

            for (let attempt = 1; attempt <= IMAGE_SCENE_MAX_ATTEMPTS; attempt += 1) {
                await throwIfCancelled(context);
                throwIfAborted(parentSignal);

                const attemptId = randomUUID();
                activeSceneAttempts.set(scene.sceneNumber, attemptId);
                const { controller, cleanup } = createLinkedAbortController(parentSignal);
                const attemptStart = Date.now();
                const attemptPromise = generateSceneImage(scene, attemptId, attempt, controller.signal);
                const timeoutMessage = `media-image scene ${scene.sceneNumber} timed out after ${Math.round(
                    IMAGE_SCENE_TIMEOUT_MS / 1000
                )} seconds`;

                try {
                    return await withTimeoutAndAbort(
                        attemptPromise,
                        IMAGE_SCENE_TIMEOUT_MS,
                        timeoutMessage,
                        controller
                    );
                } catch (err) {
                    activeSceneAttempts.set(scene.sceneNumber, `inactive:${attemptId}`);
                    void attemptPromise.catch(() => {
                        /* late attempt already superseded */
                    });
                    cleanup();

                    if (isCancellationError(context, err)) {
                        throw new BlockCancelledError();
                    }

                    lastError = err;
                    if (classifyImageError(err) === 'IMAGE_TIMEOUT') {
                        await recordSceneTimeoutOnce(
                            scene.sceneNumber,
                            attempt,
                            Date.now() - attemptStart,
                            err instanceof Error ? err.message : String(err)
                        );
                    }

                    const shouldRetry = isRetryableSceneImageError(err);
                    if (attempt < IMAGE_SCENE_MAX_ATTEMPTS && shouldRetry) {
                        console.warn(
                            `[media-image-block] scene ${scene.sceneNumber} attempt ${attempt}/${IMAGE_SCENE_MAX_ATTEMPTS} failed; retrying: ${
                                err instanceof Error ? err.message : String(err)
                            }`
                        );
                    } else if (attempt < IMAGE_SCENE_MAX_ATTEMPTS && !shouldRetry) {
                        await recordImageTrace('scene.retry.skipped', 'STATUS', {
                            sceneNumber: scene.sceneNumber,
                            attempt,
                            errorCode: classifyImageError(err),
                            reason: 'non-retryable image provider error',
                        });
                        break;
                    }
                } finally {
                    cleanup();
                }
            }

            throw lastError instanceof Error ? lastError : new Error(`media-image scene ${scene.sceneNumber} failed`);
        };

        const { controller: batchController, cleanup: cleanupBatchController } = createLinkedAbortController(
            context?.abortSignal
        );
        const batchTimeoutPromise = rejectAfterTimeoutAndAbort(
            batchController,
            batchTimeoutMs,
            `media-image batch timed out after ${Math.round(batchTimeoutMs / 1000)} seconds`,
            async error => {
                await recordImageTrace('batch.timeout', 'ERROR', {
                    durationMs: Date.now() - start,
                    errorCode: 'IMAGE_TIMEOUT',
                    errorMessage: error.message,
                    pendingScenes: pendingSceneNumbers(),
                });
            }
        );
        let settledResults: PromiseSettledResult<{
            image: ImageResult;
            asset: NonNullable<BlockExecutorResult['assets']>[number];
        }>[];
        try {
            settledResults = await Promise.race([
                runWithConcurrency(
                    scenePrompts,
                    IMAGE_SCENE_CONCURRENCY,
                    async scene => {
                        await throwIfCancelled(context);
                        throwIfAborted(batchController.signal);

                        try {
                            return await generateSceneImageWithRetries(scene, batchController.signal);
                        } catch (err) {
                            if (!isCancellationError(context, err) && !batchController.signal.aborted) {
                                batchController.abort(err instanceof Error ? err : new Error(String(err)));
                            }
                            throw err;
                        }
                    },
                    { shouldStop: () => batchController.signal.aborted }
                ),
                rejectOnAbort(batchController.signal),
                batchTimeoutPromise.promise,
            ]);
        } catch (err) {
            const cancellation = isCancellationError(context, err);
            await cleanupUploadedKeys();
            await recordImageTrace(
                cancellation ? 'batch.cancelled' : 'batch.failed',
                cancellation ? 'STATUS' : 'ERROR',
                {
                    durationMs: Date.now() - start,
                    errorCode: cancellation ? 'RUN_CANCELLED' : classifyImageError(err),
                    errorMessage: err instanceof Error ? err.message : String(err),
                    pendingScenes: pendingSceneNumbers(),
                }
            );
            throw err;
        } finally {
            batchTimeoutPromise.cancel();
            cleanupBatchController();
        }

        throwIfAborted(batchController.signal);

        const missingIndexes: number[] = [];
        for (let index = 0; index < settledResults.length; index += 1) {
            if (!Object.hasOwn(settledResults, index)) {
                missingIndexes.push(index);
            }
        }
        if (missingIndexes.length > 0) {
            const error = new Error(
                `media-image stopped before ${missingIndexes.length} scene(s) completed: ${missingIndexes
                    .map(index => scenePrompts[index]?.sceneNumber ?? index + 1)
                    .join(', ')}`
            );
            await cleanupUploadedKeys();
            await recordImageTrace('batch.failed', 'ERROR', {
                durationMs: Date.now() - start,
                errorCode: 'IMAGE_BATCH_INCOMPLETE',
                errorMessage: error.message,
                missingScenes: missingIndexes.map(index => scenePrompts[index]?.sceneNumber ?? index + 1),
            });
            throw error;
        }

        const generatedResults: Array<{
            image: ImageResult;
            asset: NonNullable<BlockExecutorResult['assets']>[number];
        }> = [];
        const failureMessages: string[] = [];

        settledResults.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                generatedResults.push(result.value);
            } else if (isCancellationError(context, result.reason)) {
                throw new BlockCancelledError();
            } else {
                failureMessages.push(`scene ${scenePrompts[index]?.sceneNumber ?? index + 1}: ${result.reason}`);
            }
        });

        if (failureMessages.length > 0) {
            const error = new Error(
                `media-image failed after ${generatedResults.length}/${totalScenes} scenes: ${failureMessages.join('; ')}`
            );
            await cleanupUploadedKeys();
            await recordImageTrace('batch.failed', 'ERROR', {
                durationMs: Date.now() - start,
                errorCode: 'IMAGE_PROVIDER_ERROR',
                errorMessage: error.message,
                generatedSceneCount: generatedResults.length,
            });
            throw error;
        }

        generatedResults.sort((a, b) => a.image.sceneNumber - b.image.sceneNumber);

        const images = generatedResults.map(result => result.image);
        const assets = generatedResults.map(result => result.asset);

        if (assets.length === 0) {
            const error = new Error('media-image generated no usable image assets');
            await cleanupUploadedKeys();
            await recordImageTrace('batch.failed', 'ERROR', {
                durationMs: Date.now() - start,
                errorCode: 'IMAGE_BATCH_INCOMPLETE',
                errorMessage: error.message,
            });
            throw error;
        }

        await recordImageTrace('batch.completed', 'STATUS', {
            durationMs: Date.now() - start,
            generatedSceneCount: images.length,
        });

        return {
            output: {
                title: frameTitle,
                images,
                normalizedScenes: scenePrompts,
                ...(metadata ? { metadata } : {}),
            },
            durationMs: Date.now() - start,
            assets,
        };
    },
};

async function throwIfCancelled(context?: BlockExecutorContext): Promise<void> {
    if (context?.abortSignal?.aborted) throw new BlockCancelledError();
    if (await context?.isCancelled?.()) throw new BlockCancelledError();
}

function isCancellationError(context: BlockExecutorContext | undefined, err: unknown): boolean {
    if (err instanceof BlockCancelledError) return true;
    if (context?.abortSignal?.aborted) return true;
    return err instanceof Error && /cancelled/i.test(err.message);
}

function throwIfAborted(signal: AbortSignal): void {
    if (!signal.aborted) return;
    throw abortReasonToError(signal.reason, 'media-image batch aborted');
}

function rejectOnAbort(signal: AbortSignal): Promise<never> {
    if (signal.aborted) return Promise.reject(abortReasonToError(signal.reason, 'media-image batch aborted'));

    return new Promise((_, reject) => {
        const onAbort = (): void => {
            signal.removeEventListener('abort', onAbort);
            reject(abortReasonToError(signal.reason, 'media-image batch aborted'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
    });
}

function abortReasonToError(reason: unknown, fallback: string): Error {
    if (reason instanceof Error) return reason;
    return new Error(typeof reason === 'string' && reason ? reason : fallback);
}

function classifyImageError(err: unknown): string {
    if (err instanceof BlockCancelledError) return 'RUN_CANCELLED';
    if (err instanceof Error) {
        if (err.name === 'TimeoutError' || /timed out|timeout/i.test(err.message)) return 'IMAGE_TIMEOUT';
        if (/provider request budget exceeded/i.test(err.message)) return 'IMAGE_PROVIDER_REQUEST_BUDGET_EXCEEDED';
        const status = err.message.match(/OpenAI image API error (\d+)/)?.[1];
        if (status) return `IMAGE_PROVIDER_${status}`;
        if (/cancelled|aborted/i.test(err.message)) return 'RUN_CANCELLED';
    }
    return 'IMAGE_PROVIDER_ERROR';
}

function isRetryableSceneImageError(err: unknown): boolean {
    const errorCode = classifyImageError(err);
    if (errorCode === 'IMAGE_TIMEOUT') return true;

    const status = errorCode.match(/^IMAGE_PROVIDER_(\d+)$/)?.[1];
    if (!status) return false;

    const statusCode = Number(status);
    return statusCode === 408 || statusCode === 409 || statusCode === 429 || statusCode >= 500;
}

function createLinkedAbortController(parentSignal?: AbortSignal): {
    controller: AbortController;
    cleanup: () => void;
} {
    const controller = new AbortController();
    const abortFromParent = () => controller.abort(parentSignal?.reason);

    if (parentSignal?.aborted) {
        controller.abort(parentSignal.reason);
        return { controller, cleanup: () => undefined };
    }

    parentSignal?.addEventListener('abort', abortFromParent, { once: true });

    return {
        controller,
        cleanup: () => parentSignal?.removeEventListener('abort', abortFromParent),
    };
}

function cleanSourceLabel(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const compact = value.replace(/\s+/g, ' ').trim();
    if (!compact || compact === '출처 확인 필요') return undefined;
    if (/^source-\d+$/i.test(compact)) return undefined;
    return compact;
}

function withTimeoutAndAbort<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string,
    controller: AbortController
): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
            const timeoutError = new Error(message);
            timeoutError.name = 'TimeoutError';
            controller.abort(timeoutError);
            reject(timeoutError);
        }, timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
        if (timeout) clearTimeout(timeout);
    });
}

function rejectAfterTimeoutAndAbort(
    controller: AbortController,
    timeoutMs: number,
    message: string,
    onTimeout?: (error: Error) => Promise<void>
): {
    promise: Promise<never>;
    cancel: () => void;
} {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const clear = (): void => {
        if (!timeout) return;
        clearTimeout(timeout);
        timeout = undefined;
    };

    const promise = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
            const timeoutError = new Error(message);
            timeoutError.name = 'TimeoutError';
            controller.abort(timeoutError);
            reject(timeoutError);
            void onTimeout?.(timeoutError).catch(() => {
                /* timeout reporting must never block timeout enforcement */
            });
        }, timeoutMs);

        controller.signal.addEventListener('abort', clear, { once: true });
    }).finally(() => {
        clear();
        controller.signal.removeEventListener('abort', clear);
    });

    return {
        promise,
        cancel: clear,
    };
}

function calculateImageBatchTimeoutMs(totalScenes: number, concurrency: number): number {
    const boundedScenes = Math.max(1, totalScenes);
    const boundedConcurrency = Math.max(1, concurrency);
    const waves = Math.ceil(boundedScenes / boundedConcurrency);
    return Math.max(1, waves * IMAGE_SCENE_TIMEOUT_MS * IMAGE_SCENE_MAX_ATTEMPTS + IMAGE_BATCH_TIMEOUT_BUFFER_MS);
}

function readPositiveInt(value: unknown, fallback: number): number {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.max(1, Math.floor(value));
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return Math.max(1, Math.floor(parsed));
    }
    return fallback;
}
