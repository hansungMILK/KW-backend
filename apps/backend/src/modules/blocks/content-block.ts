import { extractTopic } from './search-block';
import { ContentOutputSchema } from './types';
import { openaiAdapter } from '../../adapters/ai/openai-adapter';
import { env } from '../../config/env';
import { log } from '../../utils/logger';
import { buildCombinedPrompt } from '../shorts/rulepacks/base-shorts-rulepack';
import { SCRIPT_OUTPUT_RULES, SCRIPT_WRITER_RULES } from '../shorts/rulepacks/script-writer-rulepack';
import { DIRECTOR_OUTPUT_RULES, SHORTS_DIRECTOR_RULES } from '../shorts/rulepacks/shorts-director-rulepack';
import { selectShortsRulepack } from '../shorts/topic-router';

import type { BlockExecutor, BlockExecutorResult } from './types';

// ── Prompts ──────────────────────────────────────────────────────────────────

const CONTENT_SYSTEM_PROMPT = `You are a Korean YouTube Shorts scriptwriter.
Given keywords and/or article summaries, generate a complete 10–15 scene, one-minute vertical comic Shorts plan in Korean.

Requirements:
- title: a short high-impact Korean title that can stay at the top of every frame
- hook: a punchy opening question or statement (one short sentence, max 32 Korean characters)
- script: structured script metadata with hook, angle, and cta
- style: structured visual style metadata for vertical-comic-shorts
- scenes: 10–15 scenes, each with:
  - sceneNumber
  - imageSlot: "[Image #1]" through "[Image #12]" or "[Image #15]"
  - storyBeat: hook|setup|escalation|reveal|takeaway|cta or another compact beat label
  - topTitle: the same persistent Korean top title for every scene
  - caption: a short bold Korean on-screen subtitle (8–22 Korean characters)
  - narration: Korean voice-over text (one short spoken sentence, 18–42 Korean characters)
  - imagePrompt: English AI image generation prompt for the central illustration only. Do not ask the image model to draw titles, subtitles, black bands, lower thirds, source labels, logos, or readable Korean/English text.
  - visualText: backward-compatible short Korean main caption string
  - visual: { topTitle, mainCaption, sourceLabel? }
  - claimType: fact|hypothetical|opinion|joke
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
  "script": { "hook": "...", "angle": "...", "cta": "..." },
  "style": { "format": "vertical-comic-shorts", "aspectRatio": "9:16", "sceneCount": 12, "visualGrammar": {} },
  "scenes": [
    { "sceneNumber": 1, "imageSlot": "[Image #1]", "storyBeat": "hook", "topTitle": "...", "caption": "...", "narration": "...", "imagePrompt": "...", "visualText": "...", "visual": { "topTitle": "...", "mainCaption": "...", "sourceLabel": "..." }, "claimType": "fact", "sourceRefs": ["source-1"], "durationSec": 5 },
    ...
  ],
  "cta": "...",
  "totalDurationSec": 60,
  "sources": [
    { "id": "source-1", "title": "...", "url": "...", "source": "...", "publishedAt": "YYYY-MM-DD or null", "sourceType": "official|news|blog|other", "confidence": 0.9, "summary": "..." }
  ]
}`;

const SINGLE_IMAGE_SYSTEM_PROMPT = `You are an AI image prompt planner.
Given a user's image request, produce exactly one scene that can be passed to GPT-image-2.

Requirements:
- title: a compact Korean title for the image, max 16 Korean characters
- hook: one short Korean phrase describing the image intent
- script: { hook, angle, cta }
- style: { format: "single-image", aspectRatio: "9:16", sceneCount: 1 }
- scenes: exactly 1 scene with:
  - sceneNumber: 1
  - imageSlot: "[Image #1]"
  - storyBeat: "single-image"
  - topTitle: compact Korean title
  - caption: a short bold Korean caption, max 18 Korean characters
  - narration: one short Korean description of the image, max 42 Korean characters
  - imagePrompt: English AI image generation prompt for one complete image. Preserve the user's subject and action.
  - visualText: exact short Korean text intended for the video overlay; otherwise same as caption
  - visual: { topTitle, mainCaption, sourceLabel? }
  - claimType: opinion|joke|hypothetical|fact
  - sourceRefs: []
  - durationSec: 5
- cta: empty string
- totalDurationSec: 5
- sources: []

Do not create a Shorts/video plan. Do not add TTS, video, SEO, or distribution steps.
Respond with JSON only — no markdown fences, no extra text.`;

