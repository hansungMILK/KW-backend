import { z } from 'zod';

import { BlogDocumentSchema } from './blog-contract';
import { isRecord, text } from './blog-shared';

import type { BlogDocument, BlogImageSlot } from './blog-contract';
import type { BlockExecutor, BlockExecutorResult } from '../types';

/**
 * blog-export — turns the BlogDocument into copy-paste outputs.
 *   - naverHtml: title/sub-headings/paragraphs/images in body order (for clipboard text/html).
 *   - markdown: developer/backup output (markdown-only would be a failure — it's secondary here).
 *   - imageManifest: [{ slotId, url, caption, alt }] for manual upload when external images break.
 *
 * Deterministic: pure string assembly, no LLM, no randomness.
 */
const ImageManifestEntrySchema = z.object({
    slotId: z.string(),
    url: z.string(),
    caption: z.string(),
    alt: z.string(),
});

export const BlogExportOutputSchema = z.object({
    mode: z.literal('blog-export'),
    naverHtml: z.string(),
    markdown: z.string(),
    imageManifest: z.array(ImageManifestEntrySchema),
});
export type BlogExportOutput = z.infer<typeof BlogExportOutputSchema>;

export const blogExportBlock: BlockExecutor = {
    blockType: 'blog-export',

    async execute(input: unknown, _config?: Record<string, unknown>): Promise<BlockExecutorResult> {
        const start = Date.now();
        const document = readDocument(input);

        const naverHtml = buildNaverHtml(document);
        const markdown = buildMarkdown(document);
        const imageManifest = buildImageManifest(document);

        const output: BlogExportOutput = { mode: 'blog-export', naverHtml, markdown, imageManifest };
        const validated = BlogExportOutputSchema.safeParse(output);
        if (!validated.success) {
            throw new Error(`[blog-export] Output schema validation failed: ${validated.error.message}`);
        }
        return { output: validated.data, durationMs: Date.now() - start };
    },
};

function readDocument(input: unknown): BlogDocument {
    const root = isRecord(input) ? input : {};
    const candidate = isRecord(root['document']) ? root['document'] : root;
    const validated = BlogDocumentSchema.safeParse(candidate);
    if (!validated.success) {
        throw new Error(`[blog-export] requires a valid BlogDocument: ${validated.error.message}`);
    }
    return validated.data;
}

function escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function imageHtml(slot: BlogImageSlot | undefined): string {
    if (!slot) return '';
    const src = slot.imageUrl ? ` src="${escapeHtml(slot.imageUrl)}"` : '';
    const alt = ` alt="${escapeHtml(slot.alt)}"`;
    const caption = slot.caption ? `<figcaption>${escapeHtml(slot.caption)}</figcaption>` : '';
    return `<figure><img${src}${alt} />${caption}</figure>`;
}

function buildNaverHtml(document: BlogDocument): string {
    const slotById = new Map(document.imageSlots.map(slot => [slot.slotId, slot]));
    const parts: string[] = [`<h1>${escapeHtml(document.title)}</h1>`];

    if (document.hero) {
        const hero = slotById.get(document.hero.imageSlotId);
        if (hero) parts.push(imageHtml(hero));
    }

    for (const section of document.sections) {
        parts.push(`<h${section.level}>${escapeHtml(section.heading)}</h${section.level}>`);

        const sectionSlots = section.imageSlots
            .map(slotId => slotById.get(slotId))
            .filter((slot): slot is BlogImageSlot => slot != null);

        for (const slot of sectionSlots.filter(slot => slot.placement === 'afterSectionHeading')) {
            parts.push(imageHtml(slot));
        }
        section.paragraphs.forEach((paragraph, paragraphIndex) => {
            parts.push(`<p>${escapeHtml(paragraph)}</p>`);
            for (const slot of sectionSlots.filter(
                slot => slot.placement === 'afterParagraph' && (slot.paragraphIndex ?? 0) === paragraphIndex
            )) {
                parts.push(imageHtml(slot));
            }
        });
    }

    return parts.join('\n');
}

function buildMarkdown(document: BlogDocument): string {
    const slotById = new Map(document.imageSlots.map(slot => [slot.slotId, slot]));
    const lines: string[] = [`# ${document.title}`, ''];

    if (document.hero) {
        const hero = slotById.get(document.hero.imageSlotId);
        if (hero) {
            lines.push(`![${hero.alt}](${hero.imageUrl ?? ''})`);
            if (hero.caption) lines.push(`*${hero.caption}*`);
            lines.push('');
        }
    }

    for (const section of document.sections) {
        lines.push(`${'#'.repeat(section.level)} ${section.heading}`, '');
        const sectionSlots = section.imageSlots
            .map(slotId => slotById.get(slotId))
            .filter((slot): slot is BlogImageSlot => slot != null);
        for (const slot of sectionSlots.filter(slot => slot.placement === 'afterSectionHeading')) {
            lines.push(`![${slot.alt}](${slot.imageUrl ?? ''})`);
            if (slot.caption) lines.push(`*${slot.caption}*`);
            lines.push('');
        }
        section.paragraphs.forEach((paragraph, paragraphIndex) => {
            lines.push(paragraph, '');
            for (const slot of sectionSlots.filter(
                slot => slot.placement === 'afterParagraph' && (slot.paragraphIndex ?? 0) === paragraphIndex
            )) {
                lines.push(`![${slot.alt}](${slot.imageUrl ?? ''})`);
                if (slot.caption) lines.push(`*${slot.caption}*`);
                lines.push('');
            }
        });
    }

    return lines.join('\n').trimEnd();
}

function buildImageManifest(document: BlogDocument): BlogExportOutput['imageManifest'] {
    return document.imageSlots.map(slot => ({
        slotId: slot.slotId,
        url: text(slot.imageUrl, ''),
        caption: slot.caption,
        alt: slot.alt,
    }));
}
