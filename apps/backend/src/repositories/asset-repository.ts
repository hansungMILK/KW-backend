import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { stripRetentionTtl, withRetentionTtl } from './retention';
import { TableNames, USE_REAL_DYNAMO, getDocClient, memDb } from '../adapters/aws/dynamodb';

import type { Asset } from '@flows/contracts';

const TABLE = USE_REAL_DYNAMO ? TableNames.assets : 'assets';

export const assetRepo = {
    async put(asset: Asset): Promise<void> {
        if (!USE_REAL_DYNAMO) {
            memDb.put(TABLE, asset.assetId, asset as unknown as Record<string, unknown>);
            return;
        }
        await getDocClient().send(
            new PutCommand({
                TableName: TABLE,
                Item: withRetentionTtl(asset as unknown as Record<string, unknown>, asset.createdAt),
            })
        );
    },

    async get(assetId: string): Promise<Asset | null> {
        if (!USE_REAL_DYNAMO) {
            return (memDb.get(TABLE, assetId) as unknown as Asset) ?? null;
        }
        const result = await getDocClient().send(new GetCommand({ TableName: TABLE, Key: { assetId } }));
        if (!result.Item) return null;
        return stripRetentionTtl(result.Item as Record<string, unknown>) as unknown as Asset;
    },

    async delete(assetId: string): Promise<void> {
        if (!USE_REAL_DYNAMO) {
            memDb.delete(TABLE, assetId);
            return;
        }
        await getDocClient().send(new DeleteCommand({ TableName: TABLE, Key: { assetId } }));
    },

    async updateStatus(assetId: string, status: Asset['status']): Promise<Asset> {
        const asset = await this.get(assetId);
        if (!asset) throw new Error(`Asset ${assetId} not found`);

        const updated: Asset = { ...asset, status };
        await this.put(updated);
        return updated;
    },

    async listByRun(runId: string): Promise<Asset[]> {
        let all: Asset[];
        if (!USE_REAL_DYNAMO) {
            all = memDb.query(TABLE, item => (item as { runId?: string }).runId === runId) as unknown as Asset[];
        } else {
            const result = await getDocClient().send(
                new QueryCommand({
                    TableName: TABLE,
                    IndexName: 'runId-createdAt-index',
                    KeyConditionExpression: 'runId = :rid',
                    ExpressionAttributeValues: { ':rid': runId },
                    ScanIndexForward: true,
                })
            );
            all = (result.Items || []).map(item =>
                stripRetentionTtl(item as Record<string, unknown>)
            ) as unknown as Asset[];
        }
        all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        return all;
    },
};