const GENERIC_TEXT_SYSTEM_PROMPT = `You are a Korean content writer inside a general workflow automation engine.
Given upstream research or user input, produce the requested text/data output without forcing a Shorts scene contract.

Respond with JSON only — no markdown fences, no extra text:
{
  "text": "final Korean text",
  "content": "same final Korean text",
  "value": "same final Korean text",
  "mode": "text",
  "sources": []
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

    async execute(input: unknown, config?: Record<string, unknown>): Promise<BlockExecutorResult> {
        const mode = env.orchestratorMode;
        if (mode === 'mock') return dummyContent();

        const start = Date.now();
        const userMessage = buildUserMessage(input);
        const rulepack = selectShortsRulepack(input);
        const singleImageMode = isSingleImageMode(input, config);
        const genericTextMode = isGenericTextMode(input, config);

        log.info('[content-block] Starting AI script generation', {
            messageLength: userMessage.length,
            presetId: rulepack.id,
            mode: singleImageMode ? 'single-image' : genericTextMode ? 'text' : 'shorts',
        });

        const directorPrompt = `${SCRIPT_WRITER_RULES}\n\n${SCRIPT_OUTPUT_RULES}\n\n${SHORTS_DIRECTOR_RULES}\n\n${DIRECTOR_OUTPUT_RULES}`;
        const response = await openaiAdapter.chatJson({
            model: env.openaiModel,
            systemPrompt: singleImageMode
                ? `${SINGLE_IMAGE_SYSTEM_PROMPT}\n\n${directorPrompt}\n\n${rulepack.imagePrompt}`
                : genericTextMode
                  ? GENERIC_TEXT_SYSTEM_PROMPT
                  : `${CONTENT_SYSTEM_PROMPT}\n\n${buildCombinedPrompt(rulepack, 'contentPrompt')}\n\n${directorPrompt}\n\n${rulepack.sourcePolicy}`,
            userMessage,
            maxTokens: 4096,
        });

        let parsed: unknown;
        try {
            parsed = JSON.parse(response.content);
        } catch {
            throw new Error(`[content-block] OpenAI returned non-JSON response (length=${response.content.length})`);
        }

        if (genericTextMode) {
            const normalizedText = normalizeGenericTextOutput(parsed, input);
            log.info('[content-block] Text generation complete', {
                textLength: typeof normalizedText.text === 'string' ? normalizedText.text.length : 0,
                latencyMs: response.latencyMs,
            });
            return { output: normalizedText, durationMs: Date.now() - start };
        }

        const normalized = normalizeContentOutput(parsed, input, rulepack.id);
        const validated = ContentOutputSchema.safeParse(normalized);
        if (!validated.success) {
            throw new Error(`[content-block] Output schema validation failed: ${validated.error.message}`);
        }

        if (singleImageMode && validated.data.scenes.length !== 1) {
            throw new Error(
                `[content-block] Expected exactly 1 scene for single-image mode, got ${validated.data.scenes.length}`
            );
        }

        if (!singleImageMode && (validated.data.scenes.length < 10 || validated.data.scenes.length > 15)) {
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

function isSingleImageMode(input: unknown, config?: Record<string, unknown>): boolean {
    const values: unknown[] = [config?.['mode'], config?.['type'], config?.['format'], config?.['scenario']];
    if (input && typeof input === 'object' && !Array.isArray(input)) {
        const obj = input as Record<string, unknown>;
        values.push(obj['mode'], obj['type'], obj['format'], obj['scenario']);
    }

    const modeText = values
        .filter((value): value is string => typeof value === 'string')
        .join(' ')
        .toLowerCase();

    const inputScenes =
        input && typeof input === 'object' && !Array.isArray(input)
            ? (input as Record<string, unknown>)['scenes']
            : undefined;
    const sceneCount = Number(config?.['scenes'] ?? inputScenes);

    return modeText.includes('single-image') || modeText.includes('image-only') || sceneCount === 1;
}

function isGenericTextMode(input: unknown, config?: Record<string, unknown>): boolean {
    const values: unknown[] = [
        config?.['mode'],
        config?.['type'],
        config?.['format'],
        config?.['outputType'],
        config?.['scenario'],
    ];
    if (input && typeof input === 'object' && !Array.isArray(input)) {
        const obj = input as Record<string, unknown>;
        values.push(obj['mode'], obj['type'], obj['format'], obj['outputType'], obj['scenario']);
    }

    const modeText = values
        .filter((value): value is string => typeof value === 'string')
        .join(' ')
        .toLowerCase();

    return ['text', 'summary', 'summarize', 'explain', 'write', 'rewrite', 'translate'].some(mode =>
        modeText.includes(mode)
    );
}

function normalizeGenericTextOutput(parsed: unknown, input: unknown): Record<string, unknown> {
    const obj = isRecord(parsed) ? parsed : {};
    const text =
        typeof obj['text'] === 'string'
            ? obj['text']
            : typeof obj['content'] === 'string'
              ? obj['content']
              : typeof obj['value'] === 'string'
                ? obj['value']
                : typeof parsed === 'string'
                  ? parsed
                  : JSON.stringify(parsed);

    const sources = extractSources(input);
    return {
        ...obj,
        text,
        content: typeof obj['content'] === 'string' ? obj['content'] : text,
        value: typeof obj['value'] === 'string' ? obj['value'] : text,
        mode: typeof obj['mode'] === 'string' ? obj['mode'] : 'text',
        sources: Array.isArray(obj['sources']) && obj['sources'].length > 0 ? obj['sources'] : sources,
    };
}

function normalizeContentOutput(parsed: unknown, input: unknown, presetId: string): unknown {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return parsed;
    const obj = parsed as Record<string, unknown>;
    const sources = extractSources(input);
    const script = isRecord(obj['script']) ? obj['script'] : {};
    const title = typeof obj['title'] === 'string' ? obj['title'] : '쇼츠 핵심 정리';
    const hook =
        typeof obj['hook'] === 'string' ? obj['hook'] : typeof script['hook'] === 'string' ? script['hook'] : title;
    const cta =
        typeof obj['cta'] === 'string'
            ? obj['cta']
            : typeof script['cta'] === 'string'
              ? script['cta']
              : '저장하고 다음에 다시 확인하세요.';
    const scenes = Array.isArray(obj['scenes'])
        ? (obj['scenes'] as Record<string, unknown>[]).map((scene, index) => ({
              ...normalizeScene(scene, index, title),
          }))
        : obj['scenes'];

    return {
        ...obj,
        title,
        hook: compactSpokenLine(hook, 32),
        script: {
            ...script,
            hook: compactSpokenLine(hook, 32),
            cta: compactSpokenLine(cta, 32),
        },
        style: normalizeStyle(obj['style'], Array.isArray(scenes) ? scenes.length : undefined),
        scenes,
        cta: compactSpokenLine(cta, 32),
        sources: Array.isArray(obj['sources']) && obj['sources'].length > 0 ? obj['sources'] : sources,
        presetId,
    };
}

function normalizeScene(scene: Record<string, unknown>, index: number, title: string): Record<string, unknown> {
    const sceneNumber = typeof scene['sceneNumber'] === 'number' ? scene['sceneNumber'] : index + 1;
    const imageSlot = typeof scene['imageSlot'] === 'string' ? scene['imageSlot'] : `[Image #${sceneNumber}]`;
    const caption = typeof scene['caption'] === 'string' ? compactPromptText(stripMarkdown(scene['caption']), 22) : '';
    const visual = isRecord(scene['visual']) ? scene['visual'] : {};
    const topTitle =
        typeof scene['topTitle'] === 'string'
            ? compactPromptText(stripMarkdown(scene['topTitle']), 18)
            : typeof visual['topTitle'] === 'string'
              ? compactPromptText(stripMarkdown(visual['topTitle']), 18)
              : compactPromptText(title, 18);
    const mainCaption =
        typeof visual['mainCaption'] === 'string'
            ? compactPromptText(stripMarkdown(visual['mainCaption']), 18)
            : typeof scene['visualText'] === 'string'
              ? compactPromptText(stripMarkdown(scene['visualText']), 18)
              : compactPromptText(caption, 18);
    const sourceRefs = Array.isArray(scene['sourceRefs']) ? scene['sourceRefs'] : [];
    const claimType = normalizeClaimType(scene['claimType'], scene, sourceRefs);

    return {
        ...scene,
        sceneNumber,
        imageSlot,
        storyBeat: typeof scene['storyBeat'] === 'string' ? scene['storyBeat'] : storyBeatForIndex(index),
        topTitle,
        caption,
        narration:
            typeof scene['narration'] === 'string' ? compactSpokenLine(scene['narration'], 42) : scene['narration'],
        visualText: mainCaption || caption || undefined,
        visual: {
            ...visual,
            topTitle,
            mainCaption: mainCaption || caption || undefined,
            sourceLabel:
                typeof visual['sourceLabel'] === 'string' ? compactPromptText(visual['sourceLabel'], 24) : undefined,
        },
        claimType,
        sourceRefs,
    };
}

