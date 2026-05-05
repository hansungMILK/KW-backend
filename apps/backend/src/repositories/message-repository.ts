import { memDb } from '../adapters/aws/dynamodb';

import type { Message } from '@flows/contracts';

/**
 * Messages are stored keyed by flowId, with an array of messages per flow.
 * In DynamoDB: PK=flowId, SK=messageId. Here we simulate with file-based store.
 */

const TABLE = 'messages'; // separate from flows table

export const messageRepo = {
    async listByFlow(flowId: string, limit = 50): Promise<{ items: Message[]; nextCursor: string | null }> {
        const all = memDb.query(TABLE, item => (item as { flowId?: string }).flowId === flowId) as unknown as Message[];
        // Sort by createdAt ascending
        all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        const items = all.slice(0, limit);
        return { items, nextCursor: null };
    },

    async put(message: Message): Promise<void> {
        memDb.put(TABLE, message.messageId, message as unknown as Record<string, unknown>);
    },

    async get(messageId: string): Promise<Message | null> {
        return (memDb.get(TABLE, messageId) as unknown as Message) ?? null;
    },

    /**
     * Delete all messages belonging to a flow. Returns the count deleted.
     * Used by Flow cascade delete (audit #7). Idempotent — returns 0 if none.
     */
    async deleteByFlowId(flowId: string): Promise<number> {
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
