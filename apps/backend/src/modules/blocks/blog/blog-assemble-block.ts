import { z } from 'zod';

import { BlogDocumentSchema } from './blog-contract';
import { extractTopic, isRecord, stringArray, text } from './blog-shared';

import type { BlogDocument, BlogFact, BlogImageSlot, BlogSection } from './blog-contract';
import type { BlockExecutor, BlockExecutorResult } from '../types';

/**
 * blog-assemble — deterministic. Combines drafted section bodies with the image-plan slots
 * (placed by `placement`/`sectionId`) into a complete BlogDocument, then derives a previewModel
 * that mirrors a Naver-blog layout (title / hero image / sub-headings / paragraphs / inline
 * images + captions / highlight box).
 */
const PreviewBlockSchema = z.object({
    kind: z.enum(['title', 'image', 'heading', 'paragraph', 'highlight']),
    level: z.union([z.literal(2), z.literal(3)]).optional(),
    text: z.string().optional(),
    imageUrl: z.string().optional(),
    caption: z.string().optional(),
    alt: z.string().optional(),
    slotId: z.string().optional(),
});

export const BlogAssembleOutputSchema = z.object({
    mode: z.literal('blog-assemble'),
    document: BlogDocumentSchema,
    previewModel: z.object({
        title: z.string(),
        blocks: z.array(PreviewBlockSchema),
    }),
});
export type BlogAssembleOutput = z.infer<typeof BlogAssembleOutputSchema>;

export const blogAssembleBlock: BlockExecutor = {
    blockType: 'blog-assemble',

    async execute(input: unknown, config?: Record<string, unknown>): Promise<BlockExecutorResult> {
        const start = Date.now();
        const upstream = isRecord(input) ? input : {};
        const topic = extractTopic(input, config);
        const title = text(upstream['title'], `${topic} 완벽 정리`);

        const sections = readSections(upstream);
        const imageSlots = readSlots(upstream);
        const facts = readFacts(upstream);
        const seo = readSeo(upstream, topic, title);

        // Attach slot ids to their sections so the contract is self-consistent.
        const slotsBySection = new Map<string, BlogImageSlot[]>();
        let hero: BlogDocument['hero'];
        for (const slot of imageSlots) {
            if (slot.placement === 'afterTitle') {
                hero = { imageSlotId: slot.slotId, caption: slot.caption };
                continue;
            }
            if (slot.sectionId) {
                const list = slotsBySection.get(slot.sectionId) ?? [];
                list.push(slot);
                slotsBySection.set(slot.sectionId, list);
            }
        }
        const sectionsWithSlots: BlogSection[] = sections.map(section => ({
            ...section,
            imageSlots: (slotsBySection.get(section.id) ?? []).map(slot => slot.slotId),
        }));

        const document: BlogDocument = {
            title,
            ...(hero ? { hero } : {}),
            sections: sectionsWithSlots,
            seo,
            facts,
            imageSlots,
        };
        const validatedDoc = BlogDocumentSchema.safeParse(document);
        if (!validatedDoc.success) {
            throw new Error(`[blog-assemble] BlogDocument validation failed: ${validatedDoc.error.message}`);
        }

        const previewModel = buildPreviewModel(validatedDoc.data);
        const output: BlogAssembleOutput = { mode: 'blog-assemble', document: validatedDoc.data, previewModel };
        const validated = BlogAssembleOutputSchema.safeParse(output);
        if (!validated.success) {
            throw new Error(`[blog-assemble] Output schema validation failed: ${validated.error.message}`);
        }
        return { output: validated.data, durationMs: Date.now() - start };
    },
};

