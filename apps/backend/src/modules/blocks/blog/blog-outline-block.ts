import { z } from 'zod';

import { FactSchema } from './blog-contract';
import { extractTopic, isRecord, parseJsonLike, slugify, text } from './blog-shared';
import { openaiAdapter } from '../../../adapters/ai/openai-adapter';
import { env } from '../../../config/env';

import type { BlockExecutor, BlockExecutorResult } from '../types';

/**
 * blog-outline — LLM. Produces H1 + 8–10 H2 (+ optional H3) with per-section length guidance.
 *
 * Selection checkpoint (mirrors countryball-angle-lab, NOT a generalized mechanism):
 * when run interactively without a chosen outline (config.selectedOutline absent and no
 * selectedSections snapshot), the run stops here so the user can edit the table of contents.
 * Once `selectedOutline`/`selectedSections` is seeded into config, the block emits the
 * selected outline and the run continues downstream.
 */
const OutlineSectionSchema = z.object({
    id: z.string(),
    level: z.union([z.literal(2), z.literal(3)]),
    heading: z.string(),
    summary: z.string(),
    targetWords: z.number().int().min(1),
});

export const BlogOutlineOutputSchema = z.object({
    mode: z.literal('blog-outline'),
    topic: z.string(),
    title: z.string(),
    sections: z.array(OutlineSectionSchema).min(1),
    outlineSelectionStatus: z.enum(['pending', 'selected']),
    selectionPrompt: z.string().optional(),
    // Threaded through so anti-hallucination grounding survives the chain
    // (z.object strips unknown keys, so facts/articles must be declared here).
    facts: z.array(FactSchema).default([]),
    articles: z.array(z.record(z.string(), z.unknown())).default([]),
});
export type BlogOutlineOutput = z.infer<typeof BlogOutlineOutputSchema>;

export const BLOG_OUTLINE_SYSTEM_PROMPT = `You are a Korean blog outline architect. Outline-first writing — do NOT write the article body.
Given a brief, produce one H1 title plus 8 to 10 H2 sections (add H3 sub-sections only where a section
genuinely needs them). For each section give a one-line summary and a target word count.

Rules:
- 8–10 H2 sections. Cover the topic completely without filler.
- Headings must be concrete and scannable, not vague labels.
- Do not invent facts here; the outline only sets structure.

Match the STRUCTURE to the topic — judge what THIS topic and reader need. The structure should
fall out of the topic's own shape, not a fixed template. These are illustrations of that judgment,
NOT a menu to pick from:
- A topic weighing multiple options reads best as: each option introduced, then compared on the SAME
  criteria the reader cares about, a quick head-to-head summary, then a clear situational takeaway.
- A "how to / 방법" topic reads best as ordered steps, plus prerequisites up front and common mistakes.
- A single-thing review reads best as overview → strengths → limits → who it fits → alternatives.
- A concept/explainer reads best as what-it-is → why-it-matters → how → examples → FAQ → summary.
Infer the right shape yourself; blend or depart from these as the specific topic warrants.

Return JSON only:
{
  "title": "H1 title",
  "sections": [
    { "level": 2, "heading": "H2 heading", "summary": "what this covers", "targetWords": 180 },
    { "level": 3, "heading": "H3 sub-heading", "summary": "...", "targetWords": 90 }
  ]
}`;

export const blogOutlineBlock: BlockExecutor = {
    blockType: 'blog-outline',

    async execute(input: unknown, config?: Record<string, unknown>): Promise<BlockExecutorResult> {
        const start = Date.now();
        const topic = extractTopic(input, config);
        const currentConfig = config ?? {};

        const grounding = readGrounding(input);

        // Checkpoint resume: a seeded selection short-circuits the LLM and marks the
        // outline selected so downstream blocks run.
        if (hasSelectedOutlineSnapshot(currentConfig)) {
            const output = { ...buildSelectedOutline(currentConfig, topic), ...grounding };
            const validated = BlogOutlineOutputSchema.safeParse(output);
            if (!validated.success) {
                throw new Error(`[blog-outline] Selected outline snapshot is invalid: ${validated.error.message}`);
            }
            return { output: validated.data, durationMs: Date.now() - start };
        }

        if (env.orchestratorMode === 'mock') {
            const output = { ...normalizeOutline(buildFallbackOutline(topic), topic), ...grounding };
            return { output, durationMs: Date.now() - start };
        }

        const response = await openaiAdapter.chatJson({
            model: env.openaiWritingModel,
            systemPrompt: BLOG_OUTLINE_SYSTEM_PROMPT,
            userMessage: buildOutlineUserMessage(topic, input),
            maxTokens: env.openaiContentMaxTokens,
        });
        const parsed = parseJsonLike(response.content);
        const output = { ...normalizeOutline(parsed, topic), ...grounding };
        const validated = BlogOutlineOutputSchema.safeParse(output);
        if (!validated.success) {
            throw new Error(`[blog-outline] Output schema validation failed: ${validated.error.message}`);
        }
        return { output: validated.data, durationMs: Date.now() - start };
    },
};

