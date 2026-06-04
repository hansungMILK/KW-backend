import { extractTopic, isRecord, text } from './blog-shared';
import { searchBlock } from '../search-block';

import type { BlockExecutor, BlockExecutorContext, BlockExecutorResult } from '../types';

/**
 * blog-research — for factual topics, delegates to the existing `search` block (config reuse,
 * search block itself is NOT modified). For non-factual topics it passes the brief through
 * unchanged. Search results are merged onto the upstream payload so blog-outline/draft can
 * cite them; brief facts with source:'search' become groundable.
 *
 * When the brief's model planned multiple searches (searchQueries — e.g. each side of a
 * comparison, each item in a roundup), each runs separately and the results are merged so every
 * distinct subtopic gets grounded, not just one combined phrase. One query is the common case.
 * The block stays content-type-agnostic: the model decides the queries, the block just runs them.
 * Capped at 5 queries.
 */
export const blogResearchBlock: BlockExecutor = {
    blockType: 'blog-research',

    async execute(
        input: unknown,
        config?: Record<string, unknown>,
        context?: BlockExecutorContext
    ): Promise<BlockExecutorResult> {
        const start = Date.now();
        const upstream = isRecord(input) ? input : {};
        const topic = extractTopic(input, config);

        const isFactual =
            typeof config?.['isFactual'] === 'boolean'
                ? (config['isFactual'] as boolean)
                : typeof upstream['isFactual'] === 'boolean'
                  ? (upstream['isFactual'] as boolean)
                  : false;

        // Non-factual ⇒ no external sourcing; pass the brief through.
        if (!isFactual) {
            return {
                output: { ...upstream, mode: 'blog-research', researchPerformed: false, articles: [] },
                durationMs: Date.now() - start,
            };
        }

        // The brief's model decided which searches ground this article (searchQueries) — no
        // hardcoded content-type branch. Several queries (e.g. each side of a comparison, each
        // item in a roundup) are run and merged; one query is the common case. Capped to bound cost.
        const plannedQueries = (Array.isArray(upstream['searchQueries']) ? upstream['searchQueries'] : [])
            .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
            .map(q => q.trim());

        if (plannedQueries.length > 1) {
            const queries = plannedQueries.slice(0, 5);
            const outputs = [];
            for (const q of queries) {
                const r = await searchBlock.execute(input, { ...config, query: q }, context);
                outputs.push(isRecord(r.output) ? r.output : {});
            }
            const articles = dedupeArticles(
                outputs.flatMap(o => (Array.isArray(o['articles']) ? o['articles'].filter(isRecord) : []))
            );
            const mergedText = outputs
                .map(o => text(o['text']))
                .filter(Boolean)
                .join('\n\n');
            return {
                output: {
                    ...upstream,
                    mode: 'blog-research',
                    researchPerformed: true,
                    researchQueries: queries,
                    articles,
                    ...(mergedText ? { text: mergedText } : {}),
                },
                durationMs: Date.now() - start,
            };
        }

        const query = plannedQueries[0] ?? (text(config?.['query'], topic) || topic);
        const searchResult = await searchBlock.execute(input, { ...config, query }, context);
        const searchOutput = isRecord(searchResult.output) ? searchResult.output : {};

        return {
            output: {
                ...upstream,
                ...searchOutput,
                mode: 'blog-research',
                researchPerformed: true,
            },
            durationMs: Date.now() - start,
            ...(searchResult.assets ? { assets: searchResult.assets } : {}),
        };
    },
};

/** Dedupe articles merged from multiple searches by url, then by title. Order-preserving. */
function dedupeArticles(articles: Record<string, unknown>[]): Record<string, unknown>[] {
    const seen = new Set<string>();
    const result: Record<string, unknown>[] = [];
    for (const article of articles) {
        const key = (text(article['url']) || text(article['title']) || '').trim().toLowerCase();
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        result.push(article);
    }
    return result;
}
