import { z } from 'zod';

import { BlogSeoSchema } from './blog-contract';
import { extractTopic, isRecord, parseJsonLike, stringArray, text } from './blog-shared';
import { openaiAdapter } from '../../../adapters/ai/openai-adapter';
import { env } from '../../../config/env';

import type { BlockExecutor, BlockExecutorResult } from '../types';

/**
 * blog-seo — produces meta title/description/keywords plus a short structure/AEO summary.
 * Falls back deterministically in mock mode and on parse failure.
 */
export const BlogSeoOutputSchema = z.object({
    mode: z.literal('blog-seo'),
    topic: z.string(),
    seo: BlogSeoSchema,
    aeoSummary: z.string(),
});
export type BlogSeoOutput = z.infer<typeof BlogSeoOutputSchema>;

export const BLOG_SEO_SYSTEM_PROMPT = `You are a Korean SEO/AEO editor. Given a blog title and outline, write:
- a meta title (<= 60 chars), a meta description (<= 155 chars), and 5–8 keywords,
- a one-paragraph AEO answer summary (a concise direct answer an AI assistant could quote).

Return JSON only: { "title": "...", "description": "...", "keywords": ["..."], "aeoSummary": "..." }`;

export const blogSeoBlock: BlockExecutor = {
    blockType: 'blog-seo',

    async execute(input: unknown, config?: Record<string, unknown>): Promise<BlockExecutorResult> {
        const start = Date.now();
        const upstream = isRecord(input) ? input : {};
        const topic = extractTopic(input, config);
        const title = text(upstream['title'], `${topic} 완벽 정리`);
        const keyword = text(upstream['keyword'], topic);
        const sections = Array.isArray(upstream['sections']) ? upstream['sections'].filter(isRecord) : [];

        if (env.orchestratorMode === 'mock') {
            return {
                output: passthrough(upstream, buildFallback(topic, title, keyword)),
                durationMs: Date.now() - start,
            };
        }

        const response = await openaiAdapter.chatJson({
            model: env.openaiModel,
            systemPrompt: BLOG_SEO_SYSTEM_PROMPT,
            userMessage: [
                `TITLE:\n${title}`,
                `KEYWORD:\n${keyword}`,
                `OUTLINE:\n${JSON.stringify(sections.map(s => s['heading'])).slice(0, 2000)}`,
            ].join('\n\n'),
            maxTokens: env.openaiContentMaxTokens,
        });
        const parsed = parseJsonLike(response.content);
        const output = normalize(parsed, topic, title, keyword);
        return { output: passthrough(upstream, output), durationMs: Date.now() - start };
    },
};

function passthrough(upstream: Record<string, unknown>, output: BlogSeoOutput): Record<string, unknown> {
    const validated = BlogSeoOutputSchema.safeParse(output);
    if (!validated.success) {
        throw new Error(`[blog-seo] Output schema validation failed: ${validated.error.message}`);
    }
    return { ...upstream, ...validated.data };
}

function normalize(parsed: unknown, topic: string, title: string, keyword: string): BlogSeoOutput {
    const root = isRecord(parsed) ? parsed : {};
    const keywords = stringArray(root['keywords']);
    return {
        mode: 'blog-seo',
        topic,
        seo: {
            title: text(root['title'], title).slice(0, 60),
            description: text(root['description'], `${topic}에 대해 핵심만 정리한 가이드입니다.`).slice(0, 155),
            keywords: keywords.length > 0 ? keywords : [keyword, `${topic} 방법`, `${topic} 정리`],
        },
        aeoSummary: text(root['aeoSummary'], `${topic}은(는) ${keyword} 관점에서 핵심을 정리한 주제입니다.`),
    };
}

function buildFallback(topic: string, title: string, keyword: string): BlogSeoOutput {
    return {
        mode: 'blog-seo',
        topic,
        seo: {
            title: title.slice(0, 60),
            description: `${topic}에 대해 핵심만 정리한 가이드입니다.`.slice(0, 155),
            keywords: [keyword, `${topic} 방법`, `${topic} 정리`],
        },
        aeoSummary: `${topic}은(는) ${keyword} 관점에서 핵심을 정리한 주제입니다.`,
    };
}
