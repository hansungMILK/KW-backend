import { blockDefRepo } from '../repositories/block-definition-repository';

import type { BlockDefinitionModel } from '@flows/contracts';

export const blockCatalogService = {
    /** List all latest block definitions (for catalog display) */
    async listAvailable(): Promise<BlockDefinitionModel[]> {
        return blockDefRepo.listLatest();
    },

    /** Get a single block definition by type (latest version) */
    async getByType(type: string): Promise<BlockDefinitionModel | null> {
        return blockDefRepo.getLatest(type);
    },

    /** Get a specific version */
    async getByVersion(type: string, version: string): Promise<BlockDefinitionModel | null> {
        return blockDefRepo.getByVersion(type, version);
    },

    /** Register a block definition (used by domain packs at startup) */
    async register(def: BlockDefinitionModel): Promise<void> {
        // Mark any existing latest as not-latest before storing new version
        const existing = await blockDefRepo.getLatest(def.type);
        if (existing && existing.version !== def.version) {
            await blockDefRepo.put({ ...existing, isLatest: false });
        }
        await blockDefRepo.put({ ...def, isLatest: true });
    },

    /** Bulk register (for domain pack startup) */
    async registerBulk(defs: BlockDefinitionModel[]): Promise<void> {
        for (const def of defs) {
            await this.register(def);
        }
    },

    /** Count of registered definitions */
    async count(): Promise<number> {
        const all = await this.listAvailable();
        return all.length;
    },
};
