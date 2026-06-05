import { z } from 'zod';

import { BlogImageSlotSchema, FactSchema } from './blog-contract';
import { extractTopic, isRecord, parseJsonLike, text } from './blog-shared';
import { openaiAdapter } from '../../../adapters/ai/openai-adapter';
import { env } from '../../../config/env';

import type { BlogImageSlot } from './blog-contract';
import type { BlockExecutor, BlockExecutorResult } from '../types';

/**
 * blog-image-plan — produces image SLOTS (positional contracts), not a count.
 * Each slot carries slotId / placement / sectionId / purpose / promptSource / caption / alt.
 *
 * Slot SKELETONS (placement / sectionId / caption / alt) are deterministic. The image-gen
 * `promptSource` and the post's visual `imageStyleId` are then written by the model so the images
 * depict the REAL subject (footballers on a pitch, the finished dish, …) instead of restating the
 * abstract heading. The model also picks a fitting style (photo-real default). Generic across
 * topics — no hardcoded subject/style. Falls back to the deterministic prompt + photo-real on
 * mock/failure.
 *
 * includeImages toggle:
 * - off ⇒ empty slot list (the document will have no images).
 * - on  ⇒ at most `imageCount` slots: one hero slot (afterTitle) + up to (imageCount-1) section
 *         slots spread EVENLY across the H2 sections (not one per section).
 */
