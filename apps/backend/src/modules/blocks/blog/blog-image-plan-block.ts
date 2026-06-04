import { z } from 'zod';

import { BlogImageSlotSchema, FactSchema } from './blog-contract';
import { extractTopic, isRecord, text } from './blog-shared';

import type { BlogImageSlot } from './blog-contract';
import type { BlockExecutor, BlockExecutorResult } from '../types';

/**
 * blog-image-plan — produces image SLOTS (positional contracts), not a count.
 * Each slot carries slotId / placement / sectionId / purpose / promptSource / caption / alt.
 * Deterministic: derived directly from the drafted sections (no LLM, no randomness).
 *
 * includeImages toggle:
 * - off ⇒ empty slot list (the document will have no images).
 * - on  ⇒ one hero slot (afterTitle) + one slot after every other H2 section heading.
 */
export const BlogImagePlanOutputSchema = z.object({
    mode: z.literal('blog-image-plan'),
    topic: z.string(),
    title: z.string(),
    includeImages: z.boolean(),
    sections: z.array(z.record(z.string(), z.unknown())),
    imageSlots: z.array(BlogImageSlotSchema),
    // Carry grounding forward so blog-assemble can populate BlogDocument.facts.
    facts: z.array(FactSchema).default([]),
    articles: z.array(z.record(z.string(), z.unknown())).default([]),
});
export type BlogImagePlanOutput = z.infer<typeof BlogImagePlanOutputSchema>;

export const blogImagePlanBlock: BlockExecutor = {
    blockType: 'blog-image-plan',

    async execute(input: unknown, config?: Record<string, unknown>): Promise<BlockExecutorResult> {
        const start = Date.now();
        const upstream = isRecord(input) ? input : {};
        const topic = extractTopic(input, config);
        const title = text(upstream['title'], `${topic} 완벽 정리`);
        const includeImages = readIncludeImages(config, upstream);
        const sections = Array.isArray(upstream['sections']) ? upstream['sections'].filter(isRecord) : [];

        const imageSlots: BlogImageSlot[] = includeImages ? buildSlots(topic, title, sections) : [];

        const output: BlogImagePlanOutput = {
            mode: 'blog-image-plan',
            topic,
            title,
            includeImages,
            sections,
            imageSlots,
            facts: normalizeFacts(upstream['facts']),
            articles: Array.isArray(upstream['articles']) ? upstream['articles'].filter(isRecord) : [],
        };
        const validated = BlogImagePlanOutputSchema.safeParse(output);
        if (!validated.success) {
            throw new Error(`[blog-image-plan] Output schema validation failed: ${validated.error.message}`);
        }
        return { output: validated.data, durationMs: Date.now() - start };
    },
};

function normalizeFacts(input: unknown): BlogImagePlanOutput['facts'] {
    if (!Array.isArray(input)) return [];
    return input.filter(isRecord).map(fact => {
        const source = text(fact['source'], 'missing');
        return {
            key: text(fact['key'], 'fact'),
            value: text(fact['value'], ''),
            source: (['user', 'search', 'derived', 'missing'] as const).includes(source as 'user')
                ? (source as BlogImagePlanOutput['facts'][number]['source'])
                : 'missing',
        };
    });
}

function readIncludeImages(config: Record<string, unknown> | undefined, upstream: Record<string, unknown>): boolean {
    if (config && typeof config['includeImages'] === 'boolean') return config['includeImages'] as boolean;
    if (typeof upstream['includeImages'] === 'boolean') return upstream['includeImages'] as boolean;
    return false;
}

function buildSlots(topic: string, title: string, sections: Record<string, unknown>[]): BlogImageSlot[] {
    const slots: BlogImageSlot[] = [
        {
            slotId: 'hero',
            placement: 'afterTitle',
            purpose: '글 첫인상 대표 이미지',
            promptSource: `${title} — ${topic}을(를) 한눈에 보여주는 대표 이미지`,
            caption: `${topic} 한눈에 보기`,
            alt: `${topic} 대표 이미지`,
        },
    ];

    const h2Sections = sections.filter(section => section['level'] !== 3);
    for (let index = 0; index < h2Sections.length; index += 1) {
        const section = h2Sections[index];
        const sectionId = text(section['id'], `h2-${index + 1}`);
        const heading = text(section['heading'], `핵심 ${index + 1}`);
        const summary = text(section['summary'], heading);
        slots.push({
            slotId: `section-${sectionId}`,
            placement: 'afterSectionHeading',
            sectionId,
            purpose: `${heading} 내용을 시각화`,
            promptSource: `${heading}: ${summary}`,
            caption: heading,
            alt: `${heading} 관련 이미지`,
        });
    }

    return slots;
}
