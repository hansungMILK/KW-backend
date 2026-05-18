import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { stripRetentionTtl, withRetentionTtl } from './retention';
import { TableNames, USE_REAL_DYNAMO, getDocClient, memDb } from '../adapters/aws/dynamodb';

import type { Trace } from '@flows/contracts';

const TABLE = USE_REAL_DYNAMO ? TableNames.traces : 'traces';

/**
 * Compose the sparse GSI hash for node-scoped queries.
 * Returns undefined when runNodeId is missing so the item is excluded
 * from the runNodeKey-occurredAt-index (sparse GSI behavior).
 */
function computeRunNodeKey(trace: Trace): string | undefined {
    if (!trace.runNodeId) return undefined;
    return `${trace.runId}#${trace.runNodeId}`;
}

export const traceRepo = {
    async put(trace: Trace): Promise<void> {
        // Attach the composite sparse key so listByRunNode can use a real GSI.
        const runNodeKey = computeRunNodeKey(trace);
        const item: Record<string, unknown> = { ...trace };
        if (runNodeKey) item['runNodeKey'] = runNodeKey;

        if (!USE_REAL_DYNAMO) {
            memDb.put(TABLE, trace.traceId, item);
            return;
        }
        await getDocClient().send(new PutCommand({ TableName: TABLE, Item: withRetentionTtl(item, trace.occurredAt) }));
    },

    async listByRun(
        runId: string,
        limit?: number,
        cursor?: string
    ): Promise<{ items: Trace[]; nextCursor: string | null }> {
        const maxItems = limit ?? 100;

        if (!USE_REAL_DYNAMO) {
            let all = memDb.query(TABLE, item => (item as { runId?: string }).runId === runId) as unknown as Trace[];
            all.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
            if (cursor) {
                const idx = all.findIndex(t => t.traceId === cursor);
                if (idx >= 0) all = all.slice(idx + 1);
            }
            const page = all.slice(0, maxItems + 1);
            const hasMore = page.length > maxItems;
            const items = hasMore ? page.slice(0, maxItems) : page;
            return { items, nextCursor: hasMore ? items[items.length - 1].traceId : null };
        }

        // DynamoDB: Query GSI with native cursor
        const exclusiveStartKey = cursor ? JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8')) : undefined;
        const result = await getDocClient().send(
            new QueryCommand({
                TableName: TABLE,
                IndexName: 'runId-occurredAt-index',
                KeyConditionExpression: 'runId = :rid',
                ExpressionAttributeValues: { ':rid': runId },
                ScanIndexForward: true,
                Limit: maxItems,
                ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
            })
        );
        const items = (result.Items || []).map(item =>
            stripRetentionTtl(item as Record<string, unknown>)
        ) as unknown as Trace[];
        const nextCursor = result.LastEvaluatedKey
            ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
            : null;
        return { items, nextCursor };
    },

    async listByRunNode(
        runId: string,
        nodeId: string,
        limit?: number,
        cursor?: string
    ): Promise<{ items: Trace[]; nextCursor: string | null }> {
        const maxItems = limit ?? 50;

        if (!USE_REAL_DYNAMO) {
            let all = memDb.query(
                TABLE,
                item =>
                    (item as { runId?: string }).runId === runId &&
                    (item as { runNodeId?: string }).runNodeId === nodeId
            ) as unknown as Trace[];
            all.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
            if (cursor) {
                const idx = all.findIndex(t => t.traceId === cursor);
                if (idx >= 0) all = all.slice(idx + 1);
            }
            const page = all.slice(0, maxItems + 1);
            const hasMore = page.length > maxItems;
            const items = hasMore ? page.slice(0, maxItems) : page;
            return { items, nextCursor: hasMore ? items[items.length - 1].traceId : null };
        }

        // DynamoDB: direct Query on sparse GSI keyed by runNodeKey (no FilterExpression).
        const runNodeKey = `${runId}#${nodeId}`;
        const exclusiveStartKey = cursor ? JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8')) : undefined;
        const result = await getDocClient().send(
            new QueryCommand({
                TableName: TABLE,
                IndexName: 'runNodeKey-occurredAt-index',
                KeyConditionExpression: 'runNodeKey = :k',
                ExpressionAttributeValues: { ':k': runNodeKey },
                ScanIndexForward: true,
                Limit: maxItems,
                ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
            })
        );
        const items = (result.Items || []).map(item =>
            stripRetentionTtl(item as Record<string, unknown>)
        ) as unknown as Trace[];
        const nextCursor = result.LastEvaluatedKey
            ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
            : null;
        return { items, nextCursor };
    },
};
