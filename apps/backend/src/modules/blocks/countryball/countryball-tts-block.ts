import { randomUUID } from 'crypto';

import { type TtsResult, ttsAdapter } from '../../../adapters/ai/tts-adapter';
import { getPublicUrl, putObject } from '../../../adapters/aws/s3';
import { audioConcatAdapter } from '../../../adapters/external/audio-concat-adapter';
import { env } from '../../../config/env';
import { traceService } from '../../../services/trace-service';
import { CountryballTtsOutputSchema } from '../types';

import type { BlockExecutor, BlockExecutorContext, BlockExecutorResult } from '../types';

export const countryballTtsBlock: BlockExecutor = {
    blockType: 'countryball-tts',

    async execute(
        input: unknown,
        _config?: Record<string, unknown>,
        context?: BlockExecutorContext
    ): Promise<BlockExecutorResult> {
        const start = Date.now();
        const root = isRecord(input) ? input : {};
        const scenes = Array.isArray(root['normalizedScenes']) ? root['normalizedScenes'].filter(isRecord) : [];
        const segments = buildVoiceSegments(scenes);
        if (segments.length === 0) throw new Error('countryball-tts requires dialogueLines or short narrator lines');

        if (env.orchestratorMode === 'mock') {
            const roleVoiceMap = buildRoleVoiceMap(segments);
            const output = {
                audio: {
                    url: 'fake://cdn.example.com/audio/countryball-role-voices.mp3',
                    durationSec: Math.max(20, segments.length * 2.3),
                    format: 'mp3',
                    sampleRate: 44100,
                    voiceMode: 'countryball-role-voices' as const,
                    voiceSegments: segments.map(segment => ({
                        ...segment,
                        voiceId: roleVoiceMap.get(segment.voiceRole) ?? voiceIdForRole(segment.voiceRole),
                        durationSec: 2.3,
                    })),
                },
                narrationText: segments.map(segment => segment.text).join(' '),
                subtitleCues: buildTimedSubtitleCues(
                    segments,
                    segments.map(() => 2.3)
                ),
                normalizedScenes: scenes,
                metadata: root['metadata'],
            };
            return { output, durationMs: Date.now() - start };
        }

        if (!(await ttsAdapter.canUseElevenLabs())) {
            throw new Error('countryball-tts requires configured ElevenLabs credentials for role-based voices');
        }

        const providerVoiceIds = (await ttsAdapter.listElevenLabsVoices()).map(voice => voice.voiceId);
        const roleVoiceMap = buildRoleVoiceMap(segments, voiceIdForRole, providerVoiceIds);
        await trace(context, 'countryball-tts:segments.prepared', { segmentCount: segments.length });
        const synthesized: Array<TtsResult & { segment: CountryballVoiceSegment }> = [];
        for (const segment of segments) {
            await throwIfCancelled(context);
            const result = await ttsAdapter.synthesize({
                text: segment.text,
                voiceId: roleVoiceMap.get(segment.voiceRole) ?? voiceIdForRole(segment.voiceRole),
                signal: context?.abortSignal,
            });
            if (result.provider !== 'elevenlabs') {
                throw new Error('countryball-tts role voices require ElevenLabs output');
            }
            synthesized.push({ ...result, segment });
        }

        const audioBuffer = await audioConcatAdapter.concatMp3(
            synthesized.map(result => ({ audioBuffer: result.audioBuffer })),
            context?.abortSignal
        );
        const durations = synthesized.map(result => result.estimatedDurationSec);
        const durationSec = roundToMillis(durations.reduce((sum, value) => sum + value, 0));
        const first = synthesized[0];
        const s3Key = `media/audio/${randomUUID()}/countryball-dialogue.mp3`;
        await putObject(s3Key, audioBuffer, 'audio/mpeg');
        const publicUrl = getPublicUrl(s3Key);

        const output = {
            audio: {
                url: publicUrl,
                durationSec,
                format: 'mp3',
                sampleRate: 44100,
                provider: 'elevenlabs',
                model: first?.model,
                voiceMode: 'countryball-role-voices' as const,
                voiceSegments: synthesized.map(result => ({
                    sceneId: result.segment.sceneId,
                    sceneNumber: result.segment.sceneNumber,
                    country: result.segment.country,
                    text: result.segment.text,
                    voiceRole: result.segment.voiceRole,
                    voiceId: result.voiceId,
                    durationSec: result.estimatedDurationSec,
                    pauseAfterMs: result.segment.pauseAfterMs,
                })),
            },
            narrationText: segments.map(segment => segment.text).join(' '),
            subtitleCues: buildTimedSubtitleCues(segments, durations),
            normalizedScenes: scenes,
            metadata: root['metadata'],
        };
        const validated = CountryballTtsOutputSchema.safeParse(output);
        if (!validated.success) {
            throw new Error(`[countryball-tts] Output schema validation failed: ${validated.error.message}`);
        }

        return {
            output: validated.data as Record<string, unknown>,
            durationMs: Date.now() - start,
            assets: [
                {
                    assetType: 'AUDIO',
                    mimeType: 'audio/mpeg',
                    data: audioBuffer,
                    metadata: { s3Key, durationSec, segmentCount: segments.length },
                },
            ],
        };
    },
};

