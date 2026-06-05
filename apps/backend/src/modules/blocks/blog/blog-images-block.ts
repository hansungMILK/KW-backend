import { isRecord, text } from './blog-shared';
import { mediaImageBlock } from '../media-image-block';

import type { BlogImageSlot } from './blog-contract';
import type { BlockExecutor, BlockExecutorContext, BlockExecutorResult } from '../types';

/**
 * blog-images — fills each image slot's imageUrl by delegating to the existing `media-image`
 * block (config reuse; media-image is NOT modified). It maps slots → scenes[].imagePrompt and
 * passes count/style through; media-image consumes scenes[].imagePrompt and returns images[].
 *
 * Toggle: when includeImages is off (no slots), it passes through unchanged and generates nothing.
 * Assets produced by media-image propagate via the returned assets (image package for free).
 */
export const blogImagesBlock: BlockExecutor = {
    blockType: 'blog-images',

    async execute(
        input: unknown,
        config?: Record<string, unknown>,
        context?: BlockExecutorContext
    ): Promise<BlockExecutorResult> {
        const start = Date.now();
        const upstream = isRecord(input) ? input : {};
        const slots: BlogImageSlot[] = Array.isArray(upstream['imageSlots'])
            ? (upstream['imageSlots'].filter(isRecord) as BlogImageSlot[])
            : [];

        // No slots ⇒ includeImages was off (or nothing to generate). Pass through.
        if (slots.length === 0) {
            return {
                output: { ...upstream, mode: 'blog-images', imageSlots: slots, imagesGenerated: 0 },
                durationMs: Date.now() - start,
            };
        }

        // Build the scene contract media-image expects: scenes[].imagePrompt.
        // caption is left empty on purpose — media-image injects caption as a "Subtitle meaning"
        // hint, which would re-introduce the abstract heading text and nudge the model toward
        // rendering letters. The visual promptSource already carries the full scene.
        const scenes = slots.map((slot, index) => ({
            sceneNumber: index + 1,
            imagePrompt: slot.promptSource,
            caption: '',
            narration: '',
        }));

        // Style the model picked in blog-image-plan (default photo-real). `style: 'single-image'`
        // selects the full-image FORMAT; `imageStyleId` selects the visual style preset.
        const imageStyleId = text(upstream['imageStyleId'], 'photo-real');
        const mediaResult = await mediaImageBlock.execute(
            { scenes },
            { ...config, count: slots.length, style: 'single-image', imageStyleId },
            context
        );
        const mediaOutput = isRecord(mediaResult.output) ? mediaResult.output : {};
        const images = Array.isArray(mediaOutput['images']) ? mediaOutput['images'].filter(isRecord) : [];

        // Map generated images back onto slots by scene order.
        const filledSlots = slots.map((slot, index) => {
            const image = images[index];
            const url = image && typeof image['url'] === 'string' ? image['url'] : slot.imageUrl;
            return url ? { ...slot, imageUrl: url } : { ...slot };
        });

        return {
            output: {
                ...upstream,
                mode: 'blog-images',
                imageSlots: filledSlots,
                imagesGenerated: filledSlots.filter(slot => typeof slot.imageUrl === 'string').length,
            },
            durationMs: Date.now() - start,
            ...(mediaResult.assets ? { assets: mediaResult.assets } : {}),
        };
    },
};
