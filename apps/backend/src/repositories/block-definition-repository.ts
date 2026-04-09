import { GetCommand, PutCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

import { TableNames, USE_REAL_DYNAMO, getDocClient, memDb } from '../adapters/aws/dynamodb';

import type { BlockDefinitionModel } from '@flows/contracts';

/**
 * Block Definition Repository — persisted catalog storage.
 *
 * DynamoDB model:
 *   PK = type (S), SK = version (S)
 *   GSI: category-index (PK=category, SK=createdAt)
 *
 * Access patterns:
 *   1. Latest by type:       PK=type, filter isLatest=true
 *   2. Exact version:        PK=type, SK=version
 *   3. All latest (catalog): Scan filter isLatest=true
 *   4. Versions by type:     PK=type (returns all versions)
 *   5. By category:          GSI category-index PK=category, filter isLatest=true
 *
 * Local mode: file-based memDb (key = type#version)
 * Prod mode:  real DynamoDB
 */

const MEM_TABLE = 'block-definitions';
const DYNAMO_TABLE = TableNames.blockDefinitions;

export const blockDefRepo = {
    async put(def: BlockDefinitionModel): Promise<void> {
        if (!USE_REAL_DYNAMO) {
            memDb.put(MEM_TABLE, `${def.type}#${def.version}`, def as unknown as Record<string, unknown>);
            return;
        }
        await getDocClient().send(new PutCommand({ TableName: DYNAMO_TABLE, Item: def as Record<string, unknown> }));
    },

    /** Access pattern 1: latest by type (isLatest=true) */
    async getLatest(type: string): Promise<BlockDefinitionModel | null> {
        if (!USE_REAL_DYNAMO) {
            const all = memDb.query(MEM_TABLE, item => {
                const r = item as { type?: string; isLatest?: boolean };
                return r.type === type && r.isLatest === true;
            });
            return (all[0] as unknown as BlockDefinitionModel) ?? null;
        }
        const result = await getDocClient().send(
            new QueryCommand({
                TableName: DYNAMO_TABLE,
                KeyConditionExpression: '#t = :type',
                FilterExpression: 'isLatest = :true',
                ExpressionAttributeNames: { '#t': 'type' },
                ExpressionAttributeValues: { ':type': type, ':true': true },
            })
        );
        return (result.Items?.[0] as BlockDefinitionModel) ?? null;
    },

    /** Access pattern 2: exact version */
    async getByVersion(type: string, version: string): Promise<BlockDefinitionModel | null> {
        if (!USE_REAL_DYNAMO) {
            return (memDb.get(MEM_TABLE, `${type}#${version}`) as unknown as BlockDefinitionModel) ?? null;
        }
        const result = await getDocClient().send(new GetCommand({ TableName: DYNAMO_TABLE, Key: { type, version } }));
        return (result.Item as BlockDefinitionModel) ?? null;
    },

    /** Access pattern 3: all latest definitions (catalog listing) */
    async listLatest(): Promise<BlockDefinitionModel[]> {
        if (!USE_REAL_DYNAMO) {
            return memDb.query(
                MEM_TABLE,
                item => (item as { isLatest?: boolean }).isLatest === true
            ) as unknown as BlockDefinitionModel[];
        }
        const result = await getDocClient().send(
            new ScanCommand({
                TableName: DYNAMO_TABLE,
                FilterExpression: 'isLatest = :true',
                ExpressionAttributeValues: { ':true': true },
            })
        );
        return (result.Items || []) as BlockDefinitionModel[];
    },

    /** Access pattern 4: all versions of a type */
    async listVersions(type: string): Promise<BlockDefinitionModel[]> {
        if (!USE_REAL_DYNAMO) {
            const all = memDb.query(
                MEM_TABLE,
                item => (item as { type?: string }).type === type
            ) as unknown as BlockDefinitionModel[];
            return all.sort((a, b) => b.version.localeCompare(a.version));
        }
        const result = await getDocClient().send(
            new QueryCommand({
                TableName: DYNAMO_TABLE,
                KeyConditionExpression: '#t = :type',
                ExpressionAttributeNames: { '#t': 'type' },
                ExpressionAttributeValues: { ':type': type },
                ScanIndexForward: false,
            })
        );
        return (result.Items || []) as BlockDefinitionModel[];
    },

    /** Access pattern 5: latest by category (GSI) */
    async listByCategory(category: string): Promise<BlockDefinitionModel[]> {
        if (!USE_REAL_DYNAMO) {
            return memDb.query(MEM_TABLE, item => {
                const r = item as { category?: string; isLatest?: boolean };
                return r.category === category && r.isLatest === true;
            }) as unknown as BlockDefinitionModel[];
        }
        const result = await getDocClient().send(
            new QueryCommand({
                TableName: DYNAMO_TABLE,
                IndexName: 'category-index',
                KeyConditionExpression: 'category = :cat',
                FilterExpression: 'isLatest = :true',
                ExpressionAttributeValues: { ':cat': category, ':true': true },
            })
        );
        return (result.Items || []) as BlockDefinitionModel[];
    },
};
