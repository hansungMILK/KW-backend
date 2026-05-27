import { randomUUID } from 'crypto';

import { getPublicUrl, putObject } from '../../../adapters/aws/s3';
import { ffmpegAdapter } from '../../../adapters/external/ffmpeg-adapter';
import { env } from '../../../config/env';
import { traceService } from '../../../services/trace-service';
import { selectBgmForShorts } from '../../shorts/bgm/bgm-selector';

import type { CaptionPosition, CaptionStyle } from '../../../adapters/external/ffmpeg-adapter';
import type { BlockExecutor, BlockExecutorContext, BlockExecutorResult } from '../types';

export const countryballVideoBlock: BlockExecutor = {
    blockType: 'countryball-video',

    async execute(
        input: unknown,
        config?: Record<string, unknown>,
        context?: BlockExecutorContext
    ): Promise<BlockExecutorResult> {
        const start = Date.now();
        const root = isRecord(input) ? input : {};
        const images = Array.isArray(root['images']) ? root['images'].filter(isRecord) : [];
        const scenes = Array.isArray(root['normalizedScenes']) ? root['normalizedScenes'].filter(isRecord) : [];
        const audio = isRecord(root['audio']) ? root['audio'] : undefined;
        const audioUrl = typeof audio?.['url'] === 'string' ? audio['url'] : undefined;

        if (images.length === 0) throw new Error('countryball-video requires countryball-image output');
        if (!audioUrl) throw new Error('countryball-video requires countryball-tts audio output');

        if (env.orchestratorMode === 'mock') {
            return {
                output: {
                    video: {
                        url: 'fake://cdn.example.com/videos/countryball-shorts.mp4',
                        durationSec: number(audio?.['durationSec'], 45),
                        width: 1080,
                        height: 1920,
                        format: 'mp4',
                    },
                    images,
                    audio,
                    normalizedScenes: scenes,
                    metadata: root['metadata'],
                },
                durationMs: Date.now() - start,
            };
        }

        await trace(context, 'countryball-video:compose.started', {
            imageCount: images.length,
            hasAudio: Boolean(audioUrl),
        });

        const title = metadataTitle(root['metadata']);
        const composeImages = buildCountryballComposeImages({ images, scenes, audio, title });

        const backgroundMusic =
            config?.['backgroundMusic'] === false
                ? undefined
                : selectBgmForShorts({
                      metadata: isRecord(root['metadata']) ? root['metadata'] : undefined,
                      scenes,
                      requestText: title,
                  });
        const result = await ffmpegAdapter.compose({
            images: composeImages,
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
            outputWidth: 1080,
            outputHeight: 1920,
            outputFormat: 'mp4',
            signal: context?.abortSignal,
            onProgress: async (progress, message) => {
                await context?.onProgress?.(progress, message);
            },
        });

        const s3Key = `media/video/${randomUUID()}/countryball-output.mp4`;
        await putObject(s3Key, result.videoBuffer, 'video/mp4');
        const publicUrl = getPublicUrl(s3Key);

        return {
            output: {
                video: {
                    url: publicUrl,
                    previewUrl: publicUrl,
                    downloadUrl: publicUrl,
                    durationSec: result.durationSec,
                    width: 1080,
                    height: 1920,
                    format: 'mp4',
                    sizeBytes: result.sizeBytes,
                },
                backgroundMusic: backgroundMusic
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
                    : { enabled: false },
                images,
                audio,
                normalizedScenes: scenes,
                metadata: root['metadata'],
            },
            durationMs: Date.now() - start,
            assets: [
                {
                    assetType: 'VIDEO',
                    mimeType: 'video/mp4',
                    data: result.videoBuffer,
                    metadata: {
                        s3Key,
                        durationSec: result.durationSec,
                        width: 1080,
                        height: 1920,
                        sizeBytes: result.sizeBytes,
                    },
                },
            ],
        };
    },
};

function captionForScene(scene: Record<string, unknown> | undefined, image: Record<string, unknown>): string {
    return text(firstOverlay(scene, image)?.['text']);
}

type CountryballComposeInput = {
    images: Record<string, unknown>[];
    scenes: Record<string, unknown>[];
    audio?: Record<string, unknown>;
    title: string;
};

type CountryballComposeImage = {
    url: string;
    durationSec: number;
    title?: string;
    caption?: string;
    sourceLabel?: string;
    captionPosition?: CaptionPosition;
    captionStyle?: CaptionStyle;
};

