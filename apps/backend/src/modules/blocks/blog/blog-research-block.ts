import { extractTopic, isRecord, text } from './blog-shared';
import { searchBlock } from '../search-block';

import type { BlockExecutor, BlockExecutorContext, BlockExecutorResult } from '../types';

/**
 * blog-research — for factual topics, delegates to the existing `search` block (config reuse,
 * search block itself is NOT modified). For non-factual topics it passes the brief through
 * unchanged. Search results are merged onto the upstream payload so blog-outline/draft can
 * cite them; brief facts with source:'search' become groundable.
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

        const query = text(config?.['query'], topic) || topic;
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