function buildOutlineUserMessage(topic: string, input: unknown): string {
    const brief = isRecord(input) ? input : {};
    return [
        `BLOG TOPIC:\n${topic}`,
        `BRIEF:\n${JSON.stringify(
            {
                keyword: brief['keyword'],
                audience: brief['audience'],
                intent: brief['intent'],
                angle: brief['angle'],
                facts: brief['facts'],
            },
            null,
            2
        ).slice(0, 4000)}`,
        'Infer the structure that best fits this topic and reader, then produce an 8–10 H2 outline. Korean headings. Do not write the body.',
    ].join('\n\n');
}

function normalizeOutline(parsed: unknown, topic: string): BlogOutlineOutput {
    const root = isRecord(parsed) ? parsed : {};
    const rawSections = Array.isArray(root['sections']) ? root['sections'].filter(isRecord) : [];
    const fallback = buildFallbackOutline(topic);
    const source = rawSections.length > 0 ? rawSections : (fallback.sections as Record<string, unknown>[]);
    const sections = source.map((section, index) => normalizeSection(section, index, topic));

    return {
        mode: 'blog-outline',
        topic,
        title: text(root['title'], `${topic} 완벽 정리`),
        sections,
        outlineSelectionStatus: 'pending',
        selectionPrompt: text(root['selectionPrompt'], '아래 목차를 확인하고 필요하면 수정한 뒤 진행해주세요.'),
        facts: [],
        articles: [],
    };
}

/** Carry brief facts and search articles through the outline so grounding survives the chain. */
function readGrounding(input: unknown): { facts: BlogOutlineOutput['facts']; articles: BlogOutlineOutput['articles'] } {
    const upstream = isRecord(input) ? input : {};
    const facts = (Array.isArray(upstream['facts']) ? upstream['facts'].filter(isRecord) : []).map(fact => {
        const source = text(fact['source'], 'missing');
        return {
            key: text(fact['key'], 'fact'),
            value: text(fact['value'], ''),
            source: (['user', 'search', 'derived', 'missing'] as const).includes(source as 'user')
                ? (source as BlogOutlineOutput['facts'][number]['source'])
                : 'missing',
        };
    });
    const articles = Array.isArray(upstream['articles']) ? upstream['articles'].filter(isRecord) : [];
    return { facts, articles };
}

function normalizeSection(
    section: Record<string, unknown>,
    index: number,
    topic: string
): BlogOutlineOutput['sections'][number] {
    const levelRaw = section['level'];
    const level: 2 | 3 = levelRaw === 3 ? 3 : 2;
    const heading = text(section['heading'], `${topic} 핵심 ${index + 1}`);
    const targetWordsRaw = section['targetWords'];
    const targetWords =
        typeof targetWordsRaw === 'number' && Number.isFinite(targetWordsRaw) && targetWordsRaw > 0
            ? Math.floor(targetWordsRaw)
            : 160;
    return {
        id: text(section['id']) || slugify(heading, index),
        level,
        heading,
        summary: text(section['summary'], `${heading}에 대해 설명한다.`),
        targetWords,
    };
}

/** Build the selected-outline output from a seeded config snapshot. */
function buildSelectedOutline(config: Record<string, unknown>, topic: string): BlogOutlineOutput {
    const seededSections = readSeededSections(config);
    const sections =
        seededSections.length > 0
            ? seededSections
            : (buildFallbackOutline(topic).sections as Record<string, unknown>[]).map((s, i) =>
                  normalizeSection(s, i, topic)
              );
    const selectedOutline = isRecord(config['selectedOutline']) ? config['selectedOutline'] : undefined;
    const title =
        text(config['selectedTitle']) ||
        (selectedOutline ? text(selectedOutline['title']) : '') ||
        text(config['title']) ||
        `${topic} 완벽 정리`;
    return {
        mode: 'blog-outline',
        topic,
        title,
        sections,
        outlineSelectionStatus: 'selected',
        facts: [],
        articles: [],
    };
}

function readSeededSections(config: Record<string, unknown>): BlogOutlineOutput['sections'] {
    const selected = config['selectedOutline'];
    const fromSelectedOutline =
        isRecord(selected) && Array.isArray(selected['sections']) ? selected['sections'] : undefined;
    const raw = fromSelectedOutline ?? config['selectedSections'] ?? config['sections'];
    if (!Array.isArray(raw)) return [];
    return raw
        .filter(isRecord)
        .map((section, index) => normalizeSection(section, index, text(config['topic'], '블로그 글')));
}

function hasSelectedOutlineSnapshot(config: Record<string, unknown>): boolean {
    if (config['outlineSelectionStatus'] === 'selected') return true;
    if (isRecord(config['selectedOutline'])) return true;
    if (Array.isArray(config['selectedSections']) && config['selectedSections'].length > 0) return true;
    return false;
}

function buildFallbackOutline(topic: string): { title: string; sections: Record<string, unknown>[] } {
    const headings = [
        `${topic}이란? 한눈에 보는 핵심`,
        `${topic}이 중요한 이유`,
        `${topic} 기본 개념 정리`,
        `${topic} 시작하는 방법`,
        `${topic} 단계별 실행 가이드`,
        `${topic}에서 자주 하는 실수`,
        `${topic} 활용 팁과 사례`,
        `${topic} 체크리스트`,
        `${topic} 자주 묻는 질문`,
        `마무리: ${topic} 핵심 요약`,
    ];
    return {
        title: `${topic} 완벽 정리`,
        sections: headings.map(heading => ({
            level: 2,
            heading,
            summary: `${heading}에 대해 설명한다.`,
            targetWords: 160,
        })),
    };
}
