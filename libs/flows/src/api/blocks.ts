import { api, withRetry } from '@flows/web-core';

import { EXECUTE_FUNCTIONS } from './execute-functions';

import type { BlockDefinitionWithFrontend, BlockSpec, BlockStereo } from '../types';

const _log = console.log.bind(console, '[blocks-api]');
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** @deprecated Fallback for servers without isFrontend flag. Remove when server is updated. */
const LEGACY_BACKEND_PROCESSOR_TYPES = [
    'blog-title-generator',
    'blog-tags-generator',
    'single-image-generator',
    'title-generator',
] as const;

const FRONTEND_BLOCK_TYPES = ['input-text', 'input-image', 'output-preview', 'buffer-delay', 'text-transform'] as const;

/**
 * Spec block item returned by GET /blocks.
 */
interface BlockSpecListResponse {
    items: Array<{
        blockType: string;
        name: string;
        description?: string;
        category: BlockStereo;
        inputSchema?: unknown[];
        outputSchema?: unknown[];
        estimatedCost?: number;
    }>;
}

/**
 * Check if a block definition requires backend processing
 *
 * Decision logic:
 * 1. If `isFrontend` is explicitly `true` → Frontend execution (no backend call)
 * 2. If `isFrontend` is explicitly `false` → Backend execution (call API)
 * 3. If `isFrontend` is `undefined` → Fallback to legacy BACKEND_PROCESSOR_TYPES check
 *
 * @param blockDef - The block definition to check
 * @returns `true` if backend processing is required, `false` otherwise
 */
export const requiresBackendProcessing = (blockDef: BlockDefinitionWithFrontend): boolean => {
    // If isFrontend is explicitly set, use it directly
    if (blockDef.isFrontend !== undefined) {
        return !blockDef.isFrontend;
    }

    // Fallback: use legacy hardcoded list for backward compatibility
    return LEGACY_BACKEND_PROCESSOR_TYPES.some(type => type === blockDef.type);
};

/**
 * Fetch all available block definitions from server
 * GET /blocks
 */
export const listBlocks = async (): Promise<BlockDefinitionWithFrontend[]> => {
    _log('> listBlocks()');
    await delay(500);

    const response = await withRetry(() => api.get<BlockSpecListResponse>('/blocks'), 3, 'listBlocks');

    const rawList = response.data?.items;
    if (!rawList?.length) {
        throw new Error('No block definitions returned from server');
    }

    const list = rawList.map((item): BlockDefinitionWithFrontend => {
        const isFrontend = FRONTEND_BLOCK_TYPES.includes(item.blockType as (typeof FRONTEND_BLOCK_TYPES)[number]);
        const definition: BlockDefinitionWithFrontend = {
            id: item.blockType,
            type: item.blockType,
            label: item.name,
            description: item.description ?? '',
            inputs: (item.inputSchema ?? []) as BlockDefinitionWithFrontend['inputs'],
            outputs: (item.outputSchema ?? []) as BlockDefinitionWithFrontend['outputs'],
            defaultConfig: {},
            isFrontend,
            stereo: item.category,
            isRunnable: true,
        };
        const shouldRunOnFrontend = !requiresBackendProcessing(definition);
        return {
            ...definition,
            execute: shouldRunOnFrontend ? EXECUTE_FUNCTIONS[definition.type] : undefined,
        };
    });

    _log('> API listBlocks().len =', list.length);
    if (!list.length) throw new Error('No valid block definitions found');
    return list;
};

/**
 * Get single block definition by type
 * GET /blocks/{blockType}
 */
export const getBlock = async (blockType: string): Promise<BlockSpec> => {
    _log(`> getBlock(${blockType})`);
    const response = await api.get<BlockSpec>(`/blocks/${blockType}`);
    return response.data;
};
