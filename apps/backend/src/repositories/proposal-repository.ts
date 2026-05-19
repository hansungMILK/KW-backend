import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { stripRetentionTtl, withRetentionTtl } from './retention';
import { TableNames, USE_REAL_DYNAMO, getDocClient, memDb } from '../adapters/aws/dynamodb';

import type { Proposal } from '@flows/contracts';

const TABLE = USE_REAL_DYNAMO ? TableNames.proposals : 'proposals';

export const proposalRepo = {
    async listByFlow(flowId: string): Promise<Proposal[]> {
        if (USE_REAL_DYNAMO) {
            const result = await getDocClient().send(
                new QueryCommand({
                    TableName: TABLE,
                    IndexName: 'flowId-createdAt-index',
                    KeyConditionExpression: 'flowId = :fid',
                    ExpressionAttributeValues: { ':fid': flowId },
                    ScanIndexForward: true,
                })
            );
            return (result.Items || []).map(item =>
                stripRetentionTtl(item as Record<string, unknown>)
            ) as unknown as Proposal[];
        }

        const all = memDb.query(
            TABLE,
            item => (item as { flowId?: string }).flowId === flowId
        ) as unknown as Proposal[];
        all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        return all;
    },

    async get(proposalId: string): Promise<Proposal | null> {
        if (USE_REAL_DYNAMO) {
            const result = await getDocClient().send(
                new GetCommand({
                    TableName: TABLE,
                    Key: { proposalId },
                })
            );
            return result.Item
                ? (stripRetentionTtl(result.Item as Record<string, unknown>) as unknown as Proposal)
                : null;
        }
        return (memDb.get(TABLE, proposalId) as unknown as Proposal) ?? null;
    },

    async put(proposal: Proposal): Promise<void> {
        if (USE_REAL_DYNAMO) {
            await getDocClient().send(
                new PutCommand({
                    TableName: TABLE,
                    Item: withRetentionTtl(proposal as unknown as Record<string, unknown>, proposal.createdAt),
                })
            );
            return;
        }
        memDb.put(TABLE, proposal.proposalId, proposal as unknown as Record<string, unknown>);
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

    /**
     * Delete all proposals belonging to a flow. Returns the count deleted.
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
                    ProjectionExpression: 'proposalId',
                })
            );
            const items = (result.Items || []) as Array<{ proposalId?: string }>;
            await Promise.all(
                items
                    .filter(item => item.proposalId)
                    .map(item =>
                        getDocClient().send(
                            new DeleteCommand({
                                TableName: TABLE,
                                Key: { proposalId: item.proposalId },
                            })
                        )
                    )
            );
            return items.filter(item => item.proposalId).length;
        }

        const owned = memDb.query(
            TABLE,
            item => (item as { flowId?: string }).flowId === flowId
        ) as unknown as Proposal[];
        for (const p of owned) {
            memDb.delete(TABLE, p.proposalId);
        }
        return owned.length;
    },
};