type CountryballVoiceSegment = {
    sceneId?: string;
    sceneNumber: number;
    country: string;
    text: string;
    role: 'title' | 'dialogue' | 'action' | 'reaction' | 'ending';
    speakerCountry?: string;
    voiceRole: string;
    pauseAfterMs?: number;
};

function buildVoiceSegments(scenes: Record<string, unknown>[]): CountryballVoiceSegment[] {
    const segments: CountryballVoiceSegment[] = [];
    scenes.forEach((scene, index) => {
        const sceneNumber = number(scene['sceneNumber'], index + 1);
        const sceneId = text(scene['sceneId']);
        const narratorLine = narratorText(scene['narratorLine']);
        if (narratorLine) {
            segments.push({
                sceneId,
                sceneNumber,
                country: 'narrator',
                text: narratorLine,
                role: sceneNumber === 1 ? 'title' : 'action',
                voiceRole: 'narrator_short',
            });
        }

        const dialogueLines = Array.isArray(scene['dialogueLines']) ? scene['dialogueLines'].filter(isRecord) : [];
        for (const line of dialogueLines) {
            const spoken = text(line['line'] ?? line['text']);
            if (!spoken) continue;
            const country = text(line['country'], '국가볼');
            segments.push({
                sceneId,
                sceneNumber,
                country,
                text: spoken,
                role: 'dialogue',
                speakerCountry: country,
                voiceRole: text(line['voiceRole'], 'main_confident'),
                pauseAfterMs: typeof line['pauseAfterMs'] === 'number' ? line['pauseAfterMs'] : undefined,
            });
        }
    });
    return segments;
}

function buildTimedSubtitleCues(segments: CountryballVoiceSegment[], durationsSec: number[]) {
    let cursorSec = 0;
    return segments.map((segment, index) => {
        const durationSec =
            Number.isFinite(durationsSec[index]) && durationsSec[index] > 0 ? durationsSec[index] : 0.25;
        const startSec = cursorSec;
        const endSec = startSec + durationSec;
        cursorSec = endSec;
        return {
            sceneNumber: segment.sceneNumber,
            text: segment.text,
            role: segment.role,
            speakerCountry: segment.speakerCountry,
            startSec: roundToMillis(startSec),
            endSec: roundToMillis(endSec),
        };
    });
}

