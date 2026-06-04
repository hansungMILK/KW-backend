import { z } from 'zod';

/**
 * Blog v2 — "네이버 복붙 완성형" contract.
 *
 * Single source of truth for the structured blog document the backend produces.
 * Deterministic: every value is fully resolved (no random/now-based fields).
 * Isolated: this contract does NOT import countryball/longform domain schemas.
 *
 * Anti-hallucination: factual claims (stats/quotes/dates/places) carry an explicit
 * `source` tag. When no source exists the block must generalize instead of inventing
 * facts — see FactSchema.source = 'missing'.
 */

/** Heading depth inside the body. H1 is the document title; sections are H2/H3. */
export const BlogHeadingLevelSchema = z.union([z.literal(2), z.literal(3)]);
export type BlogHeadingLevel = z.infer<typeof BlogHeadingLevelSchema>;

/** Where an image slot is anchored in the body flow. */
export const BlogImagePlacementSchema = z.enum(['afterTitle', 'afterSectionHeading', 'afterParagraph']);
export type BlogImagePlacement = z.infer<typeof BlogImagePlacementSchema>;

/**
 * Fact provenance. A fact may be stated only when sourced; otherwise the writer
 * must generalize. `missing` records a fact the model wanted but could not ground.
 */
export const FactSchema = z.object({
    key: z.string(),
    value: z.string(),
    source: z.enum(['user', 'search', 'derived', 'missing']),
});
export type BlogFact = z.infer<typeof FactSchema>;

/**
 * Image slot = a positional contract, not a count. blog-image-plan creates these;
 * blog-images fills `imageUrl` (when the includeImages toggle is on); blog-assemble
 * inserts the rendered image at `placement` (anchored to `sectionId` when relevant).
 */
export const BlogImageSlotSchema = z.object({
    slotId: z.string(),
    placement: BlogImagePlacementSchema,
    /** Section this slot anchors to (required for afterSectionHeading / afterParagraph). */
    sectionId: z.string().optional(),
    /** When placement is afterParagraph: 0-based index of the paragraph it follows. */
    paragraphIndex: z.number().int().min(0).optional(),
    purpose: z.string(),
    /** What the image generator should depict — derived from the body, not invented facts. */
    promptSource: z.string(),
    caption: z.string(),
    alt: z.string(),
    imageUrl: z.string().optional(),
});
export type BlogImageSlot = z.infer<typeof BlogImageSlotSchema>;

/** A body section. level 2 = H2, level 3 = H3. */
export const BlogSectionSchema = z.object({
    id: z.string(),
    level: BlogHeadingLevelSchema,
    heading: z.string(),
    paragraphs: z.array(z.string()),
    /** slotIds of images that belong inside this section. */
    imageSlots: z.array(z.string()),
});
export type BlogSection = z.infer<typeof BlogSectionSchema>;

export const BlogSeoSchema = z.object({
    title: z.string(),
    description: z.string(),
    keywords: z.array(z.string()),
});
export type BlogSeo = z.infer<typeof BlogSeoSchema>;

export const BlogHeroSchema = z.object({
    imageSlotId: z.string(),
    caption: z.string(),
});
export type BlogHero = z.infer<typeof BlogHeroSchema>;

/** The completed structured document. Markdown-only output is a failure (plan §2). */
export const BlogDocumentSchema = z.object({
    title: z.string(),
    hero: BlogHeroSchema.optional(),
    sections: z.array(BlogSectionSchema),
    seo: BlogSeoSchema,
    facts: z.array(FactSchema),
    imageSlots: z.array(BlogImageSlotSchema),
});
export type BlogDocument = z.infer<typeof BlogDocumentSchema>;
