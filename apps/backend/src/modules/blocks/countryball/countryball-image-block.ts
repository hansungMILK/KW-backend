import { randomUUID } from 'crypto';

import { imageAdapter } from '../../../adapters/ai/image-adapter';
import { getPublicUrl, putObject } from '../../../adapters/aws/s3';
import { env } from '../../../config/env';
import { traceService } from '../../../services/trace-service';
import { normalizeImageQuality } from '../../image-generation/image-style';
import { runWithConcurrency } from '../concurrency';
import { CountryballImageOutputSchema } from '../types';

import type { BlockExecutor, BlockExecutorContext, BlockExecutorResult } from '../types';

export const countryballImageBlock: BlockExecutor = {
    blockType: 'countryball-image',

    async execute(
        input: unknown,
        config?: Record<string, unknown>,
        context?: BlockExecutorContext
    ): Promise<BlockExecutorResult> {
        const start = Date.now();
        const root = isRecord(input) ? input : {};
        const scenes = Array.isArray(root['normalizedScenes']) ? root['normalizedScenes'].filter(isRecord) : [];
        if (scenes.length === 0) throw new Error('countryball-image requires normalizedScenes');

        if (env.orchestratorMode === 'mock') {
            const images = scenes.map((scene, index) => ({
                sceneNumber: number(scene['sceneNumber'], index + 1),
                sceneId: text(scene['sceneId'], `scene-${index + 1}`),
                url: `fake://cdn.example.com/countryball/scene-${String(index + 1).padStart(3, '0')}.png`,
                width: 1080,
                height: 1920,
                prompt: buildCountryballImagePrompt(scene),
                captionOverlay: Array.isArray(scene['captionOverlay']) ? scene['captionOverlay'] : [],
            }));
            return {
                output: { images, normalizedScenes: scenes, metadata: root['metadata'] },
                durationMs: Date.now() - start,
                assets: images.map(image => ({
                    assetType: 'IMAGE',
                    mimeType: 'image/png',
                    data: image.url,
                    metadata: image,
                })),
            };
        }

        const imageQuality = normalizeImageQuality(config?.['imageQuality'] ?? env.openaiImageQuality);
        const batchPrefix = `media/countryball-images/${randomUUID()}`;
        const concurrency = Math.max(1, Number(env.openaiImageSceneConcurrency || 1));
        let completed = 0;

        await trace(context, 'countryball-image:batch.started', {
            sceneCount: scenes.length,
            concurrency,
            imageQuality,
        });

        const sceneItems = scenes.map((scene, index) => ({ scene, index }));
        const results = await runWithConcurrency(sceneItems, concurrency, async ({ scene, index }) => {
            await throwIfCancelled(context);
            const sceneNumber = number(scene['sceneNumber'], index + 1);
            const prompt = buildCountryballImagePrompt(scene);
            const generated = await imageAdapter.generate({
                prompt,
                width: 1080,
                height: 1920,
                style: 'countryball-comic',
                quality: imageQuality,
                signal: context?.abortSignal,
            });
            let imageBuffer = generated.imageBuffer;
            if (!imageBuffer && generated.imageUrl) {
                const response = await fetch(generated.imageUrl, { signal: context?.abortSignal });
                if (!response.ok) throw new Error(`Failed to fetch generated countryball image: ${response.status}`);
                imageBuffer = Buffer.from(await response.arrayBuffer());
            }
            if (!imageBuffer) throw new Error('Countryball image provider returned no downloadable image');

            const s3Key = `${batchPrefix}/scene-${String(sceneNumber).padStart(3, '0')}.png`;
            await putObject(s3Key, imageBuffer, generated.contentType);
            completed += 1;
            await context?.onProgress?.(
                25 + (completed / scenes.length) * 60,
                `컨트리볼 이미지 ${completed}/${scenes.length} 생성 완료`
            );

            return {
                image: {
                    sceneNumber,
                    sceneId: text(scene['sceneId'], `scene-${sceneNumber}`),
                    url: getPublicUrl(s3Key),
                    width: generated.width,
                    height: generated.height,
                    prompt,
                    captionOverlay: Array.isArray(scene['captionOverlay']) ? scene['captionOverlay'] : [],
                },
                asset: {
                    assetType: 'IMAGE' as const,
                    mimeType: generated.contentType,
                    data: imageBuffer,
                    metadata: { sceneNumber, s3Key, prompt },
                },
            };
        });

        const generated: Array<{
            image: CountryballImage;
            asset: NonNullable<BlockExecutorResult['assets']>[number];
        }> = [];
        const failures: PromiseRejectedResult[] = [];
        for (const result of results) {
            if (result.status === 'fulfilled') generated.push(result.value);
            else failures.push(result);
        }
        if (failures.length > 0) {
            throw new Error(`countryball-image failed for ${failures.length}/${scenes.length} scenes`);
        }

        const output = {
            images: generated.map(result => result.image),
            normalizedScenes: scenes,
            metadata: root['metadata'],
        };
        const validated = CountryballImageOutputSchema.safeParse(output);
        if (!validated.success) {
            throw new Error(`[countryball-image] Output schema validation failed: ${validated.error.message}`);
        }
        await trace(context, 'countryball-image:batch.completed', { sceneCount: generated.length });

        return {
            output: validated.data as Record<string, unknown>,
            durationMs: Date.now() - start,
            assets: generated.map(result => result.asset),
        };
    },
};

