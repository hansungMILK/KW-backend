import { extractTopic } from './search-block';
import { ContentOutputSchema } from './types';
import { openaiAdapter } from '../../adapters/ai/openai-adapter';
import { env } from '../../config/env';
import { log } from '../../utils/logger';
import { buildCombinedPrompt } from '../shorts/rulepacks/base-shorts-rulepack';
import { buildContentPreferencePrompt, buildScriptTonePrompt } from '../shorts/rulepacks/script-tone-rulepack';
import { SCRIPT_OUTPUT_RULES, SCRIPT_WRITER_RULES } from '../shorts/rulepacks/script-writer-rulepack';
import { DIRECTOR_OUTPUT_RULES, SHORTS_DIRECTOR_RULES } from '../shorts/rulepacks/shorts-director-rulepack';
import { selectShortsRulepack } from '../shorts/topic-router';

import type { BlockExecutor, BlockExecutorResult } from './types';

// ── Prompts ──────────────────────────────────────────────────────────────────

const CONTENT_SYSTEM_PROMPT = `You are a Korean YouTube Shorts scriptwriter and scene planner.
Given keywords and/or article summaries, generate a complete 10–15 scene, one-minute vertical Shorts plan in Korean.

Requirements:
- If the user message contains "PRIMARY SOURCE", treat that source as the main brief. Supporting sources may verify or add caveats, but must not replace the primary source's angle.
- Preserve concrete numbers, conditions, warnings, and key claims from the PRIMARY SOURCE in factual scenes.
- For URL/article requests, build the script from the article's factual spine: who/what/when, the triggering claim, the disputed action, the response/apology, and what viewers should take away.
- Do not replace a provided URL's specific story with generic background. If the article mentions names, dates, product names, amounts, or direct allegations, use those exact facts in the narration.
- title: a short high-impact Korean title that can stay at the top of every frame
- hook: a punchy opening question or statement (one short sentence, max 32 Korean characters)
- script: structured script metadata with hook, angle, and cta
- style: structured visual style metadata for vertical-shorts
- scenes: 10–15 scenes, each with:
  - sceneNumber
  - imageSlot: "[Image #1]" through "[Image #12]" or "[Image #15]"
  - storyBeat: hook|setup|escalation|reveal|takeaway|cta or another compact beat label
  - topTitle: the same persistent Korean top title for every scene
  - caption: a short bold Korean on-screen subtitle (8–22 Korean characters)
  - narration: Korean voice-over text (one short spoken sentence, 18–42 Korean characters)
  - imagePrompt: English style-neutral visual content brief for the central scene only. Describe subject, setting, action, props, and emotion. Do not bake in a visual style such as comic, animation, photorealistic, iPhone photo, illustration, manga, or cartoon unless the user explicitly requested it. The media-image block applies the selected visual style later. Final title/subtitle overlays are added by the video compositor, but short in-scene Korean/English signage or document text is allowed when it clarifies the scene.
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
  "style": { "format": "vertical-shorts", "aspectRatio": "9:16", "sceneCount": 12, "visualGrammar": {} },
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

const LONGFORM_GATE_A_SYSTEM_PROMPT = `You are a Korean longform YouTube production planner inside a general workflow automation engine.
Create longform planning artifacts for user review before any paid media execution.

Requirements:
- Do not create a Shorts scene contract.
- Do not request image generation, TTS generation, HyperFrames render, MP4 render, or final upload metadata.
- Produce source digest, outline, full script draft, scene plan, estimated duration, estimated cost, renderer route, and QA checklist.
- Preserve targetDurationSec/maxDurationSec from the node config when present.
- Keep rendererRoute as "hyperframes" unless the user explicitly asks for another renderer.
- estimatedCost is planning cost only. Paid media/render cost must not be included here.

