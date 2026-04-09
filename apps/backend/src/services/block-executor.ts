/**
 * Block executor — runs a single block's logic via the block registry.
 * Unknown block types are ALWAYS a hard failure (never silent fallback).
 */

import { blockRegistry } from '../modules/blocks';

import type { BlockExecutorResult } from '../modules/blocks/types';

export class UnknownBlockTypeError extends Error {
    constructor(public readonly blockType: string) {
        super(`Unknown block type: ${blockType}. Not registered in block registry.`);
        this.name = 'UnknownBlockTypeError';
    }
}

export const blockExecutor = {
    async execute(blockType: string, input: unknown): Promise<BlockExecutorResult> {
        const executor = blockRegistry.get(blockType);

        if (!executor) {
            // Hard failure — execution-engine catches this and marks node FAILED
            throw new UnknownBlockTypeError(blockType);
        }

        const start = Date.now();
        const result = await executor.execute(input);
        return {
            output: result.output,
            durationMs: Date.now() - start,
            assets: result.assets ?? [],
        };
    },
};
