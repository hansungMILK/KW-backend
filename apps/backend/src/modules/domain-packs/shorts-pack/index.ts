import { blockRegistry } from '../../blocks';
import { analysisBlock } from './blocks/analysis';
import { contentBlock } from './blocks/content';
import { dataBlock } from './blocks/data';
import { integrationBlock } from './blocks/integration';
import { mediaImageBlock } from './blocks/media-image';
import { mediaTtsBlock } from './blocks/media-tts';
import { mediaVideoBlock } from './blocks/media-video';
import { searchBlock } from './blocks/search';
import { SHORTS_BLOCK_CATALOG_META } from './manifest';

export const SHORTS_PACK_BLOCKS = [
    searchBlock,
    contentBlock,
    dataBlock,
    analysisBlock,
    mediaImageBlock,
    mediaTtsBlock,
    mediaVideoBlock,
    integrationBlock,
];

export function registerShortsPack(): void {
    for (let i = 0; i < SHORTS_PACK_BLOCKS.length; i++) {
        const block = SHORTS_PACK_BLOCKS[i];
        const meta = SHORTS_BLOCK_CATALOG_META[i];
        blockRegistry.registerWithMeta(block, {
            label: meta.label,
            description: meta.description,
            stereo: meta.stereo,
            inputs: [...meta.inputs],
            outputs: [...meta.outputs],
        });
    }
}

export function unregisterShortsPack(): void {
    for (const block of SHORTS_PACK_BLOCKS) {
        blockRegistry.unregister(block.blockType);
    }
}

export { SHORTS_PACK_MANIFEST, SHORTS_BLOCK_CATALOG_META } from './manifest';
export { SHORTS_8STEP_BLOCKS, SHORTS_8STEP_EDGE_PAIRS, SHORTS_COST_PER_BLOCK } from './templates/shorts-8step';
export { SHORTS_ORCHESTRATOR_SYSTEM_PROMPT, buildShortsUserPrompt } from './prompts/orchestrator-prompt';