function normalizeStyle(input: unknown, sceneCount?: number): Record<string, unknown> {
    const style = isRecord(input) ? input : {};
    return {
        ...style,
        format: typeof style['format'] === 'string' ? style['format'] : 'vertical-comic-shorts',
        aspectRatio: typeof style['aspectRatio'] === 'string' ? style['aspectRatio'] : '9:16',
        sceneCount: typeof style['sceneCount'] === 'number' ? style['sceneCount'] : sceneCount,
    };
}

function storyBeatForIndex(index: number): string {
    const beats = ['hook', 'setup', 'escalation', 'reveal', 'takeaway', 'cta'];
    if (index === 0) return 'hook';
    return beats[Math.min(beats.length - 1, Math.floor((index / 12) * beats.length))] ?? 'takeaway';
}

function normalizeClaimType(input: unknown, scene: Record<string, unknown>, sourceRefs: unknown[]): string {
    if (input === 'fact' && sourceRefs.length === 0 && isQuestionOnlyScene(scene)) return 'opinion';
    if (input === 'fact' || input === 'hypothetical' || input === 'opinion' || input === 'joke') return input;
    if (sourceRefs.length > 0) return 'fact';

    const text = [scene['caption'], scene['visualText'], scene['narration']]
        .filter((value): value is string => typeof value === 'string')
        .join(' ');
    if (/\d{4}|\d+월|\d+일|\d+%|\d+등급|\d+점/.test(text)) return 'fact';
    return 'opinion';
}

