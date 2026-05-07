import { randomUUID } from 'crypto';

import { imageAdapter } from '../../adapters/ai/image-adapter';
import { getPublicUrl, putObject } from '../../adapters/aws/s3';
import { env } from '../../config/env';
import { traceService } from '../../services/trace-service';
import { sourceRefsToLabel } from '../shorts/rulepacks/base-shorts-rulepack';
import { selectShortsRulepack } from '../shorts/topic-router';

import type { BlockExecutor, BlockExecutorContext, BlockExecutorResult } from './types';

const IMAGE_SCENE_TIMEOUT_MS = env.openaiImageSceneTimeoutMs;
const IMAGE_SCENE_MAX_ATTEMPTS = env.openaiImageSceneMaxAttempts;
const IMAGE_SCENE_CONCURRENCY = env.openaiImageSceneConcurrency;

// ─── dummy output ─────────────────────────────────────────────────────────────

function dummyImageOutput() {
    return {
        images: [
            {
                sceneNumber: 1,
                url: 'fake://cdn.example.com/images/scene-001-student-study.jpg',
                width: 1080,
                height: 1920,
                prompt: '[dummy] A student nervously studying late at night, books and notes spread on desk, warm lamp light, cinematic',
            },
            {
                sceneNumber: 2,
                url: 'fake://cdn.example.com/images/scene-002-exam-paper.jpg',
                width: 1080,
                height: 1920,
                prompt: '[dummy] Close-up of Korean language exam paper with highlighted passages, clean white background',
            },
            {
                sceneNumber: 3,
                url: 'fake://cdn.example.com/images/scene-003-math-equations.jpg',
                width: 1080,
                height: 1920,
                prompt: '[dummy] Complex math equations floating in a blue abstract digital space, dramatic lighting',
            },
            {
                sceneNumber: 4,
                url: 'fake://cdn.example.com/images/scene-004-expert-graph.jpg',
                width: 1080,
                height: 1920,
                prompt: '[dummy] Expert teacher pointing at a graph showing difficulty trends, professional setting',
            },
            {
                sceneNumber: 5,
                url: 'fake://cdn.example.com/images/scene-005-calendar-december.jpg',
                width: 1080,
                height: 1920,
                prompt: '[dummy] Calendar showing December dates circled in red, urgency visual',
            },
            {
                sceneNumber: 6,
                url: 'fake://cdn.example.com/images/scene-006-study-papers.jpg',
                width: 1080,
                height: 1920,
                prompt: '[dummy] Stack of past exam papers with sticky notes, organized study setup, motivational atmosphere',
            },
            {
                sceneNumber: 7,
                url: 'fake://cdn.example.com/images/scene-007-student-celebration.jpg',
                width: 1080,
                height: 1920,
                prompt: '[dummy] Triumphant student raising fists in celebration, graduation cap flying, sunny campus background',
            },
            {
                sceneNumber: 8,
                url: 'fake://cdn.example.com/images/scene-008-score-report.jpg',
                width: 1080,
                height: 1920,
                prompt: '[dummy] Korean student reviewing a score report and admission strategy chart, vertical shorts frame',
            },
            {
                sceneNumber: 9,
                url: 'fake://cdn.example.com/images/scene-009-counseling.jpg',
                width: 1080,
                height: 1920,
                prompt: '[dummy] Admission counselor explaining university choices to a student, clean educational illustration',
            },
            {
                sceneNumber: 10,
                url: 'fake://cdn.example.com/images/scene-010-final-checklist.jpg',
                width: 1080,
                height: 1920,
                prompt: '[dummy] Final admission checklist on a smartphone with bold Korean shorts typography',
            },
        ],
    };
}

// ─── block ───────────────────────────────────────────────────────────────────

