import { extractTopic } from './search-block';
import { ContentOutputSchema } from './types';
import { openaiAdapter } from '../../adapters/ai/openai-adapter';
import { env } from '../../config/env';
import { log } from '../../utils/logger';
import { buildCombinedPrompt } from '../shorts/rulepacks/base-shorts-rulepack';
import { selectShortsRulepack } from '../shorts/topic-router';

import type { BlockExecutor, BlockExecutorResult } from './types';

// ── Prompts ──────────────────────────────────────────────────────────────────

const CONTENT_SYSTEM_PROMPT = `You are a Korean YouTube Shorts scriptwriter.
Given keywords and/or article summaries, generate a complete 10–15 scene, one-minute short-form video script in Korean.

Requirements:
- title: a short high-impact Korean title that can stay at the top of every frame
- hook: a punchy opening question or statement (one short sentence, max 32 Korean characters)
- scenes: 10–15 scenes, each with:
  - sceneNumber
  - imageSlot: "[Image #1]" through "[Image #12]" or "[Image #15]"
  - caption: a short bold Korean on-screen subtitle (8–22 Korean characters)
  - narration: Korean voice-over text (one short spoken sentence, 18–42 Korean characters)
  - imagePrompt: English AI image generation prompt for a complete 9:16 YouTube Shorts frame using GPT-image-2. Short Korean title/caption text is allowed.
  - visualText: the exact short Korean text intended for the image frame
  - sourceRefs: source ids or compact source objects used by the scene
  - durationSec: 4–6 seconds per scene
- cta: call-to-action closing line (max 32 Korean characters)
- totalDurationSec: sum of all scene durations
- sources: all source objects preserved from search
- total spoken text budget for hook + all narrations + cta: max 520 Korean characters

Respond with JSON only — no markdown fences, no extra text:
{
  "title": "...",
  "hook": "...",
  "scenes": [
    { "sceneNumber": 1, "imageSlot": "[Image #1]", "caption": "...", "narration": "...", "imagePrompt": "...", "visualText": "...", "sourceRefs": ["source-1"], "durationSec": 5 },
    ...
  ],
  "cta": "...",
  "totalDurationSec": 60,
  "sources": [
    { "id": "source-1", "title": "...", "url": "...", "source": "...", "publishedAt": "YYYY-MM-DD or null", "sourceType": "official|news|blog|other", "confidence": 0.9, "summary": "..." }
  ]
}`;

// ── Dummy (mock mode) ─────────────────────────────────────────────────────────

