import { DeleteCommand, GetCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

import { TableNames, USE_REAL_DYNAMO, getDocClient, memDb } from '../adapters/aws/dynamodb';
import { generateNumericId } from '../utils/id-generator';

export interface FlowRecord {
    id: string;
    name?: string;
    state?: string;
    stereo?: string;
    description?: string;
    scenario?: string;
    ownerId?: string;
    nodes: unknown[];
    edges: unknown[];
    channelId?: string;
    createdAt: string;
    updatedAt: string;
}

const TABLE = TableNames.flows;

// ============================================================================
// FlowStatus normalization — single source of truth
// ============================================================================

/** Canonical flow status values (always uppercase). */
export type FlowStatus = 'DRAFT' | 'READY' | 'ARCHIVED';

const STATUS_NORMALIZE: Record<string, FlowStatus> = {
    draft: 'DRAFT',
    DRAFT: 'DRAFT',
    active: 'READY', // compat alias
    ACTIVE: 'READY',
    ready: 'READY',
    READY: 'READY',
    archived: 'ARCHIVED',
    ARCHIVED: 'ARCHIVED',
};

/** Normalize any state string to canonical FlowStatus. Unknown → DRAFT. */
export const normalizeFlowStatus = (state?: string): FlowStatus => STATUS_NORMALIZE[state ?? ''] ?? 'DRAFT';

/** Normalize a FlowRecord's state before returning. */
const normalizeRecord = (record: FlowRecord): FlowRecord => ({
    ...record,
    state: normalizeFlowStatus(record.state),
});

// ============================================================================
// Repository — auto-selects DynamoDB or in-memory based on environment
// ============================================================================

export interface ListFlowsOptions {
    limit?: number;
    ownerId?: string;
    nextToken?: string;
}

export interface ListFlowsResult {
    items: FlowRecord[];
    nextToken?: string;
}

export const flowRepo = {
    async get(id: string): Promise<FlowRecord | null> {
        let record: FlowRecord | null;
        if (!USE_REAL_DYNAMO) {
            record = (memDb.get(TABLE, id) as unknown as FlowRecord) ?? null;
        } else {
            const result = await getDocClient().send(new GetCommand({ TableName: TABLE, Key: { id } }));
            record = (result.Item as FlowRecord) ?? null;
        }
        return record ? normalizeRecord(record) : null;
    },

    async put(record: FlowRecord): Promise<void> {
        // Always store normalized state
        const normalized = { ...record, state: normalizeFlowStatus(record.state) };
        if (!USE_REAL_DYNAMO) {
            memDb.put(TABLE, normalized.id, normalized as unknown as Record<string, unknown>);
            return;
        }
        await getDocClient().send(new PutCommand({ TableName: TABLE, Item: normalized }));
    },

    async scan(): Promise<FlowRecord[]> {
        let items: FlowRecord[];
        if (!USE_REAL_DYNAMO) {
            items = memDb.scan(TABLE) as unknown as FlowRecord[];
        } else {
            const result = await getDocClient().send(new ScanCommand({ TableName: TABLE }));
            items = (result.Items || []) as FlowRecord[];
        }
        return items.map(normalizeRecord);
    },

    async list(options: ListFlowsOptions = {}): Promise<ListFlowsResult> {
        const limit = options.limit && options.limit > 0 ? options.limit : 50;

        let items: FlowRecord[];
        let nextToken: string | undefined;

        if (!USE_REAL_DYNAMO) {
            let all = memDb.scan(TABLE) as unknown as FlowRecord[];
            if (options.ownerId) {
                all = all.filter(f => f.ownerId === options.ownerId);
            }

            let startIndex = 0;
            if (options.nextToken) {
                // In mock we just find the item after the token
                const idx = all.findIndex(f => f.id === options.nextToken);
                if (idx !== -1) startIndex = idx;
            }

            const paged = all.slice(startIndex, startIndex + limit);
            items = paged;

            if (startIndex + limit < all.length) {
                nextToken = all[startIndex + limit]?.id;
            }
        } else {
            const params: any = {
                TableName: TABLE,
                Limit: limit,
            };
            if (options.ownerId) {
                params.FilterExpression = 'ownerId = :ownerId';
                params.ExpressionAttributeValues = { ':ownerId': options.ownerId };
            }
            if (options.nextToken) {
                params.ExclusiveStartKey = { id: options.nextToken };
            }

            const result = await getDocClient().send(new ScanCommand(params));
            items = (result.Items || []) as FlowRecord[];
            if (result.LastEvaluatedKey?.id) {
                nextToken = result.LastEvaluatedKey.id;
            }
        }

        return { items: items.map(normalizeRecord), nextToken };
    },

    async save(id: string, nodes: unknown[], edges: unknown[]): Promise<FlowRecord> {
        const now = new Date().toISOString();

        if (id === '0') {
            // Create new flow
            const record: FlowRecord = {
                id: generateNumericId(),
                name: 'Untitled Flow',
                state: 'DRAFT',
                nodes,
                edges,
                channelId: generateNumericId(),
                createdAt: now,
                updatedAt: now,
            };
            await this.put(record);
            return record;
        }

        // Update existing or create with given id
        const existing = await this.get(id);
        const record: FlowRecord = {
            id,
            name: existing?.name ?? 'Untitled Flow',
            state: existing?.state ?? 'DRAFT',
            stereo: existing?.stereo,
            description: existing?.description,
            nodes,
            edges,
            channelId: existing?.channelId ?? generateNumericId(),
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        };
        await this.put(record);
        return record;
    },

    async updateMeta(id: string, fields: { name?: string }): Promise<FlowRecord | null> {
        const existing = await this.get(id);
        if (!existing) return null;

        const updated: FlowRecord = {
            ...existing,
            ...fields,
            updatedAt: new Date().toISOString(),
        };
        await this.put(updated);
        return updated;
    },

    // ── Product API methods ──────────────────────────────────────────────────

    async delete(id: string): Promise<boolean> {
        const existing = await this.get(id);
        if (!existing) return false;

        if (!USE_REAL_DYNAMO) {
            memDb.delete(TABLE, id);
            return true;
        }
        await getDocClient().send(new DeleteCommand({ TableName: TABLE, Key: { id } }));
        return true;
    },

    async create(fields: {
        title: string;
        description?: string;
        scenario?: string;
        ownerId?: string;
    }): Promise<FlowRecord> {
        const now = new Date().toISOString();
        const record: FlowRecord = {
            id: generateNumericId(),
            name: fields.title,
            state: 'DRAFT',
            description: fields.description,
            scenario: fields.scenario,
            ownerId: fields.ownerId,
            nodes: [],
            edges: [],
            channelId: generateNumericId(),
            createdAt: now,
            updatedAt: now,
        };
        await this.put(record);
        return record;
    },

    async updateCanvas(
        id: string,
        data: { title?: string; description?: string; nodes: unknown[]; edges: unknown[] }
    ): Promise<FlowRecord | null> {
        const existing = await this.get(id);
        if (!existing) return null;

        const now = new Date().toISOString();
        // Auto status transition: nodes >= 1 → READY (if currently DRAFT)
        // existing.state is already normalized by get()
        let newState = existing.state;
        if (data.nodes.length >= 1 && normalizeFlowStatus(existing.state) === 'DRAFT') {
            newState = 'READY';
        }

        const updated: FlowRecord = {
            ...existing,
            name: data.title ?? existing.name,
            description: data.description ?? existing.description,
            nodes: data.nodes,
            edges: data.edges,
            state: newState,
            updatedAt: now,
        };
        await this.put(updated);
        return updated;
    },

    async updateState(id: string, newState: string): Promise<FlowRecord | null> {
        const existing = await this.get(id);
        if (!existing) return null;

        const updated: FlowRecord = {
            ...existing,
            state: newState,
            updatedAt: new Date().toISOString(),
        };
        await this.put(updated);
        return updated;
    },
};