function buildPreviewModel(document: BlogDocument): BlogAssembleOutput['previewModel'] {
    const slotById = new Map(document.imageSlots.map(slot => [slot.slotId, slot]));
    const blocks: z.infer<typeof PreviewBlockSchema>[] = [{ kind: 'title', text: document.title }];

    // Hero image directly after the title.
    if (document.hero) {
        const slot = slotById.get(document.hero.imageSlotId);
        if (slot) {
            blocks.push({
                kind: 'image',
                imageUrl: slot.imageUrl,
                caption: slot.caption,
                alt: slot.alt,
                slotId: slot.slotId,
            });
        }
    }

    // AEO/highlight box up top when present.
    if (document.seo.description) {
        blocks.push({ kind: 'highlight', text: document.seo.description });
    }

    for (const section of document.sections) {
        blocks.push({ kind: 'heading', level: section.level, text: section.heading });

        const sectionSlots = section.imageSlots
            .map(slotId => slotById.get(slotId))
            .filter((slot): slot is BlogImageSlot => slot != null);

        // afterSectionHeading slots render right after the heading.
        for (const slot of sectionSlots.filter(slot => slot.placement === 'afterSectionHeading')) {
            blocks.push({
                kind: 'image',
                imageUrl: slot.imageUrl,
                caption: slot.caption,
                alt: slot.alt,
                slotId: slot.slotId,
            });
        }

        section.paragraphs.forEach((paragraph, paragraphIndex) => {
            blocks.push({ kind: 'paragraph', text: paragraph });
            // afterParagraph slots render after their target paragraph index.
            for (const slot of sectionSlots.filter(
                slot => slot.placement === 'afterParagraph' && (slot.paragraphIndex ?? 0) === paragraphIndex
            )) {
                blocks.push({
                    kind: 'image',
                    imageUrl: slot.imageUrl,
                    caption: slot.caption,
                    alt: slot.alt,
                    slotId: slot.slotId,
                });
            }
        });
    }

    return { title: document.title, blocks };
}

function readSections(upstream: Record<string, unknown>): BlogSection[] {
    const raw = Array.isArray(upstream['sections']) ? upstream['sections'].filter(isRecord) : [];
    const sections = raw.map((section, index): BlogSection => {
        const level: 2 | 3 = section['level'] === 3 ? 3 : 2;
        return {
            id: text(section['id']) || `h2-${index + 1}`,
            level,
            heading: text(section['heading'], `핵심 ${index + 1}`),
            paragraphs: stringArray(section['paragraphs']),
            imageSlots: stringArray(section['imageSlots']),
        };
    });
    if (sections.length > 0) return sections;
    return [{ id: 'h2-1', level: 2, heading: '핵심 정리', paragraphs: ['주제의 핵심을 정리합니다.'], imageSlots: [] }];
}

function readSlots(upstream: Record<string, unknown>): BlogImageSlot[] {
    const raw = Array.isArray(upstream['imageSlots']) ? upstream['imageSlots'].filter(isRecord) : [];
    return raw.map((slot, index): BlogImageSlot => {
        const placementRaw = text(slot['placement'], 'afterSectionHeading');
        const placement = (['afterTitle', 'afterSectionHeading', 'afterParagraph'] as const).includes(
            placementRaw as 'afterTitle'
        )
            ? (placementRaw as BlogImageSlot['placement'])
            : 'afterSectionHeading';
        return {
            slotId: text(slot['slotId']) || `slot-${index + 1}`,
            placement,
            ...(typeof slot['sectionId'] === 'string' ? { sectionId: slot['sectionId'] } : {}),
            ...(typeof slot['paragraphIndex'] === 'number' ? { paragraphIndex: slot['paragraphIndex'] } : {}),
            purpose: text(slot['purpose'], '본문 시각화'),
            promptSource: text(slot['promptSource'], ''),
            caption: text(slot['caption'], ''),
            alt: text(slot['alt'], ''),
            ...(typeof slot['imageUrl'] === 'string' ? { imageUrl: slot['imageUrl'] } : {}),
        };
    });
}

function readFacts(upstream: Record<string, unknown>): BlogFact[] {
    const raw = Array.isArray(upstream['facts']) ? upstream['facts'].filter(isRecord) : [];
    return raw.map(fact => {
        const source = text(fact['source'], 'missing');
        return {
            key: text(fact['key'], 'fact'),
            value: text(fact['value'], ''),
            source: (['user', 'search', 'derived', 'missing'] as const).includes(source as 'user')
                ? (source as BlogFact['source'])
                : 'missing',
        };
    });
}

function readSeo(upstream: Record<string, unknown>, topic: string, title: string): BlogDocument['seo'] {
    const seo = isRecord(upstream['seo']) ? upstream['seo'] : {};
    const keywords = stringArray(seo['keywords']);
    return {
        title: text(seo['title'], title),
        description: text(seo['description'], `${topic}에 대해 핵심만 정리한 가이드입니다.`),
        keywords: keywords.length > 0 ? keywords : [topic],
    };
}
