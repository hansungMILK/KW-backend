import { randomUUID } from 'crypto';

import { getPublicUrl, putObject } from '../../adapters/aws/s3';
import { ffmpegAdapter } from '../../adapters/external/ffmpeg-adapter';
import { env } from '../../config/env';
import { traceService } from '../../services/trace-service';
import { selectBgmForShorts } from '../shorts/bgm/bgm-selector';

import type { BlockExecutor, BlockExecutorResult } from './types';

// ─── block ───────────────────────────────────────────────────────────────────

export const mediaVideoBlock: BlockExecutor = {
    blockType: 'media-video',

    async execute(input: unknown, _config?: Record<string, unknown>): Promise<BlockExecutorResult> {
        const start = Date.now();

        // Extract image URLs from media-image output and audio URL from media-tts output.
        // The execution engine merges both upstream parent outputs into this input.
        const inp = input as Record<string, unknown> | null;

        type RawImage = {
            url?: string;
            sceneNumber?: number;
            durationSec?: number;
            caption?: string;
            visualText?: string;
            sourceLabel?: string;
        };
        type RawScene = {
            sceneNumber?: number;
            durationSec?: number;
            caption?: string;
            visualText?: string;
            sourceLabel?: string;
        };
        const rawImages: RawImage[] = (inp?.images as RawImage[] | undefined) ?? [];
        const rawScenes: RawScene[] = (inp?.normalizedScenes as RawScene[] | undefined) ?? [];
        const metadata = inp?.metadata as Record<string, unknown> | undefined;
        const enableBackgroundMusic = _config?.backgroundMusic !== false;

        const images = rawImages
            .filter(img => typeof img.url === 'string')
            .map(img => ({
                url: img.url as string,
                durationSec: durationForImage(img, rawScenes),
                title: typeof metadata?.title === 'string' ? metadata.title : undefined,
                caption: img.visualText || img.caption,
                sourceLabel: img.sourceLabel || sourceLabelForImage(img, rawScenes),
            }));

        const audioObj = inp?.audio as { url?: string } | undefined;
        const audioUrl = typeof audioObj?.url === 'string' ? audioObj.url : undefined;

        if (images.length === 0) {
            throw new Error('media-video requires image outputs from media-image');
        }
        if (!audioUrl) {
            throw new Error('media-video requires audio output from media-tts');
        }

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

            const result = await ffmpegAdapter.compose({
                images,
                audioUrl,
                backgroundMusic: backgroundMusic
                    ? {
                          path: backgroundMusic.track.filePath,
                          volume: backgroundMusic.volume,
                          title: backgroundMusic.track.title,
                          license: backgroundMusic.track.license,
                          attribution: backgroundMusic.track.attribution,
                      }
                    : false,
                outputWidth: 1080,
                outputHeight: 1920,
                outputFormat: 'mp4',
            });

            const backgroundMusicMetadata = backgroundMusic
                ? {
                      id: backgroundMusic.track.id,
                      title: backgroundMusic.track.title,
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
                        width: 1080,
                        height: 1920,
                        backgroundMusic: backgroundMusicMetadata,
                    },
                },
            ];

            try {
                await traceService.record('pending', null, 'STATUS', 'media-video: video composed', {
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
                        durationSec: result.durationSec,
                        width: 1080,
                        height: 1920,
                        format: 'mp4',
                        sizeBytes: result.sizeBytes,
                    },
                    backgroundMusic: backgroundMusicMetadata,
                    images: rawImages,
                    ...(audioObj ? { audio: audioObj } : {}),
                    normalizedScenes: rawScenes,
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
    image: { sceneNumber?: number },
    scenes: Array<{ sceneNumber?: number; sourceLabel?: string }>
): string | undefined {
    const matchingScene = scenes.find(scene => scene.sceneNumber === image.sceneNumber);
    return matchingScene?.sourceLabel;
}