export const BlogImagePlanOutputSchema = z.object({
    mode: z.literal('blog-image-plan'),
    topic: z.string(),
    title: z.string(),
    includeImages: z.boolean(),
    imageCount: z.number().int().min(1).max(12).default(4),
    /** Visual style the model chose for this post's images (consumed by blog-images → media-image). */
    imageStyleId: z.string().default('photo-real'),
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
        const imageCount = readImageCount(config, upstream);
        const sections = Array.isArray(upstream['sections']) ? upstream['sections'].filter(isRecord) : [];
        const facts = normalizeFacts(upstream['facts']);

        const skeletonSlots: BlogImageSlot[] = includeImages ? buildSlots(topic, title, sections, imageCount) : [];
        const { slots: imageSlots, imageStyleId } =
            includeImages && skeletonSlots.length > 0 && env.orchestratorMode !== 'mock'
                ? await enrichSlotsWithVisualPrompts(topic, title, skeletonSlots, sections, facts)
                : { slots: skeletonSlots, imageStyleId: 'photo-real' };

        const output: BlogImagePlanOutput = {
            mode: 'blog-image-plan',
            topic,
            title,
            includeImages,
            imageCount,
            imageStyleId,
            sections,
            imageSlots,
            facts,
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

const IMAGE_COUNT_DEFAULT = 4;
const IMAGE_COUNT_MIN = 1;
const IMAGE_COUNT_MAX = 12;

function readImageCount(config: Record<string, unknown> | undefined, upstream: Record<string, unknown>): number {
    const raw = Number(config?.['imageCount'] ?? upstream['imageCount']);
    const count = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : IMAGE_COUNT_DEFAULT;
    return Math.min(IMAGE_COUNT_MAX, Math.max(IMAGE_COUNT_MIN, count));
}

/**
 * Build at most `count` slots: 1 hero (afterTitle) + up to (count-1) section slots spread EVENLY
 * across the H2 sections. Even spread uses index floor(i * n / k) so the chosen sections are
 * distinct (guaranteed while k ≤ n) and distributed, not clustered at the top. Deterministic.
 */
function buildSlots(topic: string, title: string, sections: Record<string, unknown>[], count: number): BlogImageSlot[] {
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
    const sectionSlotCount = Math.min(Math.max(count - 1, 0), h2Sections.length);
    for (let i = 0; i < sectionSlotCount; i += 1) {
        const index = Math.floor((i * h2Sections.length) / sectionSlotCount);
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

const BLOG_IMAGE_STYLES = [
    'photo-real',
    'research-visual',
    'animation',
    'explainer-comic',
    'blueprint',
    'newspaper',
] as const;

function normalizeStyleId(value: unknown): string {
    const v = text(value).trim();
    return (BLOG_IMAGE_STYLES as readonly string[]).includes(v) ? v : 'photo-real';
}

const BLOG_IMAGE_PROMPT_SYSTEM = `You write IMAGE-GENERATION prompts and pick ONE visual style for the inline images of a Korean blog post.
For each requested image, describe a CONCRETE VISUAL SCENE that depicts the REAL subject of that section — name the concrete
people, objects, place, action, setting and mood the way a real photograph or illustration would actually show them. Be
generic across ANY topic: a football topic → footballers playing on a stadium pitch with fans; a cooking topic → the finished
dish and ingredients on a table; an AI/tech topic → people using devices or data-center hardware. Ground each scene in the
provided section content.

Rules:
- Depict the real-world subject visually. Do NOT merely restate the heading or use abstract label text.
- NO text, letters, words, numbers, captions, logos or watermarks anywhere in the image.
- Do NOT depict real named individuals' faces; use representative/anonymous people instead.
- Each prompt is 1–2 vivid, specific sentences.

Also choose ONE styleId for the whole post that best fits the subject, from exactly:
- "photo-real": realistic editorial photographs (best default for real-world subjects, people, places, events)
- "research-visual": charts / analysis / dashboard / abstract data feel
- "animation": cel-shaded illustration
- "explainer-comic": bold comic / meme illustration
- "blueprint": technical schematic
- "newspaper": retro print look

Return JSON only: { "styleId": "photo-real", "images": [{ "slotId": "...", "prompt": "..." }] }`;

/**
 * Ask the writing model to turn each slot into a concrete visual scene prompt and to pick one
 * fitting style. Keeps the deterministic prompt as a fallback per slot; never throws (failure ⇒
 * deterministic prompts + photo-real). This is what makes the images depict the real subject.
 */
async function enrichSlotsWithVisualPrompts(
    topic: string,
    title: string,
    slots: BlogImageSlot[],
    sections: Record<string, unknown>[],
    facts: BlogImagePlanOutput['facts']
): Promise<{ slots: BlogImageSlot[]; imageStyleId: string }> {
    const sectionById = new Map(sections.map(section => [text(section['id']), section]));
    const slotContext = slots.map(slot => {
        if (slot.placement === 'afterTitle') {
            return { slotId: slot.slotId, role: 'hero', heading: title, content: topic };
        }
        const section = slot.sectionId ? sectionById.get(slot.sectionId) : undefined;
        const paragraphs = section && Array.isArray(section['paragraphs']) ? section['paragraphs'] : [];
        return {
            slotId: slot.slotId,
            role: 'section',
            heading: slot.caption,
            content: text(paragraphs[0]).slice(0, 400),
        };
    });

    const userMessage = [
        `BLOG TOPIC: ${topic}`,
        `BLOG TITLE: ${title}`,
        facts.length > 0 ? `FACTS:\n${JSON.stringify(facts).slice(0, 1500)}` : undefined,
        `IMAGES NEEDED (one visual prompt per slotId):\n${JSON.stringify(slotContext, null, 2).slice(0, 4000)}`,
        'Write one concrete visual prompt per slotId and pick one styleId for the whole post.',
    ]
        .filter(Boolean)
        .join('\n\n');

    try {
        const response = await openaiAdapter.chatJson({
            model: env.openaiWritingModel,
            systemPrompt: BLOG_IMAGE_PROMPT_SYSTEM,
            userMessage,
            maxTokens: env.openaiContentMaxTokens,
        });
        const parsed = parseJsonLike(response.content);
        const root = isRecord(parsed) ? parsed : {};
        const imageStyleId = normalizeStyleId(root['styleId']);
        const promptById = new Map<string, string>();
        for (const img of Array.isArray(root['images']) ? root['images'].filter(isRecord) : []) {
            const slotId = text(img['slotId']);
            const prompt = text(img['prompt']);
            if (slotId && prompt) promptById.set(slotId, prompt);
        }
        const enriched = slots.map(slot => {
            const aiPrompt = promptById.get(slot.slotId);
            return aiPrompt ? { ...slot, promptSource: aiPrompt } : slot;
        });
        return { slots: enriched, imageStyleId };
    } catch {
        return { slots, imageStyleId: 'photo-real' };
    }
}
