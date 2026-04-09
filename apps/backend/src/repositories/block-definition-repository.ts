import { memDb } from '../adapters/aws/dynamodb';

import type { BlockDefinitionModel } from '@flows/contracts';

const TABLE = 'block-definitions';

export const blockDefRepo = {
    async put(def: BlockDefinitionModel): Promise<void> {
        const key = `${def.type}#${def.version}`;
        memDb.put(TABLE, key, def as unknown as Record<string, unknown>);
    },

    async getLatest(type: string): Promise<BlockDefinitionModel | null> {
        const all = memDb.query(
            TABLE,
            item => (item as { type?: string }).type === type && (item as { isLatest?: boolean }).isLatest === true
        );
        return (all[0] as unknown as BlockDefinitionModel) ?? null;
    },

    async getByVersion(type: string, version: string): Promise<BlockDefinitionModel | null> {
        const key = `${type}#${version}`;
        return (memDb.get(TABLE, key) as unknown as BlockDefinitionModel) ?? null;
    },

    async listLatest(): Promise<BlockDefinitionModel[]> {
        const all = memDb.query(TABLE, item => (item as { isLatest?: boolean }).isLatest === true);
        return all as unknown as BlockDefinitionModel[];
    },

    async listByCategory(category: string): Promise<BlockDefinitionModel[]> {
        const all = memDb.query(
            TABLE,
            item =>
                (item as { category?: string }).category === category &&
                (item as { isLatest?: boolean }).isLatest === true
        );
        return all as unknown as BlockDefinitionModel[];
    },

    async listVersions(type: string): Promise<BlockDefinitionModel[]> {
        const all = memDb.query(TABLE, item => (item as { type?: string }).type === type);
        return (all as unknown as BlockDefinitionModel[]).sort((a, b) => b.version.localeCompare(a.version));
    },
};
