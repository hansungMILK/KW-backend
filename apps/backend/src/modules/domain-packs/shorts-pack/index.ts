import { blockRegistry } from '../../blocks';
import { registerOrchestrator } from '../../orchestrator';
import { analysisBlock } from './blocks/analysis';
import { contentBlock } from './blocks/content';
import { dataBlock } from './blocks/data';
import { integrationBlock } from './blocks/integration';
import { mediaImageBlock } from './blocks/media-image';
import { mediaTtsBlock } from './blocks/media-tts';
import { mediaVideoBlock } from './blocks/media-video';
import { searchBlock } from './blocks/search';
import { SHORTS_BLOCK_META, SHORTS_PACK_MANIFEST } from './manifest';
import { shortsMockOrchestrator } from './mock-proposal';
import { shortsOrchestrator } from './orchestrator';

import type { BlockExecutor } from '../../blocks/types';

const ALL_EXECUTORS: BlockExecutor[] = [
    searchBlock,
    contentBlock,
    dataBlock,
    analysisBlock,
    mediaImageBlock,
    mediaTtsBlock,
    mediaVideoBlock,
    integrationBlock,
];

/**
 * Register shorts-pack: blocks + orchestrator.
 * Performs startup validation to catch configuration errors early.
 */
export function registerShortsPack(): void {
    // ── Startup validation ──
    const executorTypes = new Set(ALL_EXECUTORS.map(e => e.blockType));
    const manifestTypes = new Set(SHORTS_PACK_MANIFEST.blockTypes);

    // Check: every manifest type has an executor
    for (const type of manifestTypes) {
        if (!executorTypes.has(type)) {
            throw new Error(`[shorts-pack] Manifest declares "${type}" but no executor found`);
        }
    }

    // Check: every executor has metadata
    for (const type of executorTypes) {
        if (!SHORTS_BLOCK_META[type]) {
            throw new Error(`[shorts-pack] Executor "${type}" has no catalog metadata`);
        }
    }

    // Check: no duplicate blockTypes
    if (executorTypes.size !== ALL_EXECUTORS.length) {
        throw new Error('[shorts-pack] Duplicate blockType detected in executors');
    }

    // ── Register blocks with type-keyed metadata ──
    for (const executor of ALL_EXECUTORS) {
        const meta = SHORTS_BLOCK_META[executor.blockType];
        blockRegistry.registerWithMeta(executor, meta);
    }

    // ── Register orchestrator ──
    const mode = process.env.ORCHESTRATOR_MODE || 'mock';
    if (mode === 'claude') {
        registerOrchestrator(shortsOrchestrator);
    } else {
        registerOrchestrator(shortsMockOrchestrator);
    }
}

export function unregisterShortsPack(): void {
    for (const executor of ALL_EXECUTORS) {
        blockRegistry.unregister(executor.blockType);
    }
}

export { SHORTS_PACK_MANIFEST, SHORTS_BLOCK_META } from './manifest';
export { SHORTS_8STEP_BLOCKS, SHORTS_8STEP_EDGE_PAIRS, SHORTS_COST_PER_BLOCK } from './templates/shorts-8step';