function isQuestionOnlyScene(scene: Record<string, unknown>): boolean {
    const text = [scene['caption'], scene['visualText'], scene['narration']]
        .filter((value): value is string => typeof value === 'string')
        .join(' ');
    if (!/[?？]|\bwhy\b|왜|뭐|무엇|어떻게|정말/.test(text)) return false;
    return !/\d{4}|\d+월|\d+일|\d+%|\d+등급|\d+점/.test(text);
}

function isRecord(input: unknown): input is Record<string, unknown> {
    return input != null && typeof input === 'object' && !Array.isArray(input);
}

function compactSpokenLine(value: string, maxChars: number): string {
    const cleaned = value.replace(/\s+/g, ' ').trim();
    if (cleaned.length <= maxChars) return cleaned;

    const firstSentence = cleaned.split(/(?<=[.!?。！？]|요\.|다\.|죠\.|니다\.)\s+/)[0]?.trim();
    if (firstSentence && firstSentence.length <= maxChars) return firstSentence;

    const sliced = cleaned.slice(0, Math.max(1, maxChars - 1)).replace(/[,\s.]+$/g, '');
    return `${sliced}.`;
}

function compactPromptText(value: string, maxChars: number): string {
    const compact = value.replace(/\s+/g, ' ').trim();
    if (compact.length <= maxChars) return compact;
    return `${compact.slice(0, Math.max(1, maxChars - 1)).trim()}...`;
}

function stripMarkdown(value: string): string {
    return value
        .replace(/\*\*/g, '')
        .replace(/__/g, '')
        .replace(/[`*_~]/g, '')
        .trim();
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
