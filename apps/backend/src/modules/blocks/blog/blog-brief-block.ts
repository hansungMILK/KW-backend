import { z } from 'zod';

import { FactSchema } from './blog-contract';
import { extractTopic, isRecord, parseJsonLike, stringArray, text } from './blog-shared';
import { openaiAdapter } from '../../../adapters/ai/openai-adapter';
import { env } from '../../../config/env';

import type { BlockExecutor, BlockExecutorResult } from '../types';

/**
 * blog-brief — LLM. Establishes keyword / audience / intent / angle and grounds
 * facts with explicit source tags (anti-hallucination: no source ⇒ source:'missing').
 */
export const BlogBriefOutputSchema = z.object({
    mode: z.literal('blog-brief'),
    topic: z.string(),
    keyword: z.string(),
    secondaryKeywords: z.array(z.string()),
    audience: z.string(),
    intent: z.enum(['informational', 'commercial', 'navigational', 'transactional', 'unknown']),
    angle: z.string(),
    isFactual: z.boolean(),
    /**
     * The searches needed to ground THIS article, decided by the model — not by a hardcoded
     * content-type switch. One query for a simple topic; several for multi-faceted or multi-entity
     * topics (e.g. each side of a comparison, each tool in a roundup). blog-research runs them all.
     */
    searchQueries: z.array(z.string()).default([]),
    facts: z.array(FactSchema),
});
export type BlogBriefOutput = z.infer<typeof BlogBriefOutputSchema>;

export const BLOG_BRIEF_SYSTEM_PROMPT = `You are a Korean blog writing strategist.
Given a topic, produce a compact brief that a writer can act on. Decide the primary keyword,
secondary keywords, the target reader, the search intent, and a clear angle.

Anti-hallucination rule (critical):
- Only state a concrete fact (statistic, quote, date, place, named figure) when it appears in the
  user request or provided sources. Tag each fact with its source: "user" or "search".
- If you believe a fact is needed but you cannot ground it, record it with source "missing" and a
  generalized value — never invent specifics.
- Set isFactual=true when the topic depends on real-world facts that need sourcing.

Search planning (you decide — no fixed categories):
- When isFactual=true, list the web searches needed to GROUND this specific article in searchQueries.
- Use ONE query for a simple single-subject topic. Use SEPARATE queries when the topic spans
  multiple distinct things that each need their own sourcing — e.g. each side of a comparison, each
  item in a roundup, each phase of a process. Judge what THIS topic needs; do not force a count.
- Each query should be a concrete, search-engine-ready phrase. When isFactual=false, return [].

Return JSON only:
{
  "keyword": "primary keyword",
  "secondaryKeywords": ["..."],
  "audience": "who reads this",
  "intent": "informational|commercial|navigational|transactional",
  "angle": "the writer's unique angle in one sentence",
  "isFactual": true,
  "searchQueries": ["search phrase 1", "search phrase 2 (only if the topic genuinely needs it)"],
  "facts": [{ "key": "fact name", "value": "fact value or generalization", "source": "user|search|missing" }]
}`;

export const blogBriefBlock: BlockExecutor = {
    blockType: 'blog-brief',

    async execute(input: unknown, config?: Record<string, unknown>): Promise<BlockExecutorResult> {
        const start = Date.now();
        const topic = extractTopic(input, config);

        if (env.orchestratorMode === 'mock') {
            return { output: buildFallbackBrief(topic), durationMs: Date.now() - start };
        }

        const response = await openaiAdapter.chatJson({
            model: env.openaiWritingModel,
            systemPrompt: BLOG_BRIEF_SYSTEM_PROMPT,
            userMessage: `BLOG TOPIC:\n${topic}\n\nProduce the brief. Korean output. Ground every fact or mark it missing.`,
            maxTokens: env.openaiContentMaxTokens,
        });
        const parsed = parseJsonLike(response.content);
        const output = normalizeBrief(parsed, topic);
        const validated = BlogBriefOutputSchema.safeParse(output);
        if (!validated.success) {
            throw new Error(`[blog-brief] Output schema validation failed: ${validated.error.message}`);
        }
        return { output: validated.data, durationMs: Date.now() - start };
    },
};

function normalizeBrief(parsed: unknown, topic: string): BlogBriefOutput {
    const root = isRecord(parsed) ? parsed : {};
    const intentRaw = text(root['intent'], 'informational');
    const intent = (['informational', 'commercial', 'navigational', 'transactional'] as const).includes(
        intentRaw as 'informational'
    )
        ? (intentRaw as BlogBriefOutput['intent'])
        : 'informational';
    return {
        mode: 'blog-brief',
        topic,
        keyword: text(root['keyword'], topic),
        secondaryKeywords: stringArray(root['secondaryKeywords']),
        audience: text(root['audience'], '이 주제를 처음 접하는 일반 독자'),
        intent,
        angle: text(root['angle'], `${topic}을(를) 쉽고 실용적으로 정리한다.`),
        isFactual: typeof root['isFactual'] === 'boolean' ? root['isFactual'] : true,
        searchQueries: stringArray(root['searchQueries']),
        facts: normalizeFacts(root['facts']),
    };
}

function normalizeFacts(input: unknown): BlogBriefOutput['facts'] {
    if (!Array.isArray(input)) return [];
    return input.filter(isRecord).map(item => {
        const source = text(item['source'], 'missing');
        return {
            key: text(item['key'], 'fact'),
            value: text(item['value'], ''),
            source: (['user', 'search', 'derived', 'missing'] as const).includes(source as 'user')
                ? (source as BlogBriefOutput['facts'][number]['source'])
                : 'missing',
        };
    });
}

function buildFallbackBrief(topic: string): BlogBriefOutput {
    return {
        mode: 'blog-brief',
        topic,
        keyword: topic,
        secondaryKeywords: [`${topic} 방법`, `${topic} 정리`],
        audience: '이 주제를 처음 접하는 일반 독자',
        intent: 'informational',
        angle: `${topic}을(를) 핵심만 골라 실용적으로 정리한다.`,
        isFactual: false,
        searchQueries: [],
        facts: [],
    };
}
