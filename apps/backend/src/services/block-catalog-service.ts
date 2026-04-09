import { blockDefRepo } from '../repositories/block-definition-repository';

import type { BlockDefinitionModel } from '@flows/contracts';

/**
 * Block Catalog Service — scope-aware, approval-filtered.
 *
 * Catalog is the source of truth for what blocks EXIST (metadata/contract).
 * Registry (block-registry) is the source of truth for RUNTIME executors.
 * These are separate concerns.
 *
 * Scope policy:
 *   - workspaceId=null → global (visible to all)
 *   - workspaceId=X → visible only in workspace X (+ global)
 *   - approved=false → hidden from default queries
 */

interface CatalogQueryOptions {
    workspaceId?: string | null; // null = global only
    includeUnapproved?: boolean; // default false
}

function matchesScope(def: BlockDefinitionModel, opts: CatalogQueryOptions): boolean {
    // Approval filter (default: approved only)
    if (!opts.includeUnapproved && !def.approved) return false;

    // Scope filter
    if (!def.workspaceId) return true; // global → always visible
    if (opts.workspaceId && def.workspaceId === opts.workspaceId) return true; // workspace match
    return false; // workspace-specific, not matching
}

export const blockCatalogService = {
    /** List all latest approved block definitions, scoped. */
    async listAvailable(opts: CatalogQueryOptions = {}): Promise<BlockDefinitionModel[]> {
        const all = await blockDefRepo.listLatest();
        return all.filter(def => matchesScope(def, opts));
    },

    /** Get latest approved definition by type, scoped. */
    async getByType(type: string, opts: CatalogQueryOptions = {}): Promise<BlockDefinitionModel | null> {
        const def = await blockDefRepo.getLatest(type);
        if (!def) return null;
        if (!matchesScope(def, opts)) return null;
        return def;
    },

    /** Get specific version (no scope filter — for internal/admin use). */
    async getByVersion(type: string, version: string): Promise<BlockDefinitionModel | null> {
        return blockDefRepo.getByVersion(type, version);
    },

    /** List all versions of a type (admin/debug). */
    async listVersions(type: string): Promise<BlockDefinitionModel[]> {
        return blockDefRepo.listVersions(type);
    },

    /** Register a block definition (domain packs at startup, or proposal approval). */
    async register(def: BlockDefinitionModel): Promise<void> {
        const existing = await blockDefRepo.getLatest(def.type);
        if (existing && existing.version !== def.version) {
            await blockDefRepo.put({ ...existing, isLatest: false, updatedAt: new Date().toISOString() });
        }
        await blockDefRepo.put({ ...def, isLatest: true });
    },

    /** Bulk register. */
    async registerBulk(defs: BlockDefinitionModel[]): Promise<void> {
        for (const def of defs) {
            await this.register(def);
        }
    },

    /** Count of available definitions (scoped). */
    async count(opts: CatalogQueryOptions = {}): Promise<number> {
        const all = await this.listAvailable(opts);
        return all.length;
    },
};
