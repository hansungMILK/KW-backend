import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { TableNames, USE_REAL_DYNAMO, getDocClient, memDb } from '../adapters/aws/dynamodb';

import type { Asset } from '@flows/contracts';

const TABLE = USE_REAL_DYNAMO ? TableNames.assets : 'assets';

export const assetRepo = {
    async put(asset: Asset): Promise<void> {
        if (!USE_REAL_DYNAMO) {
            memDb.put(TABLE, asset.assetId, asset as unknown as Record<string, unknown>);
            return;
        }
        await getDocClient().send(new PutCommand({ TableName: TABLE, Item: asset }));
    },

    async get(assetId: string): Promise<Asset | null> {
        if (!USE_REAL_DYNAMO) {
            return (memDb.get(TABLE, assetId) as unknown as Asset) ?? null;
        }
        const result = await getDocClient().send(new GetCommand({ TableName: TABLE, Key: { assetId } }));
        return (result.Item as Asset) ?? null;
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
            all = (result.Items || []) as Asset[];
        }
        all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        return all;
    },
};
