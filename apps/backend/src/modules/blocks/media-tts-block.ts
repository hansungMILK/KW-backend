import { randomUUID } from 'crypto';

import { ttsAdapter } from '../../adapters/ai/tts-adapter';
import { getPublicUrl, putObject } from '../../adapters/aws/s3';
import { env } from '../../config/env';
import { traceService } from '../../services/trace-service';

import type { BlockExecutor, BlockExecutorContext, BlockExecutorResult } from './types';

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

    async execute(
        input: unknown,
        _config?: Record<string, unknown>,
        context?: BlockExecutorContext
    ): Promise<BlockExecutorResult> {
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
        type RawScene = {
            sceneNumber?: number;
            caption?: string;
            narration?: string;
            durationSec?: number;
            dialogueLines?: unknown;
        };

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

        const segments = buildNarrationSegments(rawScenes, hook, cta, isCountryballMetadata(metadata));

        if (segments.length === 0) {
            throw new Error('media-tts requires narration text from content or data block');
        }

        const fullText = segments.map(segment => segment.text).join(' ');

        try {
            await throwIfCancelled(context);
            await recordTtsTrace(context, 'tts.text.prepared', 'STATUS', {
                textLength: fullText.length,
                segmentCount: segments.length,
            });
            await context?.onProgress?.(35, '나레이션 텍스트 준비 완료');

            await recordTtsTrace(context, 'tts.requested', 'STATUS', {
                textLength: fullText.length,
                fallbackOrder: ['elevenlabs', 'openai'],
            });
            const ttsStartedAt = Date.now();
            const result = await ttsAdapter.synthesize({ text: fullText, signal: context?.abortSignal });
            await recordTtsTrace(context, `tts.${result.provider}.completed`, 'STATUS', {
                provider: result.provider,
                model: result.model,
                voiceId: result.voiceId,
                durationMs: Date.now() - ttsStartedAt,
                estimatedDurationSec: result.estimatedDurationSec,
                bytes: result.audioBuffer.byteLength,
            });
            await context?.onProgress?.(60, '나레이션 음성 생성 완료');
            await throwIfCancelled(context);

            const subtitleCues = buildSceneSubtitleCues(segments, result.estimatedDurationSec);

            const s3Key = `media/audio/${randomUUID()}/narration.mp3`;
            await recordTtsTrace(context, 'tts.upload.started', 'STATUS', { s3Key });
            await putObject(s3Key, result.audioBuffer, result.contentType);
            const publicUrl = getPublicUrl(s3Key);
            await recordTtsTrace(context, 'tts.upload.completed', 'STATUS', { s3Key });
            await context?.onProgress?.(70, '나레이션 음성 저장 완료');

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
                await traceService.record(
                    context?.runId ?? 'pending',
                    context?.nodeId ?? null,
                    'STATUS',
                    'media-tts: audio generated',
                    {
                        s3Key,
                        estimatedDurationSec: result.estimatedDurationSec,
                    }
                );
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
                        provider: result.provider,
                        model: result.model,
                        voiceId: result.voiceId,
                    },
                    narrationText: fullText,
                    subtitleCues,
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
                await traceService.record(
                    context?.runId ?? 'pending',
                    context?.nodeId ?? null,
                    'ERROR',
                    `media-tts: failed: ${msg}`
                );
            } catch {
                /* non-fatal */
            }
            throw err;
        }
    },
};

async function throwIfCancelled(context?: BlockExecutorContext): Promise<void> {
    if (context?.abortSignal?.aborted) throw new Error('Run cancelled during media-tts execution');
    if (await context?.isCancelled?.()) throw new Error('Run cancelled during media-tts execution');
}

async function recordTtsTrace(
    context: BlockExecutorContext | undefined,
    event: string,
    traceType: 'STATUS' | 'ERROR',
    data?: Record<string, unknown>
): Promise<void> {
    try {
        await traceService.record(
            context?.runId ?? 'pending',
            context?.nodeId ?? null,
            traceType,
            `media-tts:${event}`,
            {
                event,
                ...data,
            }
        );
    } catch {
        /* traceService is non-fatal */
    }
}

type NarrationSegment = {
    sceneNumber: number;
    text: string;
    role: 'hook' | 'scene' | 'cta';
};

