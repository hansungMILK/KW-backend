import { blockCatalogService } from '../../../services/block-catalog-service';
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
import type { BlockDefinitionModel } from '@flows/contracts';

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
 * Build BlockDefinitionModel[] from shorts-pack manifest metadata.
 * Used to populate the block catalog so clients can discover block contracts.
 */
function buildBlockDefinitions(): BlockDefinitionModel[] {
    const now = new Date().toISOString();
    return SHORTS_PACK_MANIFEST.blockTypes.map(type => {
        const meta = SHORTS_BLOCK_META[type];
        return {
            id: `blk-${type}`,
            type,
            version: SHORTS_PACK_MANIFEST.version,
            isLatest: true,
            workspaceId: null,
            name: meta.label,
            description: meta.description,
            category: meta.stereo,
            executionMode: 'domain-pack' as const,
            inputSchema: {
                type: 'object' as const,
                properties: Object.fromEntries(
                    meta.inputs.map(inp => [inp.id, { type: 'string' as const, description: inp.label }])
                ),
                required: meta.inputs.map(i => i.id),
            },
            outputSchema: {
                type: 'object' as const,
                properties: Object.fromEntries(
                    meta.outputs.map(out => [out.id, { type: 'string' as const, description: out.label }])
                ),
                required: meta.outputs.map(o => o.id),
            },
            configSchema: {
                type: 'object' as const,
                properties: Object.fromEntries(
                    (meta.configSchema || []).map(cfg => [
                        cfg.key,
                        { type: 'string' as const, description: cfg.label, default: cfg.default },
                    ])
                ),
            },
            source: 'domain-pack' as const,
            domainPack: 'shorts-pack',
            approved: true,
            createdBy: 'system',
            createdAt: now,
            updatedAt: now,
        };
    });
}

/**
 * Register shorts-pack: blocks + orchestrator + catalog definitions.
 * Performs startup validation to catch configuration errors early.
 */
export async function registerShortsPack(): Promise<void> {
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

    // ── Register blocks with type-keyed metadata (registry — runtime executor lookup) ──
    for (const executor of ALL_EXECUTORS) {
        const meta = SHORTS_BLOCK_META[executor.blockType];
        blockRegistry.registerWithMeta(executor, meta);
    }

    // ── Register orchestrator (single active planning pack) ──
    const mode = process.env.ORCHESTRATOR_MODE || 'mock';
    if (mode === 'claude') {
        registerOrchestrator(shortsOrchestrator, 'shorts-pack');
    } else {
        registerOrchestrator(shortsMockOrchestrator, 'shorts-pack');
    }

    // ── Register block definitions in catalog (metadata layer) ──
    const defs = buildBlockDefinitions();
    await blockCatalogService.registerBulk(defs);
}

export function unregisterShortsPack(): void {
    for (const executor of ALL_EXECUTORS) {
        blockRegistry.unregister(executor.blockType);
    }
}

export { SHORTS_PACK_MANIFEST, SHORTS_BLOCK_META } from './manifest';
export { SHORTS_8STEP_BLOCKS, SHORTS_8STEP_EDGE_PAIRS, SHORTS_COST_PER_BLOCK } from './templates/shorts-8step';
