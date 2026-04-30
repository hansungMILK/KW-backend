import { randomUUID } from 'crypto';

import { imageAdapter } from '../../adapters/ai/image-adapter';
import { getPublicUrl, putObject } from '../../adapters/aws/s3';
import { env } from '../../config/env';
import { traceService } from '../../services/trace-service';

import type { BlockExecutor, BlockExecutorResult } from './types';

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

    async execute(input: unknown, _config?: Record<string, unknown>): Promise<BlockExecutorResult> {
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
            durationSec?: number;
        };
        const rawScenes: RawScene[] =
            (inp?.normalizedScenes as RawScene[] | undefined) ?? (inp?.scenes as RawScene[] | undefined) ?? [];
        const metadata = inp?.metadata as Record<string, unknown> | undefined;
        const frameTitle =
            (typeof metadata?.title === 'string' ? metadata.title : undefined) ??
            (typeof inp?.title === 'string' ? inp.title : undefined) ??
            '입시 정보 핵심 정리';

        // Fall back to dummy prompts if upstream gave us nothing
        const dummy = dummyImageOutput();
        const scenePrompts: Array<{
            sceneNumber: number;
            caption: string;
            narration: string;
            durationSec: number;
            prompt: string;
        }> =
            rawScenes.length > 0
                ? rawScenes.map((s, i) => ({
                      sceneNumber: s.sceneNumber ?? i + 1,
                      caption: s.caption ?? s.narration?.slice(0, 22) ?? `장면 ${i + 1}`,
                      narration: s.narration ?? '',
                      durationSec: s.durationSec ?? 5,
                      prompt: buildShortsFramePrompt(
                          frameTitle,
                          s.caption ?? s.narration ?? `장면 ${i + 1}`,
                          s.imagePrompt
                      ),
                  }))
                : dummy.images.map(img => ({
                      sceneNumber: img.sceneNumber,
                      caption: img.prompt.slice(0, 20),
                      narration: '',
                      durationSec: 5,
                      prompt: img.prompt,
                  }));

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
        };

        const images: ImageResult[] = [];
        const assets: NonNullable<BlockExecutorResult['assets']> = [];

        for (const scene of scenePrompts) {
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

                const publicUrl = getPublicUrl(s3Key);
                const durationMs = Date.now() - sceneStart;

                images.push({
                    sceneNumber: scene.sceneNumber,
                    url: publicUrl,
                    width: generated.width,
                    height: generated.height,
                    prompt: scene.prompt,
                    caption: scene.caption,
                    narration: scene.narration,
                    durationSec: scene.durationSec,
                });

                assets.push({
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
                        durationMs,
                    },
                });

                // Record per-image trace (non-fatal)
                try {
                    await traceService.record(
                        'pending',
                        null,
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
            } catch (err: unknown) {
                // Partial success: log and skip failing scenes
                const msg = err instanceof Error ? err.message : String(err);
                console.warn(`[media-image-block] scene ${scene.sceneNumber} failed (skipping): ${msg}`);
                // Use placeholder URL for failed scenes so downstream blocks aren't broken
                images.push({
                    sceneNumber: scene.sceneNumber,
                    url: `fake://placeholder/scene-${scene.sceneNumber}-failed`,
                    width: 1080,
                    height: 1920,
                    prompt: scene.prompt,
                    caption: scene.caption,
                    narration: scene.narration,
                    durationSec: scene.durationSec,
                });
                try {
                    await traceService.record(
                        'pending',
                        null,
                        'ERROR',
                        `media-image: scene ${scene.sceneNumber} failed: ${msg}`
                    );
                } catch {
                    /* non-fatal */
                }
            }
        }

        if (assets.length === 0) {
            throw new Error('media-image generated no usable image assets');
        }

        return {
            output: { title: frameTitle, images, normalizedScenes: scenePrompts },
            durationMs: Date.now() - start,
            assets,
        };
    },
};

function buildShortsFramePrompt(title: string, caption: string, visualPrompt?: string): string {
    return [
        'Create one complete 9:16 Korean YouTube Shorts frame, not a poster mockup.',
        `Persistent top title band: black background, huge bold Korean title text "${title}" in neon yellow and white, similar to Korean Shorts thumbnails.`,
        `Scene caption: large bold Korean text "${caption}" with black stroke, placed over the image without covering key characters.`,
        'Style: clean viral educational shorts, high contrast, readable Korean typography, dynamic but not cluttered.',
        'Leave safe margins for mobile viewing.',
        visualPrompt || 'Korean university admission and student study scene, cinematic educational illustration.',
    ].join(' ');
}
