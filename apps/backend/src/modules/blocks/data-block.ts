import { DataOutputSchema } from './types';
import { env } from '../../config/env';
import { log } from '../../utils/logger';

import type { BlockExecutor, BlockExecutorResult } from './types';

// ── Dummy (mock mode) ─────────────────────────────────────────────────────────

function dummyData(): BlockExecutorResult {
    const start = Date.now();
    const output = {
        normalizedScenes: [
            {
                sceneNumber: 1,
                caption: '[dummy] 입시가 바뀐다',
                narration: '[dummy] 매년 11월, 수험생들의 운명을 가르는 수능이 다가옵니다.',
                imagePrompt:
                    '[dummy] A student nervously studying late at night, books and notes spread on desk, warm lamp light, cinematic',
                durationSec: 6,
                keywords: ['수능', '수험생', '11월'],
            },
            {
                sceneNumber: 2,
                caption: '[dummy] 국어가 변수다',
                narration: '[dummy] 2026학년도 수능, 국어 비문학이 달라집니다.',
                imagePrompt:
                    '[dummy] Close-up of Korean language exam paper with highlighted passages, clean white background',
                durationSec: 6,
                keywords: ['2026', '국어', '비문학'],
            },
            {
                sceneNumber: 3,
                caption: '[dummy] 수학은 여전히 벽',
                narration: '[dummy] 수학 영역은 여전히 수험생들의 최대 난관.',
                imagePrompt:
                    '[dummy] Complex math equations floating in a blue abstract digital space, dramatic lighting',
                durationSec: 6,
                keywords: ['수학', '난관', '영역'],
            },
            {
                sceneNumber: 4,
                caption: '[dummy] 난도 상승 예고',
                narration: '[dummy] 전문가들은 올해 수능 난이도가 작년보다 소폭 높아질 것으로 예측합니다.',
                imagePrompt:
                    '[dummy] Expert teacher pointing at a graph showing difficulty trends, professional setting',
                durationSec: 6,
                keywords: ['난이도', '전문가', '예측'],
            },
            {
                sceneNumber: 5,
                caption: '[dummy] 정시 일정 체크',
                narration: '[dummy] 정시 원서 접수는 12월 초, 지금부터 전략이 필요합니다.',
                imagePrompt: '[dummy] Calendar showing December dates circled in red, urgency visual',
                durationSec: 6,
                keywords: ['정시', '원서접수', '전략'],
            },
            {
                sceneNumber: 6,
                caption: '[dummy] 기출이 답이다',
                narration: '[dummy] 합격의 비결은 단 하나 — 꾸준한 기출 분석과 약점 보완.',
                imagePrompt:
                    '[dummy] Stack of past exam papers with sticky notes, organized study setup, motivational atmosphere',
                durationSec: 6,
                keywords: ['합격', '기출', '약점보완'],
            },
            {
                sceneNumber: 7,
                caption: '[dummy] 지금 전략 세워라',
                narration: '[dummy] 지금 바로 전략을 세우세요. 당신의 합격을 응원합니다!',
                imagePrompt:
                    '[dummy] Triumphant student raising fists in celebration, graduation cap flying, sunny campus background',
                durationSec: 6,
                keywords: ['응원', '합격', '전략'],
            },
            {
                sceneNumber: 8,
                caption: '[dummy] 점수보다 전략',
                narration: '[dummy] 같은 점수라도 대학별 반영 방식에 따라 결과가 달라질 수 있습니다.',
                imagePrompt: '[dummy] Korean admission score report and strategy graph, bold vertical shorts layout',
                durationSec: 6,
                keywords: ['점수', '반영비율', '전략'],
            },
            {
                sceneNumber: 9,
                caption: '[dummy] 상담은 빠르게',
                narration: '[dummy] 담임 상담과 입시 자료를 함께 보며 지원 가능성을 좁혀야 합니다.',
                imagePrompt:
                    '[dummy] Student and counselor planning university admission options, clean educational style',
                durationSec: 6,
                keywords: ['상담', '지원가능성', '자료'],
            },
            {
                sceneNumber: 10,
                caption: '[dummy] 마지막 체크',
                narration: '[dummy] 마감일, 제출 서류, 모집 단위까지 마지막에 한 번 더 확인하세요.',
                imagePrompt: '[dummy] Smartphone admission checklist with Korean bold text, vertical shorts frame',
                durationSec: 6,
                keywords: ['마감일', '제출서류', '체크리스트'],
            },
        ],
        metadata: {
            source: '[dummy] content-block',
            normalizedAt: new Date().toISOString(),
            sceneCount: 10,
            totalDurationSec: 60,
            language: 'ko',
        },
    };
    return { output, durationMs: Date.now() - start };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

interface RawScene {
    sceneNumber?: unknown;
    caption?: unknown;
    narration?: unknown;
    imagePrompt?: unknown;
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

    if (input != null && typeof input === 'object' && !Array.isArray(input)) {
        const obj = input as Record<string, unknown>;

        if (typeof obj['title'] === 'string') title = obj['title'];
        if (typeof obj['hook'] === 'string') hook = obj['hook'];
        if (typeof obj['cta'] === 'string') cta = obj['cta'];
        if (typeof obj['totalDurationSec'] === 'number') totalDurationSec = obj['totalDurationSec'];

        if (Array.isArray(obj['scenes'])) {
            rawScenes = obj['scenes'] as RawScene[];
        }
    }

    const normalizedScenes = rawScenes.map((scene, idx) => {
        const sceneNumber = typeof scene.sceneNumber === 'number' ? scene.sceneNumber : idx + 1;
        const caption = typeof scene.caption === 'string' ? scene.caption : '';
        const narration = typeof scene.narration === 'string' ? scene.narration : '';
        const imagePrompt = typeof scene.imagePrompt === 'string' ? scene.imagePrompt : '';
        const durationSec = typeof scene.durationSec === 'number' ? scene.durationSec : 5;

        // Derive per-scene keywords: prefer upstream list sliced per scene,
        // fallback to empty array.
        const sceneKeywords =
            upstreamKeywords.length > 0 ? upstreamKeywords.slice(0, Math.min(3, upstreamKeywords.length)) : [];

        return { sceneNumber, caption, narration, imagePrompt, durationSec, keywords: sceneKeywords };
    });

    // If no scenes were extracted (edge case: empty content), produce placeholder
    const finalScenes =
        normalizedScenes.length > 0
            ? normalizedScenes
            : [
                  {
                      sceneNumber: 1,
                      caption: '',
                      narration: '',
                      imagePrompt: '',
                      durationSec: 5,
                      keywords: upstreamKeywords.slice(0, 3),
                  },
              ];

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

    async execute(input: unknown, _config?: Record<string, unknown>): Promise<BlockExecutorResult> {
        const mode = env.orchestratorMode;
        if (mode === 'mock') return dummyData();

        // Pure deterministic transform — same logic in every real provider mode.
        return normalizeContent(input);
    },
};