function buildCountryballComposeImages({
    images,
    scenes,
    audio,
    title,
}: CountryballComposeInput): CountryballComposeImage[] {
    const voiceSegments = Array.isArray(audio?.['voiceSegments']) ? audio['voiceSegments'].filter(isRecord) : [];
    if (voiceSegments.length > 0) {
        const segmentImages = voiceSegments.flatMap((segment, index): CountryballComposeImage[] => {
            const sceneNumber = number(segment['sceneNumber'], index + 1);
            const image = imageForScene(images, sceneNumber, index);
            if (!image) return [];
            const scene = scenes.find(item => number(item['sceneNumber'], sceneNumber) === sceneNumber);
            const overlay = overlayForSegment(scene, image, segment);
            return [
                {
                    url: text(image['url']),
                    durationSec:
                        positiveNumber(segment['durationSec']) ??
                        positiveNumber(scene?.['durationSec']) ??
                        positiveNumber(image['durationSec']) ??
                        1.5,
                    title,
                    caption: text(segment['text'], captionForScene(scene, image)),
                    captionPosition: captionPosition(overlay?.['preferredPosition']),
                    captionStyle: captionStyle(overlay?.['style']),
                    sourceLabel: '',
                },
            ];
        });
        if (segmentImages.length > 0) return segmentImages;
    }

    return images.map((image, index) => {
        const sceneNumber = number(image['sceneNumber'], index + 1);
        const scene = scenes.find(item => number(item['sceneNumber'], sceneNumber) === sceneNumber);
        return {
            url: text(image['url']),
            durationSec: number(scene?.['durationSec'] ?? image['durationSec'], 4),
            title,
            caption: captionForScene(scene, image),
            captionPosition: captionPosition(firstOverlay(scene, image)?.['preferredPosition']),
            captionStyle: captionStyle(firstOverlay(scene, image)?.['style']),
            sourceLabel: '',
        };
    });
}

function overlayForSegment(
    scene: Record<string, unknown> | undefined,
    image: Record<string, unknown>,
    segment: Record<string, unknown>
): Record<string, unknown> | undefined {
    const overlays = captionOverlays(scene, image);
    const speakerCountry = text(segment['speakerCountry'] ?? segment['country']);
    const segmentText = text(segment['text']);
    return (
        overlays.find(item => text(item['speakerCountry']) === speakerCountry && text(item['text']) === segmentText) ??
        overlays.find(item => text(item['speakerCountry']) === speakerCountry) ??
        overlays.find(item => text(item['text']) === segmentText) ??
        overlays.find(item => item['type'] === 'dialogue') ??
        overlays[0]
    );
}

function firstOverlay(
    scene: Record<string, unknown> | undefined,
    image: Record<string, unknown>
): Record<string, unknown> | undefined {
    const overlays = captionOverlays(scene, image);
    return (
        overlays.find(item => item['type'] === 'dialogue') ??
        overlays.find(item => item['type'] === 'reaction') ??
        overlays.find(item => item['type'] === 'action') ??
        overlays[0]
    );
}

function captionOverlays(
    scene: Record<string, unknown> | undefined,
    image: Record<string, unknown>
): Record<string, unknown>[] {
    const sceneOverlays = Array.isArray(scene?.['captionOverlay']) ? scene?.['captionOverlay'].filter(isRecord) : [];
    const imageOverlays = Array.isArray(image['captionOverlay']) ? image['captionOverlay'].filter(isRecord) : [];
    return [...sceneOverlays, ...imageOverlays];
}

function imageForScene(
    images: Record<string, unknown>[],
    sceneNumber: number,
    fallbackIndex: number
): Record<string, unknown> | undefined {
    return (
        images.find(item => number(item['sceneNumber'], -1) === sceneNumber) ??
        images[Math.min(Math.max(fallbackIndex, 0), images.length - 1)]
    );
}

function metadataTitle(metadata: unknown): string {
    if (isRecord(metadata) && typeof metadata['title'] === 'string') return metadata['title'];
    return '컨트리볼 쇼츠';
}

async function trace(
    context: BlockExecutorContext | undefined,
    message: string,
    data?: Record<string, unknown>
): Promise<void> {
    try {
        await traceService.record(context?.runId ?? 'pending', context?.nodeId ?? null, 'STATUS', message, data);
    } catch {
        /* non-fatal */
    }
}

function text(input: unknown, fallback = ''): string {
    return typeof input === 'string' && input.trim() ? input.replace(/\s+/g, ' ').trim() : fallback;
}

function number(input: unknown, fallback: number): number {
    return typeof input === 'number' && Number.isFinite(input) ? input : fallback;
}

function positiveNumber(input: unknown): number | undefined {
    return typeof input === 'number' && Number.isFinite(input) && input > 0 ? input : undefined;
}

function captionPosition(input: unknown): CaptionPosition | undefined {
    if (typeof input !== 'string') return undefined;
    return [
        'upper-left',
        'upper-center',
        'upper-right',
        'middle-left',
        'center',
        'middle-right',
        'lower-left',
        'lower-center',
        'lower-right',
    ].includes(input)
        ? (input as CaptionPosition)
        : undefined;
}

function captionStyle(input: unknown): CaptionStyle | undefined {
    if (typeof input !== 'string') return undefined;
    return ['whiteBlack', 'yellowBlack', 'redBlack', 'smallWhite', 'titleBand'].includes(input)
        ? (input as CaptionStyle)
        : undefined;
}

function isRecord(input: unknown): input is Record<string, unknown> {
    return input != null && typeof input === 'object' && !Array.isArray(input);
}

export const __test__ = {
    buildCountryballComposeImages,
};
