import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { stripRetentionTtl, withRetentionTtl } from './retention';
import { TableNames, USE_REAL_DYNAMO, getDocClient, memDb } from '../adapters/aws/dynamodb';

import type { Message } from '@flows/contracts';

/**
 * Messages are stored by messageId.
 * DynamoDB lists a flow's chat history through flowId-createdAt-index.
 */

const TABLE = USE_REAL_DYNAMO ? TableNames.messages : 'messages'; // separate from flows table

export const messageRepo = {
    async listByFlow(flowId: string, limit = 50): Promise<{ items: Message[]; nextCursor: string | null }> {
        if (USE_REAL_DYNAMO) {
            const result = await getDocClient().send(
                new QueryCommand({
                    TableName: TABLE,
                    IndexName: 'flowId-createdAt-index',
                    KeyConditionExpression: 'flowId = :fid',
                    ExpressionAttributeValues: { ':fid': flowId },
                    ScanIndexForward: true,
                    Limit: limit,
                })
            );
            const items = (result.Items || []).map(item =>
                stripRetentionTtl(item as Record<string, unknown>)
            ) as unknown as Message[];
            return { items, nextCursor: null };
        }

        const all = memDb.query(TABLE, item => (item as { flowId?: string }).flowId === flowId) as unknown as Message[];
        // Sort by createdAt ascending
        all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        const items = all.slice(0, limit);
        return { items, nextCursor: null };
    },

    async put(message: Message): Promise<void> {
        if (USE_REAL_DYNAMO) {
            await getDocClient().send(
                new PutCommand({
                    TableName: TABLE,
                    Item: withRetentionTtl(message as unknown as Record<string, unknown>, message.createdAt),
                })
            );
            return;
        }
        memDb.put(TABLE, message.messageId, message as unknown as Record<string, unknown>);
    },

    async get(messageId: string): Promise<Message | null> {
        if (USE_REAL_DYNAMO) {
            const result = await getDocClient().send(
                new GetCommand({
                    TableName: TABLE,
                    Key: { messageId },
                })
            );
            return result.Item
                ? (stripRetentionTtl(result.Item as Record<string, unknown>) as unknown as Message)
                : null;
        }
        return (memDb.get(TABLE, messageId) as unknown as Message) ?? null;
    },

    /**
     * Delete all messages belonging to a flow. Returns the count deleted.
     * Used by Flow cascade delete (audit #7). Idempotent — returns 0 if none.
     */
    async deleteByFlowId(flowId: string): Promise<number> {
        if (USE_REAL_DYNAMO) {
            const result = await getDocClient().send(
                new QueryCommand({
                    TableName: TABLE,
                    IndexName: 'flowId-createdAt-index',
                    KeyConditionExpression: 'flowId = :fid',
                    ExpressionAttributeValues: { ':fid': flowId },
                    ProjectionExpression: 'messageId',
                })
            );
            const items = (result.Items || []) as Array<{ messageId?: string }>;
            await Promise.all(
                items
                    .filter(item => item.messageId)
                    .map(item =>
                        getDocClient().send(
                            new DeleteCommand({
                                TableName: TABLE,
                                Key: { messageId: item.messageId },
                            })
                        )
                    )
            );
            return items.filter(item => item.messageId).length;
        }

        const owned = memDb.query(
            TABLE,
            item => (item as { flowId?: string }).flowId === flowId
        ) as unknown as Message[];
        for (const msg of owned) {
            memDb.delete(TABLE, msg.messageId);
        }
        return owned.length;
    },
};
