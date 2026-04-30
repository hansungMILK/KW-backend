import { randomUUID } from 'crypto';

import { ttsAdapter } from '../../adapters/ai/tts-adapter';
import { getPublicUrl, putObject } from '../../adapters/aws/s3';
import { env } from '../../config/env';
import { traceService } from '../../services/trace-service';

import type { BlockExecutor, BlockExecutorResult } from './types';

// ─── dummy output ─────────────────────────────────────────────────────────────

function dummyTtsOutput() {
    return {
        audio: {
            url: 'fake://cdn.example.com/audio/narration-2026-suneung.mp3',
            durationSec: 45,
            format: 'mp3',
            sampleRate: 44100,
        },
    };
}

// ─── block ───────────────────────────────────────────────────────────────────

export const mediaTtsBlock: BlockExecutor = {
    blockType: 'media-tts',

    async execute(input: unknown, _config?: Record<string, unknown>): Promise<BlockExecutorResult> {
        const start = Date.now();

        if (env.orchestratorMode === 'mock') {
            const output = dummyTtsOutput();
            return {
                output,
                durationMs: Date.now() - start,
                assets: [
                    {
                        assetType: 'AUDIO',
                        mimeType: 'audio/mpeg',
                        data: output.audio.url,
                        metadata: {
                            durationSec: output.audio.durationSec,
                            format: output.audio.format,
                            sampleRate: output.audio.sampleRate,
                        },
                    },
                ],
            };
        }

        // ── Real mode ──────────────────────────────────────────────────────────

        // Extract narration text from upstream content/data block output.
        // Supports two upstream shapes:
        //   content block: { scenes: [{ narration }], hook, cta }
        //   data block:    { normalizedScenes: [{ narration }] }
        const inp = input as Record<string, unknown> | null;
        type RawScene = { sceneNumber?: number; caption?: string; narration?: string; durationSec?: number };

        const rawScenes: RawScene[] =
            (inp?.normalizedScenes as RawScene[] | undefined) ?? (inp?.scenes as RawScene[] | undefined) ?? [];
        const metadata = inp?.metadata as Record<string, unknown> | undefined;

        const hook = typeof inp?.hook === 'string' ? inp.hook : '';
        const cta =
            typeof inp?.cta === 'string'
                ? inp.cta
                : typeof metadata?.['cta'] === 'string'
                  ? (metadata['cta'] as string)
                  : '';

        const narrationParts: string[] = [];
        if (hook) narrationParts.push(hook);
        for (const scene of rawScenes) {
            if (scene.narration) narrationParts.push(scene.narration);
        }
        if (cta) narrationParts.push(cta);

        // Fall back to a generic placeholder if no narration was found
        const fullText = narrationParts.length > 0 ? narrationParts.join(' ') : '안녕하세요. 오늘의 숏츠를 시작합니다.';

        try {
            const result = await ttsAdapter.synthesize({ text: fullText });

            const s3Key = `media/audio/${randomUUID()}/narration.mp3`;
            await putObject(s3Key, result.audioBuffer, result.contentType);
            const publicUrl = getPublicUrl(s3Key);

            const assets: BlockExecutorResult['assets'] = [
                {
                    assetType: 'AUDIO',
                    mimeType: result.contentType,
                    data: result.audioBuffer,
                    metadata: {
                        s3Key,
                        durationSec: result.estimatedDurationSec,
                        textLength: fullText.length,
                    },
                },
            ];

            try {
                await traceService.record('pending', null, 'STATUS', 'media-tts: audio generated', {
                    s3Key,
                    estimatedDurationSec: result.estimatedDurationSec,
                });
            } catch {
                /* non-fatal */
            }

            return {
                output: {
                    audio: {
                        url: publicUrl,
                        durationSec: result.estimatedDurationSec,
                        format: 'mp3',
                        sampleRate: 44100,
                    },
                    normalizedScenes: rawScenes,
                    ...(metadata ? { metadata } : {}),
                },
                durationMs: Date.now() - start,
                assets,
            };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[media-tts-block] TTS generation failed: ${msg}`);
            try {
                await traceService.record('pending', null, 'ERROR', `media-tts: failed: ${msg}`);
            } catch {
                /* non-fatal */
            }
            throw err;
        }
    },
};