function buildNarrationSegments(
    scenes: Array<{ sceneNumber?: number; narration?: string; dialogueLines?: unknown }>,
    hook: string,
    cta: string,
    preferDialogueLines = false
): NarrationSegment[] {
    const segments: NarrationSegment[] = [];
    const firstSceneNumber = normalizeSceneNumber(scenes[0]?.sceneNumber, 1);
    const lastSceneNumber = normalizeSceneNumber(scenes.at(-1)?.sceneNumber, Math.max(1, scenes.length));

    const hookText = normalizeSubtitleText(hook);
    if (hookText) {
        segments.push({ sceneNumber: firstSceneNumber, text: hookText, role: 'hook' });
    }

    scenes.forEach((scene, index) => {
        const dialogueText = preferDialogueLines ? normalizeSubtitleText(formatDialogueLines(scene.dialogueLines)) : '';
        const text = dialogueText || normalizeSubtitleText(scene.narration);
        if (!text) return;
        segments.push({
            sceneNumber: normalizeSceneNumber(scene.sceneNumber, index + 1),
            text,
            role: 'scene',
        });
    });

    const ctaText = normalizeSubtitleText(cta);
    if (ctaText) {
        segments.push({ sceneNumber: lastSceneNumber, text: ctaText, role: 'cta' });
    }

    return segments;
}

function isCountryballMetadata(metadata: Record<string, unknown> | undefined): boolean {
    if (!metadata) return false;
    if (metadata['presetId'] === 'countryball-shorts') return true;
    if (metadata['contentProfileId'] === 'shorts.countryball.v1') return true;
    if (metadata['imageStyleId'] === 'countryball-comic') return true;
    if (metadata['narrativeMode'] === 'countryball-situation-reenactment') return true;
    const outputContract = metadata['outputContract'];
    if (outputContract != null && typeof outputContract === 'object' && !Array.isArray(outputContract)) {
        const contract = outputContract as Record<string, unknown>;
        return (
            contract['contentProfileId'] === 'shorts.countryball.v1' ||
            contract['imageStyleId'] === 'countryball-comic' ||
            contract['narrativeMode'] === 'countryball-situation-reenactment'
        );
    }
    return false;
}

function formatDialogueLines(input: unknown): string {
    if (!Array.isArray(input)) return '';
    return input
        .map(line => {
            if (typeof line === 'string') return line.trim();
            if (line == null || typeof line !== 'object' || Array.isArray(line)) return '';
            const item = line as Record<string, unknown>;
            const text = typeof item['text'] === 'string' ? item['text'].trim() : '';
            if (!text) return '';
            const speaker = typeof item['speaker'] === 'string' ? formatDialogueSpeaker(item['speaker']) : '';
            return speaker ? `${speaker}: ${text}` : text;
        })
        .filter(Boolean)
        .join(' ');
}

function formatDialogueSpeaker(input: string): string {
    const normalized = input.trim();
    const upper = normalized.toUpperCase();
    const map: Record<string, string> = {
        KR: '한국볼',
        KOR: '한국볼',
        JP: '일본볼',
        JPN: '일본볼',
        US: '미국볼',
        USA: '미국볼',
        CN: '중국볼',
        CHN: '중국볼',
        UK: '영국볼',
        GB: '영국볼',
        FR: '프랑스볼',
        DE: '독일볼',
        RU: '러시아볼',
    };
    return map[upper] ?? normalized;
}

function buildSceneSubtitleCues(segments: NarrationSegment[], totalDurationSec: number) {
    const safeTotalDurationSec = Number.isFinite(totalDurationSec) && totalDurationSec > 0 ? totalDurationSec : 1;
    const totalWeight = segments.reduce((sum, segment) => sum + subtitleWeight(segment.text), 0) || segments.length;
    let cursorSec = 0;

    return segments.map((segment, index) => {
        const isLast = index === segments.length - 1;
        const durationSec = isLast
            ? Math.max(0.25, safeTotalDurationSec - cursorSec)
            : (safeTotalDurationSec * subtitleWeight(segment.text)) / totalWeight;
        const startSec = cursorSec;
        const endSec = isLast ? safeTotalDurationSec : Math.min(safeTotalDurationSec, startSec + durationSec);
        cursorSec = endSec;

        return {
            sceneNumber: segment.sceneNumber,
            text: segment.text,
            role: segment.role,
            startSec: roundToMillis(startSec),
            endSec: roundToMillis(endSec),
        };
    });
}

function subtitleWeight(text: string): number {
    return Math.max(4, text.replace(/\s+/g, '').length);
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