export const mediaImageBlock: BlockExecutor = {
    blockType: 'media-image',

    async execute(
        input: unknown,
        _config?: Record<string, unknown>,
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
            '입시 정보 핵심 정리';

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
                prompt: buildShortsFramePrompt(title, caption, s.imagePrompt, sourceLabel, rulepack.imagePrompt),
            };
        });

        // Unique prefix for this execution batch
        const batchPrefix = `media/images/${randomUUID()}`;

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

        let completedScenes = 0;
        const totalScenes = scenePrompts.length;

        const reportSceneComplete = async (sceneNumber: number): Promise<void> => {
            completedScenes += 1;
            const progress = 25 + (completedScenes / totalScenes) * 60;
            await context?.onProgress?.(
                progress,
                `이미지 ${completedScenes}/${totalScenes} 생성 완료 (scene ${sceneNumber})`
            );
        };

        const activeSceneAttempts = new Map<number, string>();

        const generateSceneImage = async (
            scene: (typeof scenePrompts)[number],
            attemptId: string
        ): Promise<{ image: ImageResult; asset: NonNullable<BlockExecutorResult['assets']>[number] }> => {
            const sceneStart = Date.now();
            try {
                // 1. Generate image via the configured OpenAI image model.
                const generated = await imageAdapter.generate({
                    prompt: scene.prompt,
                    width: 1080,
                    height: 1920,
                    style: 'realistic',
                });

                // 2. Fetch the temporary image URL and upload to S3
                let imageBuffer = generated.imageBuffer;
                if (!imageBuffer && generated.imageUrl) {
                    const imageResponse = await fetch(generated.imageUrl);
                    if (!imageResponse.ok) {
                        throw new Error(`Failed to fetch generated image: ${imageResponse.status}`);
                    }
                    imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
                }
                if (!imageBuffer) throw new Error('Image provider returned no downloadable image');

                const s3Key = `${batchPrefix}/scene-${String(scene.sceneNumber).padStart(3, '0')}.png`;
                await putObject(s3Key, imageBuffer, generated.contentType);

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

                // Record per-image trace (non-fatal)
                try {
                    await traceService.record(
                        context?.runId ?? 'pending',
                        context?.nodeId ?? null,
                        'STATUS',
                        `media-image: scene ${scene.sceneNumber} generated`,
                        {
                            sceneNumber: scene.sceneNumber,
                            s3Key,
                            durationMs,
                        }
                    );
                } catch {
                    /* non-fatal */
                }

                await context?.onAsset?.(asset);
                await reportSceneComplete(scene.sceneNumber);

                return { image, asset };
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`[media-image-block] scene ${scene.sceneNumber} failed: ${msg}`);
                try {
                    await traceService.record(
                        context?.runId ?? 'pending',
                        context?.nodeId ?? null,
                        'ERROR',
                        `media-image: scene ${scene.sceneNumber} failed: ${msg}`
                    );
                } catch {
                    /* non-fatal */
                }
                throw new Error(`media-image scene ${scene.sceneNumber} failed: ${msg}`);
            }
        };

        const generateSceneImageWithRetries = async (
            scene: (typeof scenePrompts)[number]
        ): Promise<{ image: ImageResult; asset: NonNullable<BlockExecutorResult['assets']>[number] }> => {
            let lastError: unknown;

            for (let attempt = 1; attempt <= IMAGE_SCENE_MAX_ATTEMPTS; attempt += 1) {
                const attemptId = randomUUID();
                activeSceneAttempts.set(scene.sceneNumber, attemptId);
                const attemptPromise = generateSceneImage(scene, attemptId);

                try {
                    return await withTimeout(
                        attemptPromise,
                        IMAGE_SCENE_TIMEOUT_MS,
                        `media-image scene ${scene.sceneNumber} timed out after ${Math.round(
                            IMAGE_SCENE_TIMEOUT_MS / 1000
                        )} seconds`
                    );
                } catch (err) {
                    activeSceneAttempts.set(scene.sceneNumber, `inactive:${attemptId}`);
                    void attemptPromise.catch(() => {
                        /* late attempt already superseded */
                    });
                    lastError = err;

                    if (attempt < IMAGE_SCENE_MAX_ATTEMPTS) {
                        console.warn(
                            `[media-image-block] scene ${scene.sceneNumber} attempt ${attempt}/${IMAGE_SCENE_MAX_ATTEMPTS} failed; retrying: ${
                                err instanceof Error ? err.message : String(err)
                            }`
                        );
                    }
                }
            }

            throw lastError instanceof Error ? lastError : new Error(`media-image scene ${scene.sceneNumber} failed`);
        };

        const settledResults = await runWithConcurrency(
            scenePrompts,
            IMAGE_SCENE_CONCURRENCY,
            generateSceneImageWithRetries
        );
        const generatedResults: Array<{
            image: ImageResult;
            asset: NonNullable<BlockExecutorResult['assets']>[number];
        }> = [];
        const failureMessages: string[] = [];

        settledResults.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                generatedResults.push(result.value);
            } else {
                failureMessages.push(`scene ${scenePrompts[index]?.sceneNumber ?? index + 1}: ${result.reason}`);
            }
        });

        if (failureMessages.length > 0) {
            throw new Error(
                `media-image failed after ${generatedResults.length}/${totalScenes} scenes: ${failureMessages.join('; ')}`
            );
        }

        generatedResults.sort((a, b) => a.image.sceneNumber - b.image.sceneNumber);

        const images = generatedResults.map(result => result.image);
        const assets = generatedResults.map(result => result.asset);

        if (assets.length === 0) {
            throw new Error('media-image generated no usable image assets');
        }

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

function buildShortsFramePrompt(
    title: string,
    caption: string,
    visualPrompt?: string,
    sourceLabel?: string,
    presetImageRules?: string
): string {
    const compactRules = compactPromptText(presetImageRules, 180);
    const scene = compactPromptText(
        visualPrompt || 'Korean university admission and student study scene, clean educational illustration.',
        260
    );

    return [
        'Create one vertical 9:16 Korean YouTube Shorts frame.',
        'Use clean viral Korean Shorts style, high contrast, safe mobile margins.',
        `Top title text: "${compactPromptText(title, 16)}".`,
        `Main caption text: "${compactPromptText(caption, 18)}".`,
        sourceLabel ? `Small bottom source text: "${compactPromptText(sourceLabel, 24)}".` : '',
        'Text must be short, bold, legible, with black stroke/shadow.',
        compactRules,
        `Scene: ${scene}`,
    ]
        .filter(Boolean)
        .join(' ');
}

function compactPromptText(value: string | undefined, maxLength: number): string {
    if (!value) return '';
    const compact = value.replace(/\s+/g, ' ').trim();
    if (compact.length <= maxLength) return compact;
    return `${compact.slice(0, maxLength - 1)}...`;
}

function cleanSourceLabel(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const compact = value.replace(/\s+/g, ' ').trim();
    if (!compact || compact === '출처 확인 필요') return undefined;
    return compact;
}

async function runWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    worker: (item: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
    const results: PromiseSettledResult<R>[] = new Array(items.length);
    let nextIndex = 0;

    const runNext = async (): Promise<void> => {
        while (nextIndex < items.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            try {
                results[currentIndex] = { status: 'fulfilled', value: await worker(items[currentIndex]) };
            } catch (reason) {
                results[currentIndex] = { status: 'rejected', reason };
            }
        }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runNext()));
    return results;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
        if (timeout) clearTimeout(timeout);
    });
}
