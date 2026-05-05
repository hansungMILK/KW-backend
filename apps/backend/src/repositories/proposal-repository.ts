import { memDb } from '../adapters/aws/dynamodb';

import type { Proposal } from '@flows/contracts';

const TABLE = 'proposals';

export const proposalRepo = {
    async listByFlow(flowId: string): Promise<Proposal[]> {
        const all = memDb.query(
            TABLE,
            item => (item as { flowId?: string }).flowId === flowId
        ) as unknown as Proposal[];
        all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        return all;
    },

    async get(proposalId: string): Promise<Proposal | null> {
        return (memDb.get(TABLE, proposalId) as unknown as Proposal) ?? null;
    },

    async put(proposal: Proposal): Promise<void> {
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