function buildRoleVoiceMap(
    segments: CountryballVoiceSegment[],
    resolveVoiceId: (role: string | undefined) => string = voiceIdForRole,
    providerVoiceIds: string[] = []
): Map<string, string> {
    const roleVoiceMap = new Map<string, string>();
    const usedVoiceIds = new Set<string>();
    const uniqueProviderVoiceIds = Array.from(new Set(providerVoiceIds.map(value => text(value)).filter(Boolean)));
    const orderedVoiceRoles = orderedRoles(segments);

    orderedVoiceRoles.forEach(role => {
        const configuredVoiceId = text(resolveVoiceId(role));
        if (configuredVoiceId && !usedVoiceIds.has(configuredVoiceId)) {
            roleVoiceMap.set(role, configuredVoiceId);
            usedVoiceIds.add(configuredVoiceId);
            return;
        }

        const providerVoiceId = uniqueProviderVoiceIds.find(voiceId => !usedVoiceIds.has(voiceId));
        if (providerVoiceId) {
            roleVoiceMap.set(role, providerVoiceId);
            usedVoiceIds.add(providerVoiceId);
            return;
        }

        if (configuredVoiceId) roleVoiceMap.set(role, configuredVoiceId);
    });

    const dialogueSegments = segments.filter(segment => segment.role === 'dialogue');
    const countries = new Set(dialogueSegments.map(segment => segment.country).filter(Boolean));
    const dialogueRoles = new Set(dialogueSegments.map(segment => segment.voiceRole).filter(Boolean));
    if (countries.size < 2) return roleVoiceMap;
    if (dialogueRoles.size < 2) {
        throw new Error('countryball-tts requires at least 2 voiceRole values when multiple countryballs speak');
    }

    const roleVoicePairs = Array.from(dialogueRoles).map(role => ({ role, voiceId: text(roleVoiceMap.get(role)) }));
    const missingRoles = roleVoicePairs.filter(pair => !pair.voiceId).map(pair => pair.role);
    if (missingRoles.length > 0) {
        throw new Error(
            `countryball-tts requires configured ElevenLabs voice IDs for roles: ${missingRoles.join(', ')}`
        );
    }

    const distinctVoiceIds = new Set(roleVoicePairs.map(pair => pair.voiceId));
    if (distinctVoiceIds.size < 2) {
        throw new Error('countryball-tts requires distinct role voice IDs when multiple countryball roles speak');
    }
    return roleVoiceMap;
}

function orderedRoles(segments: CountryballVoiceSegment[]): string[] {
    const roles: string[] = [];
    for (const segment of segments) {
        const role = text(segment.voiceRole);
        if (role && !roles.includes(role)) roles.push(role);
    }
    return roles;
}

function voiceIdForRole(role: string | undefined): string {
    switch (role) {
        case 'main_tired':
            return env.countryballTtsVoiceMainTired;
        case 'main_confident':
            return env.countryballTtsVoiceMainConfident;
        case 'rival_smug':
            return env.countryballTtsVoiceRivalSmug;
        case 'rival_angry':
            return env.countryballTtsVoiceRivalAngry;
        case 'neutral_serious':
            return env.countryballTtsVoiceNeutralSerious;
        case 'panic_high':
            return env.countryballTtsVoicePanicHigh;
        case 'deep_serious':
            return env.countryballTtsVoiceNeutralSerious;
        case 'old_teacher':
            return env.countryballTtsVoiceOldTeacher;
        case 'narrator_short':
        default:
            return env.countryballTtsVoiceNarrator;
    }
}

async function throwIfCancelled(context?: BlockExecutorContext): Promise<void> {
    if (context?.abortSignal?.aborted) throw new Error('Run cancelled during countryball-tts execution');
    if (await context?.isCancelled?.()) throw new Error('Run cancelled during countryball-tts execution');
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

function narratorText(input: unknown): string {
    if (typeof input === 'string') return input.length <= 32 ? input.trim() : '';
    if (isRecord(input) && typeof input['text'] === 'string') {
        const value = input['text'].trim();
        return value.length <= 32 ? value : '';
    }
    return '';
}

function text(input: unknown, fallback = ''): string {
    return typeof input === 'string' && input.trim() ? input.replace(/\s+/g, ' ').trim() : fallback;
}

function number(input: unknown, fallback: number): number {
    return typeof input === 'number' && Number.isFinite(input) ? input : fallback;
}

function roundToMillis(value: number): number {
    return Math.round(value * 1000) / 1000;
}

function isRecord(input: unknown): input is Record<string, unknown> {
    return input != null && typeof input === 'object' && !Array.isArray(input);
}

export const __test__ = {
    buildRoleVoiceMap,
    buildTimedSubtitleCues,
};
