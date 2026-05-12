import { DataOutputSchema } from './types';
import { env } from '../../config/env';
import { log } from '../../utils/logger';

import type { BlockExecutor, BlockExecutorResult } from './types';

// ── Dummy (mock mode) ─────────────────────────────────────────────────────────

function dummyData(): BlockExecutorResult {
    const start = Date.now();
    const output = {
        normalizedScenes: Array.from({ length: 10 }, (_, index) => {
            const sceneNumber = index + 1;
            const captions = [
                '먼저 배경',
                '핵심 주장',
                '문제 구조',
                '근거 확인',
                '영향 분석',
                '반대 관점',
                '주의할 점',
                '실제 사례',
                '한 줄 요약',
                '다음 행동',
            ];
            const caption = `[dummy] ${captions[index]}`;
            return {
                sceneNumber,
                caption,
                narration: `[dummy] ${captions[index]}을 짧게 설명하는 정보 전달 문장입니다.`,
                imagePrompt: `[dummy] Korean explainer scene for ${captions[index]}, concise in-scene text allowed`,
                visualText: caption,
                sourceRefs: [`source-${Math.min(index + 1, 3)}`],
                durationSec: 6,
                keywords: ['요약', '근거', '정보'],
            };
        }),
        metadata: {
            source: '[dummy] content-block',
            normalizedAt: new Date().toISOString(),
            sceneCount: 10,
            totalDurationSec: 60,
            language: 'ko',
            presetId: 'general-shorts',
            sources: [
                {
                    id: 'source-1',
                    title: '[dummy] 사용자 제공 원문',
                    url: 'fake://news.example.com/article/001',
                    source: '[dummy] Example Source',
                    publishedAt: null,
                    sourceType: 'other',
                    confidence: 0.5,
                },
            ],
        },
    };
    return { output, durationMs: Date.now() - start };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

interface RawScene {
    sceneNumber?: unknown;
    imageSlot?: unknown;
    storyBeat?: unknown;
    topTitle?: unknown;
    caption?: unknown;
    narration?: unknown;
    imagePrompt?: unknown;
    visualText?: unknown;
    visual?: unknown;
    claimType?: unknown;
    sourceRefs?: unknown;
    durationSec?: unknown;
}

/**
 * Extract the upstream keywords list from a search-block output embedded
 * in the input (if available). Falls back to [].
 */
function extractKeywords(input: unknown): string[] {
    if (input == null || typeof input !== 'object' || Array.isArray(input)) return [];
    const obj = input as Record<string, unknown>;
    if (Array.isArray(obj['keywords'])) {
        return (obj['keywords'] as unknown[]).map(k => String(k));
    }
    return [];
}

/**
 * Pure deterministic transform: content-block output → media-ready scenes.
 * No LLM call. Never throws on valid input.
 */
function normalizeContent(input: unknown): BlockExecutorResult {
    const start = Date.now();

    const upstreamKeywords = extractKeywords(input);

    // Extract scenes from content-block output shape
    let rawScenes: RawScene[] = [];
    let totalDurationSec = 0;
    let title = '';
    let hook = '';
    let cta = '';
    let script: unknown;
    let style: unknown;
    let sources: unknown[] = [];
    let presetId = '';

    if (input != null && typeof input === 'object' && !Array.isArray(input)) {
        const obj = input as Record<string, unknown>;

        if (typeof obj['title'] === 'string') title = obj['title'];
        if (typeof obj['hook'] === 'string') hook = obj['hook'];
        if (typeof obj['cta'] === 'string') cta = obj['cta'];
        script = obj['script'];
        style = obj['style'];
        if (typeof obj['totalDurationSec'] === 'number') totalDurationSec = obj['totalDurationSec'];
        if (Array.isArray(obj['sources'])) sources = obj['sources'];
        if (typeof obj['presetId'] === 'string') presetId = obj['presetId'];

        if (Array.isArray(obj['scenes'])) {
            rawScenes = obj['scenes'] as RawScene[];
        }
    }

    const normalizedScenes = rawScenes.map((scene, idx) => {
        const sceneNumber = typeof scene.sceneNumber === 'number' ? scene.sceneNumber : idx + 1;
        const imageSlot = typeof scene.imageSlot === 'string' ? scene.imageSlot : `[Image #${sceneNumber}]`;
        const storyBeat = typeof scene.storyBeat === 'string' ? scene.storyBeat : undefined;
        const visual = isRecord(scene.visual) ? scene.visual : undefined;
        const topTitle =
            typeof scene.topTitle === 'string'
                ? scene.topTitle
                : typeof visual?.['topTitle'] === 'string'
                  ? visual['topTitle']
                  : undefined;
        const caption = typeof scene.caption === 'string' ? stripMarkdown(scene.caption) : '';
        const narration = typeof scene.narration === 'string' ? scene.narration : '';
        const imagePrompt = typeof scene.imagePrompt === 'string' ? scene.imagePrompt : '';
        const visualText =
            typeof scene.visualText === 'string'
                ? stripMarkdown(scene.visualText)
                : typeof visual?.['mainCaption'] === 'string'
                  ? stripMarkdown(visual['mainCaption'])
                  : caption.length > 0
                    ? caption
                    : undefined;
        const sourceRefs = Array.isArray(scene.sourceRefs) ? scene.sourceRefs : [];
        const claimType =
            scene.claimType === 'fact' &&
            sourceRefs.length === 0 &&
            isQuestionOnlyScene({ ...scene, caption, narration })
                ? 'opinion'
                : isClaimType(scene.claimType)
                  ? scene.claimType
                  : inferClaimType(scene, sourceRefs);
        const durationSec = typeof scene.durationSec === 'number' ? scene.durationSec : 5;

        // Derive per-scene keywords: prefer upstream list sliced per scene,
        // fallback to empty array.
        const sceneKeywords =
            upstreamKeywords.length > 0 ? upstreamKeywords.slice(0, Math.min(3, upstreamKeywords.length)) : [];

        return {
            sceneNumber,
            imageSlot,
            storyBeat,
            topTitle,
            caption,
            narration,
            imagePrompt,
            visualText,
            visual,
            claimType,
            sourceRefs,
            durationSec,
            keywords: sceneKeywords,
        };
    });

    if (normalizedScenes.length === 0) {
        throw new Error('[data-block] content output has no scenes to normalize');
    }

    const finalScenes = normalizedScenes;

    const output = {
        normalizedScenes: finalScenes,
        metadata: {
            source: 'content-block',
            normalizedAt: new Date().toISOString(),
            sceneCount: finalScenes.length,
            totalDurationSec: totalDurationSec || finalScenes.length * 6,
            language: 'ko',
            title: title || undefined,
            hook: hook || undefined,
            cta: cta || undefined,
            script,
            style,
            sources,
            presetId: presetId || undefined,
        },
    };

    const validated = DataOutputSchema.safeParse(output);
    if (!validated.success) {
        // This should never happen with valid input — log but return raw output
        log.warn('[data-block] DataOutputSchema validation warning', { error: validated.error.message });
    }

    log.info('[data-block] Normalization complete', {
        sceneCount: finalScenes.length,
        totalDurationSec: output.metadata.totalDurationSec,
    });

    return { output: output as Record<string, unknown>, durationMs: Date.now() - start };
}

// ── Executor ──────────────────────────────────────────────────────────────────

export const dataBlock: BlockExecutor = {
    blockType: 'data',

    async execute(input: unknown, config?: Record<string, unknown>): Promise<BlockExecutorResult> {
        const mode = env.orchestratorMode;
        if (mode === 'mock') return dummyData();

        if (isLongformGateAInput(input, config)) {
            return normalizeLongformGateA(input);
        }

        // Pure deterministic transform — same logic in every real provider mode.
        return normalizeContent(input);
    },
};

function isRecord(input: unknown): input is Record<string, unknown> {
    return input != null && typeof input === 'object' && !Array.isArray(input);
}

function isClaimType(input: unknown): input is 'fact' | 'hypothetical' | 'opinion' | 'joke' {
    return input === 'fact' || input === 'hypothetical' || input === 'opinion' || input === 'joke';
}

function inferClaimType(scene: RawScene, sourceRefs: unknown[]): 'fact' | 'opinion' {
    if (sourceRefs.length > 0) return 'fact';
    const text = [scene.caption, scene.visualText, scene.narration]
        .filter((value): value is string => typeof value === 'string')
        .join(' ');
    if (/\d{4}|\d+월|\d+일|\d+%|\d+등급|\d+점/.test(text)) return 'fact';
    return 'opinion';
}

function isQuestionOnlyScene(scene: RawScene): boolean {
    const text = [scene.caption, scene.visualText, scene.narration]
        .filter((value): value is string => typeof value === 'string')
        .join(' ');
    if (!/[?？]|왜|뭐|무엇|어떻게|정말/.test(text)) return false;
    return !/\d{4}|\d+월|\d+일|\d+%|\d+등급|\d+점/.test(text);
}

function stripMarkdown(value: string): string {
    return value
        .replace(/\*\*/g, '')
        .replace(/__/g, '')
        .replace(/[`*_~]/g, '')
        .trim();
}

function isLongformGateAInput(input: unknown, config?: Record<string, unknown>): boolean {
    const values: unknown[] = [config?.['mode'], config?.['gate']];
    if (input && typeof input === 'object' && !Array.isArray(input)) {
        const obj = input as Record<string, unknown>;
        values.push(obj['mode'], obj['gate'], obj['contentProfileId']);
    }
    const text = values
        .filter((value): value is string => typeof value === 'string')
        .join(' ')
        .toLowerCase();
    return text.includes('longform-gate-a') || text.includes('longform.');
}

function normalizeLongformGateA(input: unknown): BlockExecutorResult {
    const start = Date.now();
    const obj = isRecord(input) ? input : {};
    const output = {
        ...obj,
        gate: 'A',
        mode: 'longform-gate-a',
        outline: Array.isArray(obj['outline']) ? obj['outline'] : [],
        fullScriptDraft: typeof obj['fullScriptDraft'] === 'string' ? obj['fullScriptDraft'] : '',
        scenePlan: Array.isArray(obj['scenePlan']) ? obj['scenePlan'] : [],
        estimatedDurationSec: readPositiveNumber(obj['estimatedDurationSec']) ?? 300,
        estimatedCost: isRecord(obj['estimatedCost'])
            ? obj['estimatedCost']
            : { currency: 'USD', total: 0.16, notes: ['Gate A planning only'] },
        rendererRoute: typeof obj['rendererRoute'] === 'string' ? obj['rendererRoute'] : 'hyperframes',
        qaChecklist: Array.isArray(obj['qaChecklist']) ? obj['qaChecklist'] : ['출처 확인', '대본 검수', '씬 승인'],
        mediaExecutionAllowed: false,
        metadata: {
            ...(isRecord(obj['metadata']) ? obj['metadata'] : {}),
            source: 'longform-gate-a',
            normalizedAt: new Date().toISOString(),
        },
    };

    log.info('[data-block] Longform Gate A normalization complete', {
        outlineCount: output.outline.length,
        sceneCount: output.scenePlan.length,
        estimatedDurationSec: output.estimatedDurationSec,
    });

    return { output, durationMs: Date.now() - start };
}

function readPositiveNumber(input: unknown): number | undefined {
    const value = Number(input);
    return Number.isFinite(value) && value > 0 ? value : undefined;
}
