import type { BlockExecutor } from './types';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BlockCatalogMeta {
    label: string;
    description: string;
    stereo: 'input' | 'process' | 'output';
    inputs: Array<{ id: string; label: string; type: string }>;
    outputs: Array<{ id: string; label: string; type: string }>;
    configSchema: Array<{ key: string; label: string; type: string; default?: string }>;
}

// ── Internal maps ─────────────────────────────────────────────────────────────

const registry = new Map<string, BlockExecutor>();
const catalogMetadata = new Map<string, BlockCatalogMeta>();

// ── Public API ────────────────────────────────────────────────────────────────

export const blockRegistry = {
    /** Register a block executor without catalog metadata. */
    register(executor: BlockExecutor): void {
        registry.set(executor.blockType, executor);
    },

    /** Register a block executor with rich catalog metadata (label, description, ports). */
    registerWithMeta(executor: BlockExecutor, meta: BlockCatalogMeta): void {
        registry.set(executor.blockType, executor);
        catalogMetadata.set(executor.blockType, meta);
    },

    /** Remove a block from the registry. */
    unregister(blockType: string): void {
        registry.delete(blockType);
        catalogMetadata.delete(blockType);
    },

    /** Retrieve an executor by block type. Returns undefined if not registered. */
    get(blockType: string): BlockExecutor | undefined {
        return registry.get(blockType);
    },

    /** Check whether a block type is registered. */
    has(blockType: string): boolean {
        return registry.has(blockType);
    },

    /** List all registered block type strings. */
    listTypes(): string[] {
        return [...registry.keys()];
    },

    /** List all registered executors. */
    listAll(): BlockExecutor[] {
        return [...registry.values()];
    },

    /** Get catalog metadata for a block type. */
    getMeta(blockType: string): BlockCatalogMeta | undefined {
        return catalogMetadata.get(blockType);
    },

    /** List all executors with their metadata (if available). */
    listAllWithMeta(): Array<{ executor: BlockExecutor; meta?: BlockCatalogMeta }> {
        return [...registry.entries()].map(([type, executor]) => ({
            executor,
            meta: catalogMetadata.get(type),
        }));
    },

    /** Number of registered block types. */
    size(): number {
        return registry.size;
    },
};
