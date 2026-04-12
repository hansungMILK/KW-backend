import { BatchWriteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { TableNames, USE_REAL_DYNAMO, getDocClient, memDb } from '../adapters/aws/dynamodb';

import type { Message } from '@flows/contracts';

const TABLE = USE_REAL_DYNAMO ? TableNames.messages : 'messages';

export const messageRepo = {
    async listByFlow(
        flowId: string,
        limit = 50,
        cursor?: string
    ): Promise<{ items: Message[]; nextCursor: string | null }> {
        if (!USE_REAL_DYNAMO) {
            let all = memDb.query(
                TABLE,
                item => (item as { flowId?: string }).flowId === flowId
            ) as unknown as Message[];
            all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
            if (cursor) {
                const idx = all.findIndex(m => m.messageId === cursor);
                if (idx >= 0) all = all.slice(idx + 1);
            }
            const page = all.slice(0, limit + 1);
            const hasMore = page.length > limit;
            const items = hasMore ? page.slice(0, limit) : page;
            return { items, nextCursor: hasMore ? items[items.length - 1].messageId : null };
        }

        // DynamoDB: Query GSI with native cursor
        const exclusiveStartKey = cursor ? JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8')) : undefined;
        const result = await getDocClient().send(
            new QueryCommand({
                TableName: TABLE,
                IndexName: 'flowId-createdAt-index',
                KeyConditionExpression: 'flowId = :fid',
                ExpressionAttributeValues: { ':fid': flowId },
                ScanIndexForward: true,
                Limit: limit,
                ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
            })
        );
        const items = (result.Items || []) as Message[];
        const nextCursor = result.LastEvaluatedKey
            ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
            : null;
        return { items, nextCursor };
    },

    async put(message: Message): Promise<void> {
        if (!USE_REAL_DYNAMO) {
            memDb.put(TABLE, message.messageId, message as unknown as Record<string, unknown>);
            return;
        }
        await getDocClient().send(new PutCommand({ TableName: TABLE, Item: message }));
    },

    async get(messageId: string): Promise<Message | null> {
        if (!USE_REAL_DYNAMO) {
            return (memDb.get(TABLE, messageId) as unknown as Message) ?? null;
        }
        const result = await getDocClient().send(new GetCommand({ TableName: TABLE, Key: { messageId } }));
        return (result.Item as Message) ?? null;
    },

    async deleteByFlow(flowId: string): Promise<number> {
        if (!USE_REAL_DYNAMO) {
            const all = memDb.query(
                TABLE,
                item => (item as { flowId?: string }).flowId === flowId
            ) as unknown as Message[];
            for (const msg of all) {
                memDb.delete(TABLE, msg.messageId);
            }
            return all.length;
        }

        // DynamoDB: paginated Query on GSI + BatchWriteItem (25 per batch).
        // Handles unbounded result sets safely.
        const client = getDocClient();
        const allIds: string[] = [];
        let exclusiveStartKey: Record<string, unknown> | undefined = undefined;

        do {
            const result: {
                Items?: Record<string, unknown>[];
                LastEvaluatedKey?: Record<string, unknown>;
            } = await client.send(
                new QueryCommand({
                    TableName: TABLE,
                    IndexName: 'flowId-createdAt-index',
                    KeyConditionExpression: 'flowId = :fid',
                    ExpressionAttributeValues: { ':fid': flowId },
                    ProjectionExpression: 'messageId',
                    ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
                })
            );
            for (const item of result.Items || []) {
                allIds.push((item as { messageId: string }).messageId);
            }
            exclusiveStartKey = result.LastEvaluatedKey;
        } while (exclusiveStartKey);

        // Batch delete in chunks of 25 (DynamoDB limit).
        // On retry exhaustion we MUST throw — swallowing unprocessed items would
        // leave orphaned messages and let the caller report a successful flow delete.
        const MAX_ATTEMPTS = 5;
        for (let i = 0; i < allIds.length; i += 25) {
            const chunk = allIds.slice(i, i + 25);
            // Use `any` at the BatchWrite boundary — the SDK's generic WriteRequest
            // type does not narrow to our DeleteRequest-only shape.
            let requestItems: Record<string, any[]> = {
                [TABLE]: chunk.map(id => ({ DeleteRequest: { Key: { messageId: id } } })),
            };

            let attempt = 0;
            for (; attempt < MAX_ATTEMPTS; attempt++) {
                const resp = await client.send(new BatchWriteCommand({ RequestItems: requestItems }));
                const unprocessed = resp.UnprocessedItems?.[TABLE];
                if (!unprocessed || unprocessed.length === 0) break;
                requestItems = { [TABLE]: unprocessed };
                // Exponential backoff with jitter — DynamoDB throttling is the usual cause.
                const backoffMs = 2 ** attempt * 50 + Math.floor(Math.random() * 50);
                await new Promise(r => setTimeout(r, backoffMs));
            }

            if (attempt >= MAX_ATTEMPTS) {
                const leftover = (requestItems[TABLE] || []).length;
                throw new Error(
                    `[message-repository] deleteByFlow: ${leftover} unprocessed items remaining ` +
                        `after ${MAX_ATTEMPTS} BatchWrite attempts for flowId=${flowId}. ` +
                        `Aborting — delete is incomplete.`
                );
            }
        }

        return allIds.length;
    },
};
