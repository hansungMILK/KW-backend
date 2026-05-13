import { randomUUID } from 'crypto';

import { getPublicUrl, putObject } from '../../adapters/aws/s3';
import { ffmpegAdapter } from '../../adapters/external/ffmpeg-adapter';
import { env } from '../../config/env';
import { traceService } from '../../services/trace-service';
import { selectBgmForShorts } from '../shorts/bgm/bgm-selector';
import { sourceRefsToLabel } from '../shorts/rulepacks/base-shorts-rulepack';

import type { BlockExecutor, BlockExecutorContext, BlockExecutorResult } from './types';
import type { VideoProbeResult } from '../../adapters/external/ffmpeg-adapter';

// ─── block ───────────────────────────────────────────────────────────────────

export const mediaVideoBlock: BlockExecutor = {
    blockType: 'media-video',

    async execute(
        input: unknown,
        config?: Record<string, unknown>,
        context?: BlockExecutorContext
    ): Promise<BlockExecutorResult> {
        const start = Date.now();

        // Extract image URLs from media-image output and audio URL from media-tts output.
        // The execution engine merges both upstream parent outputs into this input.
        const inp = input as Record<string, unknown> | null;

        type RawImage = {
            url?: string;
            sceneNumber?: number;
            durationSec?: number;
            title?: string;
            caption?: string;
            visualText?: string;
            sourceLabel?: string;
        };
        type RawScene = {
            sceneId?: string;
            sceneNumber?: number;
            durationSec?: number;
            title?: string;
            headline?: string;
            caption?: string;
            narration?: string;
            visualText?: string;
            sourceLabel?: string;
            layout?: string;
            sourceRefs?: unknown[];
            visual?: {
                sourceLabel?: string;
            };
        };
        type RawSubtitleCue = {
            sceneNumber?: number;
            text?: string;
            startSec?: number;
            endSec?: number;
        };
        type RawMotionCue = {
            sceneNumber?: number;
            type?: string;
        };
        const rawImagesFromInput: RawImage[] = (inp?.images as RawImage[] | undefined) ?? [];
        const rawScenes: RawScene[] = (inp?.normalizedScenes as RawScene[] | undefined) ?? [];
        const motionScenes: RawScene[] = (inp?.scenes as RawScene[] | undefined) ?? rawScenes;
        const subtitleCues: RawSubtitleCue[] = Array.isArray(inp?.subtitleCues)
            ? (inp.subtitleCues as RawSubtitleCue[])
            : [];
        const motionCues: RawMotionCue[] = Array.isArray(inp?.motionCues) ? (inp.motionCues as RawMotionCue[]) : [];
        const metadata = inp?.metadata as Record<string, unknown> | undefined;
        const longformGateB = isLongformGateB(input, config);
        const enableBackgroundMusic = longformGateB || config?.backgroundMusic !== false;

        if (longformGateB) {
            assertApprovedLongformGateB(input, config);
            assertLongformRenderCostWithinLimit(input, config);
        }

        const audioObj = inp?.audio as
            | { url?: string; durationSec?: number; provider?: string; model?: string; voiceId?: string }
            | undefined;
        const audioUrl = typeof audioObj?.url === 'string' ? audioObj.url : undefined;
        const audioDurationSec =
            typeof audioObj?.durationSec === 'number' &&
            Number.isFinite(audioObj.durationSec) &&
            audioObj.durationSec > 0
                ? audioObj.durationSec
                : undefined;
        const longformProductionQa = longformGateB
            ? assertLongformProductionInputs(audioObj, subtitleCues, motionCues)
            : undefined;
        const rawImages = longformGateB
            ? await ensureLongformMotionBoardImages(rawImagesFromInput, motionScenes, subtitleCues, metadata)
            : rawImagesFromInput;
        const images = buildSyncedImageSegments(rawImages, rawScenes, subtitleCues, metadata, audioDurationSec);

        if (images.length === 0) {
            throw new Error('media-video requires image outputs from media-image');
        }
        if (!audioUrl) {
            throw new Error('media-video requires audio output from media-tts');
        }

        await ensureVideoNotCancelled(context?.abortSignal);

        try {
            const backgroundMusic = enableBackgroundMusic
                ? selectBgmForShorts({
                      metadata,
                      scenes: rawScenes as Array<Record<string, unknown>>,
                      requestText: typeof metadata?.requestText === 'string' ? metadata.requestText : undefined,
                  })
                : undefined;

            if (enableBackgroundMusic && env.shortsBgmRequired && !backgroundMusic) {
                throw new Error(
                    `media-video requires licensed BGM, but no configured track was found in ${env.shortsBgmAssetsDir}`
                );
            }

            await recordVideoTrace('media-video: composing started', {
                imageCount: images.length,
                hasAudio: Boolean(audioUrl),
                backgroundMusic: backgroundMusic
                    ? {
                          id: backgroundMusic.track.id,
                          title: backgroundMusic.track.title,
                          mood: backgroundMusic.track.mood,
                      }
                    : null,
            });
            await context?.onProgress?.(35, '영상 합성 입력 준비 완료');

            const timeoutMs = readPositiveIntEnv(
                'MEDIA_VIDEO_TIMEOUT_MS',
                readPositiveIntEnv('FFMPEG_TIMEOUT_MS', 840000)
            );
            const compositionSignal = createTimeoutSignal(timeoutMs, context?.abortSignal);
            const outputSize = resolveVideoOutputSize(longformGateB, input, config);
            const result = await (async () => {
                try {
                    return await ffmpegAdapter.compose({
                        images,
                        audioUrl,
                        backgroundMusic: backgroundMusic
                            ? {
                                  path: backgroundMusic.track.filePath,
                                  volume: backgroundMusic.volume,
                                  title: backgroundMusic.track.title,
                                  artist: backgroundMusic.track.artist,
                                  license: backgroundMusic.track.license,
                                  attribution: backgroundMusic.track.attribution,
                              }
                            : false,
                        outputWidth: outputSize.width,
                        outputHeight: outputSize.height,
                        outputFormat: 'mp4',
                        motionMode: longformGateB ? 'ken-burns' : undefined,
                        signal: compositionSignal.signal,
                        onProgress: async (progress, message) => {
                            await context?.onProgress?.(progress, message);
                        },
                    });
                } finally {
                    compositionSignal.cleanup();
                }
            })();

            const qa = longformGateB ? await ffmpegAdapter.probeVideo(result.videoBuffer) : undefined;
            if (longformGateB) {
                assertLongformVideoQa(qa, outputSize.width, outputSize.height, result.durationSec);
                await context?.onProgress?.(92, '롱폼 MP4 QA 통과');
            }

            const backgroundMusicMetadata = backgroundMusic
                ? {
                      id: backgroundMusic.track.id,
                      title: backgroundMusic.track.title,
                      artist: backgroundMusic.track.artist,
                      mood: backgroundMusic.track.mood,
                      volume: backgroundMusic.volume,
                      source: backgroundMusic.track.source,
                      license: backgroundMusic.track.license,
                      attribution: backgroundMusic.track.attribution,
                      reason: backgroundMusic.reason,
                  }
                : {
                      enabled: false,
                      reason: enableBackgroundMusic
                          ? `no licensed BGM track found in ${env.shortsBgmAssetsDir}`
                          : 'disabled by node config',
                  };

            const s3Key = `media/video/${randomUUID()}/output.mp4`;
            await ensureVideoNotCancelled(context?.abortSignal);
            await putObject(s3Key, result.videoBuffer, 'video/mp4');
            const publicUrl = getPublicUrl(s3Key);

            const assets: BlockExecutorResult['assets'] = [
                {
                    assetType: 'VIDEO',
                    mimeType: 'video/mp4',
                    data: result.videoBuffer,
                    metadata: {
                        s3Key,
                        durationSec: result.durationSec,
                        sizeBytes: result.sizeBytes,
                        width: outputSize.width,
                        height: outputSize.height,
                        backgroundMusic: backgroundMusicMetadata,
                        ...(longformGateB
                            ? {
                                  rendererRoute: resolveRendererRoute(input, config),
                                  qa,
                                  longformProductionQa,
                                  previewUrl: publicUrl,
                                  downloadUrl: publicUrl,
                              }
                            : {}),
                    },
                },
            ];

            try {
                await recordVideoTrace('media-video: video composed', {
                    s3Key,
                    durationSec: result.durationSec,
                    sizeBytes: result.sizeBytes,
                    backgroundMusic: backgroundMusicMetadata,
                });
            } catch {
                /* non-fatal */
            }

            return {
                output: {
                    video: {
                        url: publicUrl,
                        previewUrl: publicUrl,
                        downloadUrl: publicUrl,
                        durationSec: result.durationSec,
                        width: outputSize.width,
                        height: outputSize.height,
                        format: 'mp4',
                        sizeBytes: result.sizeBytes,
                    },
                    backgroundMusic: backgroundMusicMetadata,
                    images: rawImages,
                    ...(audioObj ? { audio: audioObj } : {}),
                    normalizedScenes: rawScenes,
                    ...(longformGateB
                        ? {
                              rendererRoute: resolveRendererRoute(input, config),
                              qa,
                              longformProductionQa,
                          }
                        : {}),
                    ...(metadata ? { metadata } : {}),
                },
                durationMs: Date.now() - start,
                assets,
            };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[media-video-block] video composition failed: ${msg}`);
            try {
                await traceService.record('pending', null, 'ERROR', `media-video: failed: ${msg}`);
            } catch {
                /* non-fatal */
            }
            throw err;
        }
    },
};

function readPositiveIntEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function createTimeoutSignal(
    timeoutMs: number,
    parentSignal?: AbortSignal
): { signal: AbortSignal; cleanup: () => void } {
    const controller = new AbortController();
    const abort = (reason?: unknown) => {
        if (!controller.signal.aborted) {
            controller.abort(reason instanceof Error ? reason : new Error(String(reason || 'media-video cancelled')));
        }
    };
    const onParentAbort = () => abort(parentSignal?.reason ?? new Error('media-video cancelled'));

    if (parentSignal?.aborted) {
        onParentAbort();
        return { signal: controller.signal, cleanup: () => undefined };
    }

    parentSignal?.addEventListener('abort', onParentAbort, { once: true });
    const timer = setTimeout(
        () => abort(new Error(`media-video timed out after ${Math.round(timeoutMs / 1000)} seconds`)),
        timeoutMs
    );

    return {
        signal: controller.signal,
        cleanup: () => {
            clearTimeout(timer);
            parentSignal?.removeEventListener('abort', onParentAbort);
        },
    };
}

async function ensureVideoNotCancelled(signal?: AbortSignal): Promise<void> {
    if (!signal?.aborted) return;
    const reason = signal.reason;
    throw reason instanceof Error ? reason : new Error('media-video cancelled');
}

async function recordVideoTrace(message: string, data?: Record<string, unknown>): Promise<void> {
    try {
        await traceService.record('pending', null, 'STATUS', message, data);
    } catch {
        /* non-fatal */
    }
}

async function ensureLongformMotionBoardImages(
    images: Array<{
        url?: string;
        sceneNumber?: number;
        durationSec?: number;
        title?: string;
        caption?: string;
        visualText?: string;
        sourceLabel?: string;
    }>,
    scenes: Array<{
        sceneId?: string;
        sceneNumber?: number;
        durationSec?: number;
        title?: string;
        headline?: string;
        caption?: string;
        narration?: string;
        visualText?: string;
        sourceLabel?: string;
        layout?: string;
    }>,
    subtitleCues: Array<{ sceneNumber?: number; text?: string; startSec?: number; endSec?: number }>,
    metadata?: Record<string, unknown>
): Promise<
    Array<{
        url?: string;
        sceneNumber?: number;
        durationSec?: number;
        title?: string;
        caption?: string;
        visualText?: string;
        sourceLabel?: string;
    }>
> {
    if (images.some(image => typeof image.url === 'string' && image.url.trim().length > 0)) return images;

    const sceneKeys = new Set<number>();
    for (const cue of subtitleCues) sceneKeys.add(normalizeSceneNumber(cue.sceneNumber, sceneKeys.size + 1));
    for (const scene of scenes) sceneKeys.add(normalizeSceneNumber(scene.sceneNumber, sceneKeys.size + 1));
    if (sceneKeys.size === 0) sceneKeys.add(1);

    const generated: Array<{
        url: string;
        sceneNumber: number;
        durationSec?: number;
        title: string;
        caption: string;
        sourceLabel?: string;
    }> = [];
    for (const sceneNumber of [...sceneKeys].sort((a, b) => a - b)) {
        const scene = scenes.find(item => normalizeSceneNumber(item.sceneNumber, sceneNumber) === sceneNumber);
        const cue = subtitleCues.find(item => normalizeSceneNumber(item.sceneNumber, sceneNumber) === sceneNumber);
        const title =
            normalizeSubtitleText(scene?.headline) ||
            normalizeSubtitleText(scene?.title) ||
            normalizeSubtitleText(scene?.layout) ||
            (typeof metadata?.title === 'string' ? metadata.title : `롱폼 장면 ${sceneNumber}`);
        const caption =
            normalizeSubtitleText(cue?.text) ||
            normalizeSubtitleText(scene?.narration) ||
            normalizeSubtitleText(scene?.caption) ||
            normalizeSubtitleText(scene?.visualText) ||
            title;
        const key = `media/longform-visuals/${randomUUID()}/scene-${sceneNumber}.ppm`;
        await putObject(key, createLongformMotionBoardPpm(sceneNumber), 'image/x-portable-pixmap');
        generated.push({
            url: getPublicUrl(key),
            sceneNumber,
            title,
            caption,
            sourceLabel: cleanSourceLabel(scene?.sourceLabel),
            durationSec:
                typeof scene?.durationSec === 'number' && Number.isFinite(scene.durationSec) && scene.durationSec > 0
                    ? scene.durationSec
                    : undefined,
        });
    }

    return generated;
}

function createLongformMotionBoardPpm(seed: number): Buffer {
    const width = 960;
    const height = 540;
    const header = Buffer.from(`P6\n${width} ${height}\n255\n`, 'ascii');
    const pixels = Buffer.alloc(width * height * 3);
    const hue = (seed * 37) % 255;

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const offset = (y * width + x) * 3;
            const vignette = 1 - Math.min(0.55, Math.hypot(x - width / 2, y - height / 2) / Math.hypot(width, height));
            pixels[offset] = Math.round((12 + ((x / width) * 50 + hue * 0.18)) * vignette);
            pixels[offset + 1] = Math.round((24 + ((y / height) * 70 + hue * 0.12)) * vignette);
            pixels[offset + 2] = Math.round((42 + ((1 - x / width) * 95 + hue * 0.2)) * vignette);
        }
    }

    return Buffer.concat([header, pixels]);
}

function buildSyncedImageSegments(
    images: Array<{
        url?: string;
        sceneNumber?: number;
        durationSec?: number;
        title?: string;
        caption?: string;
        visualText?: string;
        sourceLabel?: string;
    }>,
    scenes: Array<{
        sceneNumber?: number;
        durationSec?: number;
        caption?: string;
        narration?: string;
        visualText?: string;
        sourceLabel?: string;
    }>,
    subtitleCues: Array<{ sceneNumber?: number; text?: string; startSec?: number; endSec?: number }>,
    metadata?: Record<string, unknown>,
    audioDurationSec?: number
): Array<{ url: string; durationSec: number; title?: string; caption?: string; sourceLabel?: string }> {
    const title = typeof metadata?.title === 'string' ? metadata.title : undefined;
    const usableImages = images.filter(
        (image): image is typeof image & { url: string } => typeof image.url === 'string'
    );
    const imagesBySceneNumber = new Map<number, (typeof usableImages)[number]>();
    usableImages.forEach((image, index) => {
        imagesBySceneNumber.set(normalizeSceneNumber(image.sceneNumber, index + 1), image);
    });

    const timedCues = subtitleCues
        .map(cue => {
            const startSec =
                typeof cue.startSec === 'number' && Number.isFinite(cue.startSec) ? cue.startSec : undefined;
            const endSec = typeof cue.endSec === 'number' && Number.isFinite(cue.endSec) ? cue.endSec : undefined;
            const text = normalizeSubtitleText(cue.text);
            if (startSec === undefined || endSec === undefined || endSec <= startSec || !text) return undefined;
            return {
                sceneNumber: normalizeSceneNumber(cue.sceneNumber, 1),
                text,
                startSec,
                endSec,
            };
        })
        .filter((cue): cue is { sceneNumber: number; text: string; startSec: number; endSec: number } => Boolean(cue));

    const syncedCues = scaleSubtitleCuesToAudioDuration(timedCues, audioDurationSec);

    if (syncedCues.length > 0 && usableImages.length > 0) {
        return syncedCues.map((cue, index) => {
            const image =
                imagesBySceneNumber.get(cue.sceneNumber) ?? usableImages[Math.min(index, usableImages.length - 1)];
            return {
                url: image.url,
                durationSec: roundToMillis(cue.endSec - cue.startSec),
                title: image.title ?? title,
                caption: cue.text,
                sourceLabel: sourceLabelForImage(image, scenes, metadata?.['sources']),
            };
        });
    }

    return usableImages.map(image => ({
        url: image.url,
        durationSec: durationForImage(image, scenes),
        title: image.title ?? title,
        caption: subtitleForImage(image, scenes),
        sourceLabel: sourceLabelForImage(image, scenes, metadata?.['sources']),
    }));
}

function scaleSubtitleCuesToAudioDuration(
    cues: Array<{ sceneNumber: number; text: string; startSec: number; endSec: number }>,
    audioDurationSec: number | undefined
): Array<{ sceneNumber: number; text: string; startSec: number; endSec: number }> {
    if (!audioDurationSec || cues.length === 0) return cues;

    const cueDurationSec = Math.max(...cues.map(cue => cue.endSec));
    if (!Number.isFinite(cueDurationSec) || cueDurationSec <= 0) return cues;
    if (Math.abs(cueDurationSec - audioDurationSec) <= 0.5) return cues;

    const scale = audioDurationSec / cueDurationSec;
    return cues.map((cue, index) => {
        const isLast = index === cues.length - 1;
        return {
            ...cue,
            startSec: roundToMillis(cue.startSec * scale),
            endSec: isLast ? roundToMillis(audioDurationSec) : roundToMillis(cue.endSec * scale),
        };
    });
}

function durationForImage(
    image: { sceneNumber?: number; durationSec?: number },
    scenes: Array<{ sceneNumber?: number; durationSec?: number }>
): number {
    if (typeof image.durationSec === 'number' && image.durationSec > 0) return image.durationSec;
    const matchingScene = scenes.find(scene => scene.sceneNumber === image.sceneNumber);
    if (typeof matchingScene?.durationSec === 'number' && matchingScene.durationSec > 0) {
        return matchingScene.durationSec;
    }
    return 5;
}

function sourceLabelForImage(
    image: { sceneNumber?: number; sourceLabel?: string },
    scenes: Array<{
        sceneNumber?: number;
        sourceLabel?: string;
        sourceRefs?: unknown[];
        visual?: { sourceLabel?: string };
    }>,
    sources?: unknown
): string | undefined {
    const matchingScene = scenes.find(scene => scene.sceneNumber === image.sceneNumber);
    return (
        cleanSourceLabel(image.sourceLabel) ||
        cleanSourceLabel(matchingScene?.sourceLabel) ||
        cleanSourceLabel(matchingScene?.visual?.sourceLabel) ||
        sourceRefsToLabel(matchingScene?.sourceRefs, sources) ||
        undefined
    );
}

function cleanSourceLabel(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const compact = value.replace(/\s+/g, ' ').trim();
    if (!compact || compact === '출처 확인 필요') return undefined;
    if (/^source-\d+$/i.test(compact)) return undefined;
    if (/https?:\/\//i.test(compact)) return undefined;
    return compact.slice(0, 36);
}

function subtitleForImage(
    image: { sceneNumber?: number; caption?: string; visualText?: string },
    scenes: Array<{ sceneNumber?: number; narration?: string; caption?: string; visualText?: string }>
): string | undefined {
    const matchingScene = scenes.find(scene => scene.sceneNumber === image.sceneNumber);
    return matchingScene?.narration || matchingScene?.caption || image.caption || image.visualText;
}

function normalizeSubtitleText(value: unknown): string {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function normalizeSceneNumber(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function roundToMillis(value: number): number {
    return Math.round(value * 1000) / 1000;
}

function isLongformGateB(input: unknown, config?: Record<string, unknown>): boolean {
    const values: unknown[] = [config?.['mode'], config?.['gate']];
    if (isRecord(input)) {
        values.push(input['mode'], input['gate']);
    }
    return values
        .filter((value): value is string => typeof value === 'string')
        .some(value => ['longform-gate-b', 'longform.b', 'gate-b.longform'].includes(value.toLowerCase()));
}

function assertApprovedLongformGateB(input: unknown, config?: Record<string, unknown>): void {
    const approved =
        readBoolean(config?.['gateBApproved']) || readBoolean(isRecord(input) ? input['gateBApproved'] : undefined);
    const artifact = approvedGateAArtifact(input, config);

    if (!approved || !isApprovedGateAArtifact(artifact)) {
        throw new Error('longform media execution requires an approved planning artifact before media execution');
    }
}

function approvedGateAArtifact(input: unknown, config?: Record<string, unknown>): Record<string, unknown> | undefined {
    const configArtifact = isRecord(config?.['approvedGateAArtifact']) ? config?.['approvedGateAArtifact'] : undefined;
    const inputArtifact =
        isRecord(input) && isRecord(input['approvedGateAArtifact']) ? input['approvedGateAArtifact'] : undefined;
    const directArtifact =
        isRecord(input) &&
        (input['mode'] === 'longform-gate-a' || input['gate'] === 'A') &&
        typeof input['fullScriptDraft'] === 'string' &&
        Array.isArray(input['scenePlan'])
            ? input
            : undefined;

    return configArtifact ?? inputArtifact ?? directArtifact;
}

function assertLongformRenderCostWithinLimit(input: unknown, config?: Record<string, unknown>): void {
    const maxCostUsd = env.maxLongformHtmlRenderEstimatedCostUsd;
    if (maxCostUsd <= 0) return;

    const estimatedCostUsd = estimateLongformRenderCostUsd(input, config);
    if (estimatedCostUsd === undefined) {
        throw new Error('longform media execution requires render cost estimate before media execution');
    }
    if (estimatedCostUsd <= maxCostUsd) return;

    throw new Error(
        `LONGFORM_HTML_RENDER_COST_LIMIT_EXCEEDED: estimatedCostUsd=${estimatedCostUsd}, maxCostUsd=${maxCostUsd}`
    );
}

function assertLongformProductionInputs(
    audio: { provider?: string; model?: string; voiceId?: string } | undefined,
    subtitleCues: Array<{ text?: string; startSec?: number; endSec?: number }>,
    motionCues: Array<{ type?: string }>
): { ttsProvider: string; voiceId: string; subtitleCueCount: number; motionCueCount: number } {
    const provider = typeof audio?.provider === 'string' ? audio.provider.trim().toLowerCase() : '';
    const voiceId = typeof audio?.voiceId === 'string' ? audio.voiceId.trim() : '';
    if (provider !== 'elevenlabs' || !voiceId) {
        throw new Error('longform media execution requires ElevenLabs TTS audio before MP4 render');
    }

    const timedSubtitleCues = subtitleCues.filter(cue => {
        const text = normalizeSubtitleText(cue.text);
        return (
            text.length > 0 &&
            typeof cue.startSec === 'number' &&
            Number.isFinite(cue.startSec) &&
            typeof cue.endSec === 'number' &&
            Number.isFinite(cue.endSec) &&
            cue.endSec > cue.startSec
        );
    });
    if (timedSubtitleCues.length === 0) {
        throw new Error('longform media execution requires timed subtitle cues before MP4 render');
    }

    const usableMotionCues = motionCues.filter(cue => typeof cue.type === 'string' && cue.type.trim().length > 0);
    if (usableMotionCues.length === 0) {
        throw new Error('longform media execution requires motion graphics cues before MP4 render');
    }

    return {
        ttsProvider: 'elevenlabs',
        voiceId,
        subtitleCueCount: timedSubtitleCues.length,
        motionCueCount: usableMotionCues.length,
    };
}

function estimateLongformRenderCostUsd(input: unknown, config?: Record<string, unknown>): number | undefined {
    const combined =
        readFirstPositiveNumber(config, input, [
            'longformHtmlRenderEstimatedCostUsd',
            'htmlRenderEstimatedCostUsd',
            'renderGenerationEstimatedCostUsd',
        ]) ?? 0;
    const compose =
        readFirstPositiveNumber(config, input, [
            'htmlComposeEstimatedCostUsd',
            'composeEstimatedCostUsd',
            'hyperframesComposeEstimatedCostUsd',
        ]) ?? 0;
    const render =
        readFirstPositiveNumber(config, input, [
            'hyperframesRenderEstimatedCostUsd',
            'renderEstimatedCostUsd',
            'mp4RenderEstimatedCostUsd',
        ]) ?? 0;

    if (combined <= 0 && compose <= 0 && render <= 0) return undefined;
    return Math.round(Math.max(combined, compose + render) * 100) / 100;
}

function resolveVideoOutputSize(
    longformGateB: boolean,
    input: unknown,
    config?: Record<string, unknown>
): { width: number; height: number } {
    if (!longformGateB) return { width: 1080, height: 1920 };

    const aspectRatio = String(
        config?.['aspectRatio'] ??
            (isRecord(input) ? input['aspectRatio'] : undefined) ??
            (isRecord(input) && isRecord(input['metadata']) ? input['metadata']['aspectRatio'] : undefined) ??
            ''
    ).toLowerCase();

    if (aspectRatio.includes('vertical') || aspectRatio.includes('9:16')) {
        return { width: 1080, height: 1920 };
    }

    return { width: 2560, height: 1440 };
}

function assertLongformVideoQa(
    qa: VideoProbeResult | undefined,
    expectedWidth: number,
    expectedHeight: number,
    expectedDurationSec: number
): void {
    if (!qa?.hasVideo || !qa.hasAudio) {
        throw new Error('Longform ffprobe QA failed: MP4 must contain both audio and video streams');
    }
    if (qa.width !== expectedWidth || qa.height !== expectedHeight) {
        throw new Error(
            `Longform ffprobe QA failed: expected ${expectedWidth}x${expectedHeight}, got ${qa.width ?? 'unknown'}x${
                qa.height ?? 'unknown'
            }`
        );
    }
    if (!qa.durationSec || Math.abs(qa.durationSec - expectedDurationSec) > Math.max(1, expectedDurationSec * 0.05)) {
        throw new Error(
            `Longform ffprobe QA failed: expected duration ${roundToMillis(expectedDurationSec)}s, got ${
                qa.durationSec ?? 'unknown'
            }s`
        );
    }
}

function resolveRendererRoute(input: unknown, config?: Record<string, unknown>): string {
    const route =
        config?.['rendererRoute'] ??
        config?.['renderer'] ??
        (isRecord(input) ? (input['rendererRoute'] ?? input['renderer']) : undefined) ??
        'hyperframes';
    return typeof route === 'string' && route.trim() ? route.trim() : 'hyperframes';
}

function readFirstPositiveNumber(
    config: Record<string, unknown> | undefined,
    input: unknown,
    keys: string[]
): number | undefined {
    for (const source of [config, isRecord(input) ? input : undefined]) {
        if (!source) continue;
        for (const key of keys) {
            const value = readPositiveNumber(source[key]);
            if (value !== undefined) return value;
        }
    }
    return undefined;
}

function readPositiveNumber(input: unknown): number | undefined {
    const value = Number(input);
    return Number.isFinite(value) && value > 0 ? value : undefined;
}

function readBoolean(input: unknown): boolean {
    if (typeof input === 'boolean') return input;
    if (typeof input !== 'string') return false;
    return ['1', 'true', 'yes', 'on', 'approved'].includes(input.trim().toLowerCase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isApprovedGateAArtifact(value: Record<string, unknown> | undefined): value is Record<string, unknown> {
    if (!value) return false;
    const mode = typeof value['mode'] === 'string' ? value['mode'].toLowerCase() : '';
    const gate = typeof value['gate'] === 'string' ? value['gate'].toUpperCase() : '';
    const fullScriptDraft = typeof value['fullScriptDraft'] === 'string' ? value['fullScriptDraft'].trim() : '';
    const scenePlan = Array.isArray(value['scenePlan']) ? value['scenePlan'] : [];
    const reviewStatus = typeof value['reviewStatus'] === 'string' ? value['reviewStatus'].toLowerCase() : '';
    const explicitlyApproved = readBoolean(value['approved']) || reviewStatus === 'approved';

    if (reviewStatus && reviewStatus !== 'approved') return false;
    return (
        (mode === 'longform-gate-a' || gate === 'A') &&
        fullScriptDraft.length > 0 &&
        scenePlan.length > 0 &&
        explicitlyApproved
    );
}