type CountryballImage = {
    sceneNumber: number;
    sceneId: string;
    url: string;
    width: number;
    height: number;
    prompt: string;
    captionOverlay: unknown[];
};

function buildCountryballImagePrompt(scene: Record<string, unknown>): string {
    const cast = Array.isArray(scene['dialogueLines'])
        ? scene['dialogueLines']
              .filter(isRecord)
              .map(line => text(line['country']))
              .filter(Boolean)
              .join(', ')
        : '';
    const props = Array.isArray(scene['props']) ? scene['props'].map(String).join(', ') : '';
    const expressions = Array.isArray(scene['expressionChanges'])
        ? scene['expressionChanges'].map(String).join(', ')
        : '';
    return [
        'Vertical 9:16 Countryball comic scene for a YouTube Shorts video.',
        `Scene purpose: ${text(scene['scenePurpose'])}.`,
        `Location: ${text(scene['location'], 'countryball skit setting')}.`,
        `Visual tone: ${text(scene['visualTone'], 'comic')}.`,
        `Visible action: ${text(scene['screenAction'], 'countryballs interact through action and reaction')}.`,
        cast ? `Countryball cast: ${cast}.` : undefined,
        expressions ? `Expressions and reactions: ${expressions}.` : undefined,
        props ? `Props and context objects: ${props}.` : undefined,
        'Show the story through countryball action, facial expressions, body position, props, and location.',
        'Keep all generated visuals free of drawn caption containers or reserved text areas because video captions are overlaid later.',
        'No embedded Korean text. Captions will be added later in video editing.',
        'Do not put Korean dialogue, subtitles, paragraphs, information panels, watermarks, logos, or YouTube UI inside the image.',
        'Round flag-pattern countryballs, expressive simple eyes, sweat drops, tears, anger marks, shock lines, clean thick black outlines, webtoon-like shading, dramatic but readable composition.',
        'Not photorealistic, not 3D render, not anime humans, no realistic human faces, no infographic layout.',
    ]
        .filter(Boolean)
        .join(' ');
}

async function throwIfCancelled(context?: BlockExecutorContext): Promise<void> {
    if (context?.abortSignal?.aborted) throw new Error('Run cancelled during countryball-image execution');
    if (await context?.isCancelled?.()) throw new Error('Run cancelled during countryball-image execution');
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

function isRecord(input: unknown): input is Record<string, unknown> {
    return input != null && typeof input === 'object' && !Array.isArray(input);
}
