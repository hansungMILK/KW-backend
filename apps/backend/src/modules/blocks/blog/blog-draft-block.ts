import { z } from 'zod';

import { FactSchema } from './blog-contract';
import { extractTopic, isRecord, parseJsonLike, stringArray, text } from './blog-shared';
import { openaiAdapter } from '../../../adapters/ai/openai-adapter';
import { env } from '../../../config/env';

import type { BlockExecutor, BlockExecutorResult } from '../types';

/**
 * blog-draft — LLM. Drafts the body section-by-section from the (selected) outline.
 * Never a single one-shot article: each outline section is written separately so the
 * structure survives. Facts may only be cited from upstream brief/search; otherwise
 * the writer generalizes (anti-hallucination).
 */
const DraftSectionSchema = z.object({
    id: z.string(),
    level: z.union([z.literal(2), z.literal(3)]),
    heading: z.string(),
    paragraphs: z.array(z.string()).min(1),
});

export const BlogDraftOutputSchema = z.object({
    mode: z.literal('blog-draft'),
    topic: z.string(),
    title: z.string(),
    sections: z.array(DraftSectionSchema).min(1),
    // Re-emit grounding so blog-image-plan/blog-assemble can carry facts to the document.
    facts: z.array(FactSchema).default([]),
    articles: z.array(z.record(z.string(), z.unknown())).default([]),
});
export type BlogDraftOutput = z.infer<typeof BlogDraftOutputSchema>;

export const BLOG_DRAFT_SYSTEM_PROMPT = `You are a Korean blog body writer. You are given one section heading and summary at a time.
Write the body for ONLY that section as 1–3 natural Korean paragraphs.

Rules:
- Stay on this section's topic; do not write other sections.
- Use a clear, readable blog tone.
- Only cite a concrete fact (number, date, quote, place) if it is present in the provided facts/sources.
  If a needed fact is missing, generalize instead of inventing it.

Return JSON only: { "paragraphs": ["para 1", "para 2"] }`;

interface OutlineSection {
    id: string;
    level: 2 | 3;
    heading: string;
    summary: string;
}

export const blogDraftBlock: BlockExecutor = {
    blockType: 'blog-draft',

    async execute(input: unknown, config?: Record<string, unknown>): Promise<BlockExecutorResult> {
        const start = Date.now();
        const upstream = isRecord(input) ? input : {};
        const topic = extractTopic(input, config);
        const title = text(upstream['title'], `${topic} 완벽 정리`);
        const outlineSections = readOutlineSections(upstream, config);
        const facts = normalizeFacts(upstream['facts']);
        const articles = Array.isArray(upstream['articles']) ? upstream['articles'].filter(isRecord) : [];

        if (env.orchestratorMode === 'mock') {
            const sections = outlineSections.map(section => ({
                id: section.id,
                level: section.level,
                heading: section.heading,
                paragraphs: buildFallbackParagraphs(section, topic),
            }));
            return { output: validate({ topic, title, sections, facts, articles }), durationMs: Date.now() - start };
        }

        const sections: BlogDraftOutput['sections'] = [];
        for (const section of outlineSections) {
            const response = await openaiAdapter.chatJson({
                model: env.openaiModel,
                systemPrompt: BLOG_DRAFT_SYSTEM_PROMPT,
                userMessage: buildSectionUserMessage(section, topic, facts, articles),
                maxTokens: env.openaiContentMaxTokens,
            });
            const parsed = parseJsonLike(response.content);
            const paragraphs = readParagraphs(parsed, section, topic);
            sections.push({ id: section.id, level: section.level, heading: section.heading, paragraphs });
        }

        return { output: validate({ topic, title, sections, facts, articles }), durationMs: Date.now() - start };
    },
};

function validate(candidate: {
    topic: string;
    title: string;
    sections: BlogDraftOutput['sections'];
    facts: BlogDraftOutput['facts'];
    articles: BlogDraftOutput['articles'];
}): BlogDraftOutput {
    const output: BlogDraftOutput = { mode: 'blog-draft', ...candidate };
    const validated = BlogDraftOutputSchema.safeParse(output);
    if (!validated.success) {
        throw new Error(`[blog-draft] Output schema validation failed: ${validated.error.message}`);
    }
    return validated.data;
}

function normalizeFacts(input: unknown): BlogDraftOutput['facts'] {
    if (!Array.isArray(input)) return [];
    return input.filter(isRecord).map(fact => {
        const source = text(fact['source'], 'missing');
        return {
            key: text(fact['key'], 'fact'),
            value: text(fact['value'], ''),
            source: (['user', 'search', 'derived', 'missing'] as const).includes(source as 'user')
                ? (source as BlogDraftOutput['facts'][number]['source'])
                : 'missing',
        };
    });
}

function buildSectionUserMessage(
    section: OutlineSection,
    topic: string,
    facts: unknown[],
    articles: unknown[]
): string {
    return [
        `BLOG TOPIC:\n${topic}`,
        `SECTION HEADING (H${section.level}):\n${section.heading}`,
        `SECTION SUMMARY:\n${section.summary}`,
        facts.length > 0 ? `GROUNDED FACTS:\n${JSON.stringify(facts).slice(0, 3000)}` : 'GROUNDED FACTS: none',
        articles.length > 0 ? `SOURCES:\n${JSON.stringify(articles).slice(0, 3000)}` : undefined,
        'Write only this section. Korean. Do not invent facts.',
    ]
        .filter(Boolean)
        .join('\n\n');
}

function readOutlineSections(upstream: Record<string, unknown>, config?: Record<string, unknown>): OutlineSection[] {
    const raw =
        (Array.isArray(upstream['sections']) ? upstream['sections'] : undefined) ??
        (config && Array.isArray(config['sections']) ? config['sections'] : undefined) ??
        [];
    const sections = raw.filter(isRecord).map((section, index): OutlineSection => {
        const level: 2 | 3 = section['level'] === 3 ? 3 : 2;
        const heading = text(section['heading'], `핵심 ${index + 1}`);
        return {
            id: text(section['id']) || `h2-${index + 1}`,
            level,
            heading,
            summary: text(section['summary'], `${heading}에 대해 설명한다.`),
        };
    });
    if (sections.length > 0) return sections;
    return [{ id: 'h2-1', level: 2, heading: '핵심 정리', summary: '주제의 핵심을 정리한다.' }];
}

function readParagraphs(parsed: unknown, section: OutlineSection, topic: string): string[] {
    const root = isRecord(parsed) ? parsed : {};
    const paragraphs = stringArray(root['paragraphs']);
    return paragraphs.length > 0 ? paragraphs : buildFallbackParagraphs(section, topic);
}

function buildFallbackParagraphs(section: OutlineSection, topic: string): string[] {
    return [
        `${section.heading}에 대해 살펴보겠습니다. ${section.summary}`,
        `${topic}을(를) 처음 접하는 독자라면 이 부분을 먼저 이해하는 것이 도움이 됩니다.`,
    ];
}
