import { analysisBlock } from './analysis-block';
import { contentBlock } from './content-block';
import { dataBlock } from './data-block';
import { integrationBlock } from './integration-block';
import {
    longformBriefBlock,
    longformMotionComposeBlock,
    longformPackageBlock,
    longformQaBlock,
    longformRenderBlock,
    longformReviewBlock,
    longformSceneJsonBlock,
    longformScriptBlock,
    longformSourceBlock,
    longformSrtAlignBlock,
    longformStoryboardBlock,
    longformTtsBlock,
} from './longform-blocks';
import { mediaImageBlock } from './media-image-block';
import { mediaTtsBlock } from './media-tts-block';
import { mediaVideoBlock } from './media-video-block';
import { searchBlock } from './search-block';
import { BLOCK_TYPES } from './types';
import {
    bufferDelayBlock,
    inputImageBlock,
    inputTextBlock,
    outputPreviewBlock,
    textTransformBlock,
} from './utility-blocks';

import type { BlockExecutor, BlockType } from './types';

const registry = new Map<BlockType, BlockExecutor>();

registry.set('input-text', inputTextBlock);
registry.set('input-image', inputImageBlock);
registry.set('output-preview', outputPreviewBlock);
registry.set('buffer-delay', bufferDelayBlock);
registry.set('text-transform', textTransformBlock);
registry.set('search', searchBlock);
registry.set('content', contentBlock);
registry.set('data', dataBlock);
registry.set('analysis', analysisBlock);
registry.set('media-image', mediaImageBlock);
registry.set('media-tts', mediaTtsBlock);
registry.set('media-video', mediaVideoBlock);
registry.set('integration', integrationBlock);
registry.set('longform-source', longformSourceBlock);
registry.set('longform-brief', longformBriefBlock);
registry.set('longform-script', longformScriptBlock);
registry.set('longform-storyboard', longformStoryboardBlock);
registry.set('longform-scene-json', longformSceneJsonBlock);
registry.set('longform-review', longformReviewBlock);
registry.set('longform-tts', longformTtsBlock);
registry.set('longform-srt-align', longformSrtAlignBlock);
registry.set('longform-motion-compose', longformMotionComposeBlock);
registry.set('longform-render', longformRenderBlock);
registry.set('longform-qa', longformQaBlock);
registry.set('longform-package', longformPackageBlock);

// Sanity check: every declared block type must be registered
for (const blockType of BLOCK_TYPES) {
    if (!registry.has(blockType)) {
        throw new Error(`[block-registry] Missing executor for block type: "${blockType}"`);
    }
}

export const blockRegistry = {
    get(blockType: string): BlockExecutor | undefined {
        return registry.get(blockType as BlockType);
    },
    has(blockType: string): boolean {
        return registry.has(blockType as BlockType);
    },
    listTypes(): BlockType[] {
        return [...registry.keys()];
    },
};
