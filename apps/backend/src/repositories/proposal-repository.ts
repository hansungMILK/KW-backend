import { BatchWriteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { TableNames, USE_REAL_DYNAMO, getDocClient, memDb } from '../adapters/aws/dynamodb';

import type { Proposal } from '@flows/contracts';

const TABLE = USE_REAL_DYNAMO ? TableNames.proposals : 'proposals';

export const proposalRepo = {
    async listByFlow(flowId: string): Promise<Proposal[]> {
        let all: Proposal[];
        if (!USE_REAL_DYNAMO) {
            all = memDb.query(TABLE, item => (item as { flowId?: string }).flowId === flowId) as unknown as Proposal[];
        } else {
            const result = await getDocClient().send(
                new QueryCommand({
                    TableName: TABLE,
                    IndexName: 'flowId-createdAt-index',
                    KeyConditionExpression: 'flowId = :fid',
                    ExpressionAttributeValues: { ':fid': flowId },
                    ScanIndexForward: true,
                })
            );
            all = (result.Items || []) as Proposal[];
        }
        all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        return all;
    },

    async get(proposalId: string): Promise<Proposal | null> {
        if (!USE_REAL_DYNAMO) {
            return (memDb.get(TABLE, proposalId) as unknown as Proposal) ?? null;
        }
        const result = await getDocClient().send(new GetCommand({ TableName: TABLE, Key: { proposalId } }));
        return (result.Item as Proposal) ?? null;
    },

    async put(proposal: Proposal): Promise<void> {
        if (!USE_REAL_DYNAMO) {
            memDb.put(TABLE, proposal.proposalId, proposal as unknown as Record<string, unknown>);
            return;
        }
        await getDocClient().send(new PutCommand({ TableName: TABLE, Item: proposal }));
    },

    async updateStatus(proposalId: string, status: Proposal['status'], reason?: string): Promise<Proposal | null> {
        const existing = await this.get(proposalId);
        if (!existing) return null;
        const updated: Proposal = {
            ...existing,
            status,
            decisionReason: reason ?? existing.decisionReason,
            updatedAt: new Date().toISOString(),
        };
        await this.put(updated);
        return updated;
    },

    async deleteByFlow(flowId: string): Promise<number> {
        if (!USE_REAL_DYNAMO) {
            const all = memDb.query(
                TABLE,
                item => (item as { flowId?: string }).flowId === flowId
            ) as unknown as Proposal[];
            for (const p of all) {
                memDb.delete(TABLE, p.proposalId);
            }
            return all.length;
        }

        // DynamoDB: paginated Query on GSI + BatchWriteItem (25 per batch).
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
                    ProjectionExpression: 'proposalId',
                    ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
                })
            );
            for (const item of result.Items || []) {
                allIds.push((item as { proposalId: string }).proposalId);
            }
            exclusiveStartKey = result.LastEvaluatedKey;
        } while (exclusiveStartKey);

        // On retry exhaustion we MUST throw — swallowing unprocessed items would
        // leave orphaned proposals and let the caller report a successful delete.
        const MAX_ATTEMPTS = 5;
        for (let i = 0; i < allIds.length; i += 25) {
            const chunk = allIds.slice(i, i + 25);
            // Use `any` at the BatchWrite boundary — the SDK's generic WriteRequest
            // type does not narrow to our DeleteRequest-only shape.
            let requestItems: Record<string, any[]> = {
                [TABLE]: chunk.map(id => ({ DeleteRequest: { Key: { proposalId: id } } })),
            };

            let attempt = 0;
            for (; attempt < MAX_ATTEMPTS; attempt++) {
                const resp = await client.send(new BatchWriteCommand({ RequestItems: requestItems }));
                const unprocessed = resp.UnprocessedItems?.[TABLE];
                if (!unprocessed || unprocessed.length === 0) break;
                requestItems = { [TABLE]: unprocessed };
                const backoffMs = 2 ** attempt * 50 + Math.floor(Math.random() * 50);
                await new Promise(r => setTimeout(r, backoffMs));
            }

            if (attempt >= MAX_ATTEMPTS) {
                const leftover = (requestItems[TABLE] || []).length;
                throw new Error(
                    `[proposal-repository] deleteByFlow: ${leftover} unprocessed items remaining ` +
                        `after ${MAX_ATTEMPTS} BatchWrite attempts for flowId=${flowId}. ` +
                        `Aborting — delete is incomplete.`
                );
            }
        }

        return allIds.length;
    },
};