Respond with JSON only — no markdown fences, no extra text:
{
  "sourceDigest": ["source takeaway"],
  "outline": [{ "title": "section title", "summary": "section summary" }],
  "fullScriptDraft": "complete Korean longform narration draft",
  "scenePlan": [{ "sceneNumber": 1, "title": "scene title", "visualPlan": "visual plan", "durationSec": 40 }],
  "estimatedDurationSec": 300,
  "estimatedCost": { "currency": "USD", "total": 0.2, "notes": ["Planning only"] },
  "rendererRoute": "hyperframes",
  "qaChecklist": ["source check", "script review", "scene approval"]
}`;

// ── Dummy (mock mode) ─────────────────────────────────────────────────────────

function dummyContent(): BlockExecutorResult {
    const start = Date.now();
    const output = {
        title: '[dummy] 핵심 요약 쇼츠',
        hook: '[dummy] 지금 이 이슈, 핵심만 보면?',
        scenes: [
            {
                sceneNumber: 1,
                caption: '[dummy] 먼저 배경',
                narration: '[dummy] 이 주제가 왜 나왔는지 배경부터 짚어봅니다.',
                imagePrompt: '[dummy] Clear Korean explainer scene, person reading article on laptop',
                visualText: '[dummy] 먼저 배경',
                sourceRefs: ['source-1'],
                durationSec: 6,
            },
            {
                sceneNumber: 2,
                caption: '[dummy] 핵심 주장',
                narration: '[dummy] 원문에서 반복되는 핵심 주장만 분리합니다.',
                imagePrompt: '[dummy] Key points being organized on a board, Korean information channel style',
                visualText: '[dummy] 핵심 주장',
                sourceRefs: ['source-1'],
                durationSec: 6,
            },
            {
                sceneNumber: 3,
                caption: '[dummy] 왜 중요하냐',
                narration: '[dummy] 이 변화가 실제 사용자에게 주는 영향을 봅니다.',
                imagePrompt: '[dummy] People comparing before and after outcomes in a clear explainer scene',
                visualText: '[dummy] 왜 중요하냐',
                sourceRefs: ['source-2'],
                durationSec: 6,
            },
            {
                sceneNumber: 4,
                caption: '[dummy] 주의할 점',
                narration: '[dummy] 확인되지 않은 내용은 단정하지 않고 따로 표시합니다.',
                imagePrompt: '[dummy] Caution sign beside a fact-check checklist in a clean explainer scene',
                visualText: '[dummy] 주의할 점',
                sourceRefs: ['source-2'],
                durationSec: 6,
            },
            {
                sceneNumber: 5,
                caption: '[dummy] 한 줄 결론',
                narration: '[dummy] 마지막에는 사용자가 바로 이해할 결론을 남깁니다.',
                imagePrompt:
                    '[dummy] Final takeaway card visual with concise in-scene text allowed, bold Korean shorts style',
                visualText: '[dummy] 한 줄 결론',
                sourceRefs: ['source-1'],
                durationSec: 6,
            },
        ],
        cta: '[dummy] 더 깊은 내용은 원문을 확인하세요.',
        totalDurationSec: 30,
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
        presetId: 'generic-shorts',
    };
    return { output, durationMs: Date.now() - start };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a descriptive user message from the search block's output (or any input).
 */
function buildUserMessage(input: unknown): string {
    if (input == null) return '주제: 사용자가 요청한 콘텐츠';

    if (typeof input === 'object' && !Array.isArray(input)) {
        const obj = input as Record<string, unknown>;
        const parts: string[] = [];

        if (Array.isArray(obj['keywords']) && (obj['keywords'] as unknown[]).length > 0) {
            parts.push(`키워드: ${(obj['keywords'] as unknown[]).map(k => String(k)).join(', ')}`);
        }

        if (Array.isArray(obj['articles']) && (obj['articles'] as unknown[]).length > 0) {
            const articles = obj['articles'] as Record<string, unknown>[];
            const primarySources = articles
                .filter(article => article['primarySource'] === true)
                .sort((a, b) => Number(a['sourcePriority'] ?? 999) - Number(b['sourcePriority'] ?? 999))
                .slice(0, 3);
            if (primarySources.length > 0) {
                parts.push(
                    [
                        'PRIMARY SOURCES',
                        ...primarySources.map(primary =>
                            [
                                `PRIMARY SOURCE primarySource=true sourcePriority=${String(primary['sourcePriority'] ?? 1)}`,
                                `Title: ${String(primary['title'] ?? '')}`,
                                `URL: ${String(primary['url'] ?? '')}`,
                                `PublishedAt: ${String(primary['publishedAt'] ?? 'date unknown')}`,
                                `KeyClaims: ${Array.isArray(primary['keyClaims']) ? primary['keyClaims'].map(String).join(' / ') : ''}`,
                                `FullText: ${String(primary['fullText'] ?? primary['summary'] ?? '').slice(0, 3000)}`,
                            ].join('\n')
                        ),
                    ].join('\n\n')
                );
            }

            const summaries = articles
                .slice(0, 3)
                .map(a => {
                    const sourceFlags = [
                        a['primarySource'] === true ? 'primarySource=true' : 'primarySource=false',
                        `sourcePriority=${String(a['sourcePriority'] ?? 'unknown')}`,
                    ].join(', ');
                    return `- ${String(a['id'] ?? '')} ${String(a['title'] ?? '')} (${String(a['source'] ?? '')}, ${String(a['publishedAt'] ?? 'date unknown')}, ${String(a['sourceType'] ?? 'other')}, confidence=${String(a['confidence'] ?? 'unknown')}, ${sourceFlags})\n  URL: ${String(a['url'] ?? '')}\n  Summary: ${String(a['summary'] ?? '')}`;
                })
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
        const longformGateAMode = isLongformGateAMode(input, config);
        const reviewedOutput = parseReviewedOutput(config?.['reviewedOutput']);
        if (reviewedOutput) {
            if (longformGateAMode) {
                const normalized = normalizeLongformGateAOutput(reviewedOutput, input, config);
                log.info('[content-block] Using reviewed longform Gate A output');
                return { output: normalized, durationMs: Date.now() - start };
            }
            const normalized = normalizeContentOutput(reviewedOutput, input, rulepack.id);
            const validated = ContentOutputSchema.safeParse(normalized);
            if (!validated.success) {
                throw new Error(`[content-block] Reviewed output schema validation failed: ${validated.error.message}`);
            }
            log.info('[content-block] Using reviewed script output', {
                sceneCount: validated.data.scenes.length,
            });
            return { output: validated.data as Record<string, unknown>, durationMs: Date.now() - start };
        }

        const singleImageMode = isSingleImageMode(input, config);
        const genericTextMode = isGenericTextMode(input, config);

        log.info('[content-block] Starting AI script generation', {
            messageLength: userMessage.length,
            presetId: rulepack.id,
            mode: longformGateAMode
                ? 'longform-gate-a'
                : singleImageMode
                  ? 'single-image'
                  : genericTextMode
                    ? 'text'
                    : 'shorts',
        });

        const directorPrompt = `${SCRIPT_WRITER_RULES}\n\n${SCRIPT_OUTPUT_RULES}\n\n${SHORTS_DIRECTOR_RULES}\n\n${DIRECTOR_OUTPUT_RULES}`;
        const contentPreferencePrompt = buildContentPreferencePrompt(config);
        const scriptTonePrompt = buildScriptTonePrompt(config);
        const response = await openaiAdapter.chatJson({
            model: env.openaiModel,
            systemPrompt: longformGateAMode
                ? `${LONGFORM_GATE_A_SYSTEM_PROMPT}\n\n${contentPreferencePrompt}\n\n${scriptTonePrompt}`
                : singleImageMode
                  ? `${SINGLE_IMAGE_SYSTEM_PROMPT}\n\n${contentPreferencePrompt}\n\n${directorPrompt}\n\n${rulepack.imagePrompt}`
                  : genericTextMode
                    ? `${GENERIC_TEXT_SYSTEM_PROMPT}\n\n${contentPreferencePrompt}`
                    : `${CONTENT_SYSTEM_PROMPT}\n\n${buildCombinedPrompt(rulepack, 'contentPrompt')}\n\n${scriptTonePrompt}\n\n${directorPrompt}\n\n${rulepack.sourcePolicy}`,
            userMessage,
            maxTokens: 4096,
        });

        let parsed: unknown;
        try {
            parsed = JSON.parse(response.content);
        } catch {
            throw new Error(`[content-block] OpenAI returned non-JSON response (length=${response.content.length})`);
        }

        if (longformGateAMode) {
            const normalizedLongform = normalizeLongformGateAOutput(parsed, input, config);
            log.info('[content-block] Longform Gate A generation complete', {
                estimatedDurationSec: normalizedLongform['estimatedDurationSec'],
                rendererRoute: normalizedLongform['rendererRoute'],
                latencyMs: response.latencyMs,
            });
            return { output: normalizedLongform, durationMs: Date.now() - start };
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

function parseReviewedOutput(input: unknown): unknown | null {
    if (!input) return null;
    if (typeof input === 'object' && !Array.isArray(input)) return input;
    if (typeof input !== 'string' || input.trim().length === 0) return null;
    try {
        const parsed = JSON.parse(input);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
        throw new Error('[content-block] reviewedOutput must be valid JSON');
    }
}

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

function isLongformGateAMode(input: unknown, config?: Record<string, unknown>): boolean {
    const values: unknown[] = [config?.['mode'], config?.['gate'], config?.['contentProfileId']];
    if (input && typeof input === 'object' && !Array.isArray(input)) {
        const obj = input as Record<string, unknown>;
        values.push(obj['mode'], obj['gate'], obj['contentProfileId']);
    }
    const modeText = values
        .filter((value): value is string => typeof value === 'string')
        .join(' ')
        .toLowerCase();
    return modeText.includes('longform-gate-a') || modeText.includes('longform.');
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

function normalizeLongformGateAOutput(
    parsed: unknown,
    input: unknown,
    config?: Record<string, unknown>
): Record<string, unknown> {
    const obj = isRecord(parsed) ? parsed : {};
    const scenePlan = Array.isArray(obj['scenePlan']) ? obj['scenePlan'] : [];
    const generatedDurationSec =
        readPositiveNumber(obj['estimatedDurationSec']) ??
        scenePlan.reduce((sum, scene) => {
            const durationSec = isRecord(scene) ? readPositiveNumber(scene['durationSec']) : undefined;
            return sum + (durationSec ?? 40);
        }, 0) ??
        300;
    const configuredTargetDurationSec = readPositiveNumber(config?.['targetDurationSec']);
    const configuredMaxDurationSec = readPositiveNumber(config?.['maxDurationSec']);
    const requestedDurationSec = configuredTargetDurationSec ?? generatedDurationSec;
    const estimatedDurationSec = configuredMaxDurationSec
        ? Math.min(requestedDurationSec, configuredMaxDurationSec)
        : requestedDurationSec;
    const rendererRoute =
        typeof obj['rendererRoute'] === 'string'
            ? obj['rendererRoute']
            : typeof config?.['rendererRoute'] === 'string'
              ? config['rendererRoute']
              : 'hyperframes';
    const estimatedCost = isRecord(obj['estimatedCost'])
        ? obj['estimatedCost']
        : { currency: 'USD', total: 0.16, notes: ['Planning only'] };

    return {
        ...obj,
        gate: 'A',
        mode: 'longform-gate-a',
        sourceDigest: Array.isArray(obj['sourceDigest']) ? obj['sourceDigest'] : buildSourceDigest(input),
        outline: Array.isArray(obj['outline']) ? obj['outline'] : [],
        fullScriptDraft:
            typeof obj['fullScriptDraft'] === 'string'
                ? obj['fullScriptDraft']
                : typeof obj['scriptDraft'] === 'string'
                  ? obj['scriptDraft']
                  : '',
        scenePlan,
        estimatedDurationSec: estimatedDurationSec || 300,
        ...(configuredMaxDurationSec ? { maxDurationSec: configuredMaxDurationSec } : {}),
        estimatedCost,
        rendererRoute,
        qaChecklist: Array.isArray(obj['qaChecklist']) ? obj['qaChecklist'] : ['출처 확인', '대본 검수', '씬 승인'],
        mediaExecutionAllowed: false,
        sources: Array.isArray(obj['sources']) && obj['sources'].length > 0 ? obj['sources'] : extractSources(input),
    };
}

function buildSourceDigest(input: unknown): string[] {
    return extractSources(input)
        .slice(0, 5)
        .map(source => [source['title'], source['summary']].filter(Boolean).join(': '))
        .filter(text => text.trim().length > 0);
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
        format: typeof style['format'] === 'string' ? style['format'] : 'vertical-shorts',
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

function readPositiveNumber(input: unknown): number | undefined {
    const value = Number(input);
    return Number.isFinite(value) && value > 0 ? value : undefined;
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
        fullText: article['fullText'],
        keyClaims: article['keyClaims'],
        primarySource: article['primarySource'],
        sourcePriority: article['sourcePriority'],
    }));
}