function dummyContent(): BlockExecutorResult {
    const start = Date.now();
    const output = {
        title: '[dummy] 2026 입시 핵심 변화',
        hook: '[dummy] 2026 수능, 올해 수험생들이 가장 두려워하는 과목은?',
        scenes: [
            {
                sceneNumber: 1,
                caption: '[dummy] 입시가 바뀐다',
                narration: '[dummy] 매년 11월, 수험생들의 운명을 가르는 수능이 다가옵니다.',
                imagePrompt:
                    '[dummy] A student nervously studying late at night, books and notes spread on desk, warm lamp light, cinematic',
                visualText: '[dummy] 입시가 바뀐다',
                sourceRefs: ['source-1'],
                durationSec: 6,
            },
            {
                sceneNumber: 2,
                caption: '[dummy] 국어가 변수다',
                narration: '[dummy] 2026학년도 수능, 국어 비문학이 달라집니다.',
                imagePrompt:
                    '[dummy] Close-up of Korean language exam paper with highlighted passages, clean white background',
                visualText: '[dummy] 국어가 변수다',
                sourceRefs: ['source-1'],
                durationSec: 6,
            },
            {
                sceneNumber: 3,
                caption: '[dummy] 수학은 여전히 벽',
                narration: '[dummy] 수학 영역은 여전히 수험생들의 최대 난관.',
                imagePrompt:
                    '[dummy] Complex math equations floating in a blue abstract digital space, dramatic lighting',
                visualText: '[dummy] 수학은 여전히 벽',
                sourceRefs: ['source-2'],
                durationSec: 6,
            },
            {
                sceneNumber: 4,
                caption: '[dummy] 난도 상승 예고',
                narration: '[dummy] 전문가들은 올해 수능 난이도가 작년보다 소폭 높아질 것으로 예측합니다.',
                imagePrompt:
                    '[dummy] Expert teacher pointing at a graph showing difficulty trends, professional setting',
                visualText: '[dummy] 난도 상승 예고',
                sourceRefs: ['source-2'],
                durationSec: 6,
            },
            {
                sceneNumber: 5,
                caption: '[dummy] 정시 일정 체크',
                narration: '[dummy] 정시 원서 접수는 12월 초, 지금부터 전략이 필요합니다.',
                imagePrompt: '[dummy] Calendar showing December dates circled in red, urgency visual',
                visualText: '[dummy] 정시 일정 체크',
                sourceRefs: ['source-2'],
                durationSec: 6,
            },
            {
                sceneNumber: 6,
                caption: '[dummy] 기출이 답이다',
                narration: '[dummy] 합격의 비결은 단 하나 — 꾸준한 기출 분석과 약점 보완.',
                imagePrompt:
                    '[dummy] Stack of past exam papers with sticky notes, organized study setup, motivational atmosphere',
                visualText: '[dummy] 기출이 답이다',
                sourceRefs: ['source-3'],
                durationSec: 6,
            },
            {
                sceneNumber: 7,
                caption: '[dummy] 지금 전략 세워라',
                narration: '[dummy] 지금 바로 전략을 세우세요. 당신의 합격을 응원합니다!',
                imagePrompt:
                    '[dummy] Triumphant student raising fists in celebration, graduation cap flying, sunny campus background',
                visualText: '[dummy] 지금 전략 세워라',
                sourceRefs: ['source-3'],
                durationSec: 6,
            },
            {
                sceneNumber: 8,
                caption: '[dummy] 점수보다 전략',
                narration: '[dummy] 같은 점수라도 대학별 반영 방식에 따라 결과가 달라질 수 있습니다.',
                imagePrompt: '[dummy] Korean admission score report and strategy graph, bold vertical shorts layout',
                visualText: '[dummy] 점수보다 전략',
                sourceRefs: ['source-2'],
                durationSec: 6,
            },
            {
                sceneNumber: 9,
                caption: '[dummy] 상담은 빠르게',
                narration: '[dummy] 담임 상담과 입시 자료를 함께 보며 지원 가능성을 좁혀야 합니다.',
                imagePrompt:
                    '[dummy] Student and counselor planning university admission options, clean educational style',
                visualText: '[dummy] 상담은 빠르게',
                sourceRefs: ['source-1'],
                durationSec: 6,
            },
            {
                sceneNumber: 10,
                caption: '[dummy] 마지막 체크',
                narration: '[dummy] 마감일, 제출 서류, 모집 단위까지 마지막에 한 번 더 확인하세요.',
                imagePrompt: '[dummy] Smartphone admission checklist with Korean bold text, vertical shorts frame',
                visualText: '[dummy] 마지막 체크',
                sourceRefs: ['source-2'],
                durationSec: 6,
            },
        ],
        cta: '[dummy] 구독하고 매일 입시 트렌드를 받아보세요!',
        totalDurationSec: 60,
        sources: [
            {
                id: 'source-1',
                title: '[dummy] 2026 수능 출제 경향 분석',
                url: 'fake://news.example.com/article/001',
                source: '[dummy] EduNews',
                publishedAt: null,
                sourceType: 'other',
                confidence: 0.5,
            },
        ],
        presetId: 'education-admission',
    };
    return { output, durationMs: Date.now() - start };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a descriptive user message from the search block's output (or any input).
 */
function buildUserMessage(input: unknown): string {
    if (input == null) return '주제: 입시 트렌드';

    if (typeof input === 'object' && !Array.isArray(input)) {
        const obj = input as Record<string, unknown>;
        const parts: string[] = [];

        if (Array.isArray(obj['keywords']) && (obj['keywords'] as unknown[]).length > 0) {
            parts.push(`키워드: ${(obj['keywords'] as unknown[]).map(k => String(k)).join(', ')}`);
        }

        if (Array.isArray(obj['articles']) && (obj['articles'] as unknown[]).length > 0) {
            const summaries = (obj['articles'] as Record<string, unknown>[])
                .slice(0, 3)
                .map(
                    a =>
                        `- ${String(a['id'] ?? '')} ${String(a['title'] ?? '')} (${String(a['source'] ?? '')}, ${String(a['publishedAt'] ?? 'date unknown')}, ${String(a['sourceType'] ?? 'other')}, confidence=${String(a['confidence'] ?? 'unknown')})\n  URL: ${String(a['url'] ?? '')}\n  Summary: ${String(a['summary'] ?? '')}`
                )
                .join('\n');
            parts.push(`관련 출처:\n${summaries}`);
        }

        if (parts.length > 0) return parts.join('\n\n');
    }

    // Fallback: use topic extraction
    return `주제: ${extractTopic(input)}`;
}

// ── Executor ──────────────────────────────────────────────────────────────────

export const contentBlock: BlockExecutor = {
    blockType: 'content',

    async execute(input: unknown, _config?: Record<string, unknown>): Promise<BlockExecutorResult> {
        const mode = env.orchestratorMode;
        if (mode === 'mock') return dummyContent();

        const start = Date.now();
        const userMessage = buildUserMessage(input);
        const rulepack = selectShortsRulepack(input);

        log.info('[content-block] Starting AI script generation', {
            messageLength: userMessage.length,
            presetId: rulepack.id,
        });

        const response = await openaiAdapter.chatJson({
            model: env.openaiModel,
            systemPrompt: `${CONTENT_SYSTEM_PROMPT}\n\n${buildCombinedPrompt(rulepack, 'contentPrompt')}\n\n${rulepack.sourcePolicy}`,
            userMessage,
            maxTokens: 4096,
        });

        let parsed: unknown;
        try {
            parsed = JSON.parse(response.content);
        } catch {
            throw new Error(`[content-block] OpenAI returned non-JSON response (length=${response.content.length})`);
        }

        const normalized = normalizeContentOutput(parsed, input, rulepack.id);
        const validated = ContentOutputSchema.safeParse(normalized);
        if (!validated.success) {
            throw new Error(`[content-block] Output schema validation failed: ${validated.error.message}`);
        }

        if (validated.data.scenes.length < 10 || validated.data.scenes.length > 15) {
            throw new Error(`[content-block] Expected 10-15 scenes, got ${validated.data.scenes.length}`);
        }

        log.info('[content-block] Script generation complete', {
            sceneCount: validated.data.scenes.length,
            totalDurationSec: validated.data.totalDurationSec,
            latencyMs: response.latencyMs,
        });

        return { output: validated.data as Record<string, unknown>, durationMs: Date.now() - start };
    },
};

function normalizeContentOutput(parsed: unknown, input: unknown, presetId: string): unknown {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return parsed;
    const obj = parsed as Record<string, unknown>;
    const sources = extractSources(input);
    const fallbackSourceRefs = sources.length > 0 ? [sources[0]?.id ?? sources[0]?.source ?? 'source-1'] : [];
    const scenes = Array.isArray(obj['scenes'])
        ? (obj['scenes'] as Record<string, unknown>[]).map((scene, index) => ({
              ...scene,
              sceneNumber: typeof scene['sceneNumber'] === 'number' ? scene['sceneNumber'] : index + 1,
              imageSlot: typeof scene['imageSlot'] === 'string' ? scene['imageSlot'] : `[Image #${index + 1}]`,
              narration:
                  typeof scene['narration'] === 'string'
                      ? compactSpokenLine(scene['narration'], 42)
                      : scene['narration'],
              visualText:
                  typeof scene['visualText'] === 'string'
                      ? scene['visualText']
                      : typeof scene['caption'] === 'string'
                        ? scene['caption']
                        : undefined,
              sourceRefs: Array.isArray(scene['sourceRefs']) ? scene['sourceRefs'] : fallbackSourceRefs,
          }))
        : obj['scenes'];

    return {
        ...obj,
        hook: typeof obj['hook'] === 'string' ? compactSpokenLine(obj['hook'], 32) : obj['hook'],
        cta: typeof obj['cta'] === 'string' ? compactSpokenLine(obj['cta'], 32) : obj['cta'],
        scenes,
        sources: Array.isArray(obj['sources']) && obj['sources'].length > 0 ? obj['sources'] : sources,
        presetId,
    };
}

function compactSpokenLine(value: string, maxChars: number): string {
    const cleaned = value.replace(/\s+/g, ' ').trim();
    if (cleaned.length <= maxChars) return cleaned;

    const firstSentence = cleaned.split(/(?<=[.!?。！？]|요\.|다\.|죠\.|니다\.)\s+/)[0]?.trim();
    if (firstSentence && firstSentence.length <= maxChars) return firstSentence;

    const sliced = cleaned.slice(0, Math.max(1, maxChars - 1)).replace(/[,\s.]+$/g, '');
    return `${sliced}.`;
}

function extractSources(input: unknown): Array<Record<string, unknown>> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return [];
    const obj = input as Record<string, unknown>;
    if (!Array.isArray(obj['articles'])) return [];
    return (obj['articles'] as Record<string, unknown>[]).map((article, index) => ({
        id: typeof article['id'] === 'string' ? article['id'] : `source-${index + 1}`,
        title: article['title'],
        url: article['url'],
        source: article['source'],
        publishedAt: article['publishedAt'] ?? null,
        sourceType: article['sourceType'] ?? 'other',
        confidence: article['confidence'] ?? 0.6,
        summary: article['summary'],
    }));
}
