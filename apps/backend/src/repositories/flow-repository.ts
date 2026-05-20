import { DeleteCommand, GetCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

import { assetRepo } from './asset-repository';
import { messageRepo } from './message-repository';
import { proposalRepo } from './proposal-repository';
import { runRepo } from './run-repository';
import { traceRepo } from './trace-repository';
import { TableNames, USE_REAL_DYNAMO, getDocClient, memDb } from '../adapters/aws/dynamodb';
import { deleteObject } from '../adapters/aws/s3';
import {
    getFlowNodeBlockType,
    getFlowNodeId,
    isStoredPortNode,
    sanitizeCanvasNodesForStorage,
} from '../utils/flow-node-classification';
import { generateNumericId } from '../utils/id-generator';

import type { Asset, Run } from '@flows/contracts';

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

const preserveExistingPortNodes = (incomingNodes: unknown[], existingNodes: unknown[]): unknown[] => {
    const visualNodes = sanitizeCanvasNodesForStorage(incomingNodes);
    const visualNodeIds = new Set(visualNodes.map(getFlowNodeId).filter(Boolean));
    const existingPorts = existingNodes.filter(node => {
        if (!isStoredPortNode(node)) return false;
        const parentId = String(node['parentId'] ?? '');
        return parentId && visualNodeIds.has(parentId);
    });

    return [...visualNodes, ...existingPorts];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value != null && typeof value === 'object' && !Array.isArray(value);

const hasMeaningfulConfig = (value: unknown): boolean =>
    isRecord(value) ? Object.keys(value).length > 0 : value !== undefined && value !== null;

const ACTIVE_RUN_STATUSES = new Set<Run['status']>(['QUEUED', 'RUNNING']);

const getAssetStorageKey = (asset: Asset): string | null => {
    const metadataKey = asset.metadata?.['s3Key'];
    if (typeof metadataKey === 'string' && metadataKey.length > 0) return metadataKey;

    if (typeof asset.publicUrl === 'string' && asset.publicUrl.startsWith('s3://')) {
        const key = asset.publicUrl.replace(/^s3:\/\/[^/]+\//, '');
        return key.length > 0 ? key : null;
    }

    return null;
};

const listAllRunsByFlow = async (flowId: string): Promise<Run[]> => {
    const runs: Run[] = [];
    let cursor: string | null = null;
    do {
        const page = await runRepo.listByFlow(flowId, 100, cursor ?? undefined);
        runs.push(...page.items);
        cursor = page.nextCursor;
    } while (cursor);
    return runs;
};

const mergeNodeData = (incomingData: unknown, existingData: unknown): Record<string, unknown> | undefined => {
    if (!isRecord(incomingData) && !isRecord(existingData)) return undefined;
    const merged = {
        ...(isRecord(existingData) ? existingData : {}),
        ...(isRecord(incomingData) ? incomingData : {}),
    };
    const incomingConfig = isRecord(incomingData) ? incomingData['config'] : undefined;
    const existingConfig = isRecord(existingData) ? existingData['config'] : undefined;
    if (!hasMeaningfulConfig(incomingConfig) && hasMeaningfulConfig(existingConfig)) {
        merged['config'] = existingConfig;
    }
    return merged;
};

export const mergeIncomingCanvasNodesWithExistingMetadata = (
    incomingNodes: unknown[],
    existingNodes: unknown[]
): unknown[] => {
    const existingById = new Map(
        existingNodes
            .filter(isRecord)
            .map(node => [getFlowNodeId(node), node] as const)
            .filter(([id]) => id.length > 0)
    );

    return sanitizeCanvasNodesForStorage(incomingNodes).map(node => {
        if (!isRecord(node)) return node;
        const existing = existingById.get(getFlowNodeId(node));
        if (!existing || getFlowNodeBlockType(existing) !== getFlowNodeBlockType(node)) {
            return node;
        }

        const merged: Record<string, unknown> = {
            ...existing,
            ...node,
        };

        for (const key of ['blockId', 'blockType', 'name', 'label']) {
            if (merged[key] === undefined || merged[key] === null || merged[key] === '') {
                merged[key] = existing[key];
            }
        }

        if (!hasMeaningfulConfig(node['config']) && hasMeaningfulConfig(existing['config'])) {
            merged['config'] = existing['config'];
        }

        const data = mergeNodeData(node['data'], existing['data']);
        if (data) merged['data'] = data;

        return merged;
    });
};

// ============================================================================
// Repository — auto-selects DynamoDB or in-memory based on environment
// ============================================================================

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

    async save(id: string, nodes: unknown[], edges: unknown[]): Promise<FlowRecord> {
        const now = new Date().toISOString();

        if (id === '0') {
            // Create new flow
            const flowId = generateNumericId();
            const record: FlowRecord = {
                id: flowId,
                name: 'Untitled Flow',
                state: 'DRAFT',
                nodes: sanitizeCanvasNodesForStorage(nodes),
                edges,
                channelId: flowId,
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
            nodes: sanitizeCanvasNodesForStorage(nodes),
            edges,
            channelId: existing?.channelId ?? id,
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
        const flowId = generateNumericId();
        const record: FlowRecord = {
            id: flowId,
            name: fields.title,
            state: 'DRAFT',
            description: fields.description,
            scenario: fields.scenario,
            ownerId: fields.ownerId,
            nodes: [],
            edges: [],
            channelId: flowId,
            createdAt: now,
            updatedAt: now,
        };
        await this.put(record);
        return record;
    },

    async updateCanvas(
        id: string,
        data: { title?: string; description?: string; nodes: unknown[]; edges: unknown[] },
        options: { preservePortNodes?: boolean } = {}
    ): Promise<FlowRecord | null> {
        const existing = await this.get(id);
        if (!existing) return null;

        const now = new Date().toISOString();
        const incomingVisualNodes = mergeIncomingCanvasNodesWithExistingMetadata(data.nodes, existing.nodes ?? []);
        // Auto status transition: nodes >= 1 → READY (if currently DRAFT)
        // existing.state is already normalized by get()
        let newState = existing.state;
        if (incomingVisualNodes.length >= 1 && normalizeFlowStatus(existing.state) === 'DRAFT') {
            newState = 'READY';
        }

        const nextNodes =
            options.preservePortNodes === false
                ? incomingVisualNodes
                : preserveExistingPortNodes(incomingVisualNodes, existing.nodes ?? []);

        const updated: FlowRecord = {
            ...existing,
            name: data.title ?? existing.name,
            description: data.description ?? existing.description,
            nodes: nextNodes,
            edges: data.edges,
            state: newState,
            updatedAt: now,
        };
        await this.put(updated);
        return updated;
    },

    /**
     * List flows with optional status filter + simple offset cursor pagination.
     *
     * P1 implementation: scan + in-memory sort/filter/slice.
     * P2 (audit #18): replace with GSI query (flowId+updatedAt) — owned by 강연경/민경욱.
     * The handler-side surface (limit/cursor/status, items+nextCursor) won't change.
     */
    async list(opts: {
        limit?: number;
        cursor?: string;
        status?: FlowStatus;
    }): Promise<{ items: FlowRecord[]; nextCursor?: string }> {
        const limit = Math.max(1, Math.min(opts.limit ?? 20, 100));
        const offset = opts.cursor ? Math.max(0, parseInt(opts.cursor, 10) || 0) : 0;

        const all = await this.scan();
        const filtered = opts.status ? all.filter(r => normalizeFlowStatus(r.state) === opts.status) : all;

        // Sort by updatedAt desc (newest first)
        filtered.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));

        const items = filtered.slice(offset, offset + limit);
        const nextOffset = offset + items.length;
        const nextCursor = nextOffset < filtered.length ? String(nextOffset) : undefined;

        return { items, nextCursor };
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

    // ── P2: lifecycle transitions ────────────────────────────────────────────

    /**
     * READY → ARCHIVED. Returns:
     * - { ok: true, flow } on success
     * - { ok: false, code: 'NOT_FOUND' } if flow missing
     * - { ok: false, code: 'INVALID_STATE', current } if not in READY
     *   (DRAFT cannot be archived — must reach READY first;
     *    ARCHIVED is already archived → 409 ALREADY_ARCHIVED at handler)
     */
    async archive(
        id: string
    ): Promise<
        | { ok: true; flow: FlowRecord }
        | { ok: false; code: 'NOT_FOUND' }
        | { ok: false; code: 'INVALID_STATE'; current: FlowStatus }
    > {
        const existing = await this.get(id);
        if (!existing) return { ok: false, code: 'NOT_FOUND' };

        const current = normalizeFlowStatus(existing.state);
        if (current !== 'READY') {
            return { ok: false, code: 'INVALID_STATE', current };
        }

        const updated: FlowRecord = {
            ...existing,
            state: 'ARCHIVED',
            updatedAt: new Date().toISOString(),
        };
        await this.put(updated);
        return { ok: true, flow: updated };
    },

    /** ARCHIVED → READY. Mirrors archive(). */
    async unarchive(
        id: string
    ): Promise<
        | { ok: true; flow: FlowRecord }
        | { ok: false; code: 'NOT_FOUND' }
        | { ok: false; code: 'INVALID_STATE'; current: FlowStatus }
    > {
        const existing = await this.get(id);
        if (!existing) return { ok: false, code: 'NOT_FOUND' };

        const current = normalizeFlowStatus(existing.state);
        if (current !== 'ARCHIVED') {
            return { ok: false, code: 'INVALID_STATE', current };
        }

        const updated: FlowRecord = {
            ...existing,
            state: 'READY',
            updatedAt: new Date().toISOString(),
        };
        await this.put(updated);
        return { ok: true, flow: updated };
    },

    /**
     * Duplicate a flow as DRAFT.
     * - New flowId + channelId
     * - title: "{원본} (복사본)"
     * - nodes/edges: deep-cloned (node ids preserved; canvas-loaded copies don't collide
     *   because they live in separate flows)
     * - state: DRAFT (forced, regardless of node count)
     */
    async duplicate(id: string): Promise<FlowRecord | null> {
        const existing = await this.get(id);
        if (!existing) return null;

        const now = new Date().toISOString();
        const copyId = generateNumericId();
        const copy: FlowRecord = {
            id: copyId,
            name: `${existing.name ?? 'Untitled Flow'} (복사본)`,
            state: 'DRAFT',
            stereo: existing.stereo,
            description: existing.description,
            scenario: existing.scenario,
            ownerId: existing.ownerId,
            // Deep-clone payload arrays so future edits don't bleed into the original.
            nodes: JSON.parse(JSON.stringify(existing.nodes ?? [])),
            edges: JSON.parse(JSON.stringify(existing.edges ?? [])),
            channelId: copyId,
            createdAt: now,
            updatedAt: now,
        };
        await this.put(copy);
        return copy;
    },

    /**
     * Delete flow + cascade-delete owned conversation history.
     * - Messages, Proposals: deleted (audit #7)
     * - Runs, Assets: preserved (history-of-record)
     */
    async deleteWithCascade(id: string): Promise<{
        deleted: boolean;
        messagesDeleted: number;
        proposalsDeleted: number;
        runsDeleted: number;
        runNodesDeleted: number;
        tracesDeleted: number;
        assetsDeleted: number;
        storageObjectsDeleted: number;
        activeRunCount: number;
    }> {
        const existing = await this.get(id);
        if (!existing) {
            return {
                deleted: false,
                messagesDeleted: 0,
                proposalsDeleted: 0,
                runsDeleted: 0,
                runNodesDeleted: 0,
                tracesDeleted: 0,
                assetsDeleted: 0,
                storageObjectsDeleted: 0,
                activeRunCount: 0,
            };
        }

        const runs = await listAllRunsByFlow(id);
        const activeRunCount = runs.filter(run => ACTIVE_RUN_STATUSES.has(run.status)).length;
        if (activeRunCount > 0) {
            return {
                deleted: false,
                messagesDeleted: 0,
                proposalsDeleted: 0,
                runsDeleted: 0,
                runNodesDeleted: 0,
                tracesDeleted: 0,
                assetsDeleted: 0,
                storageObjectsDeleted: 0,
                activeRunCount,
            };
        }

        let assetsDeleted = 0;
        let storageObjectsDeleted = 0;
        let runNodesDeleted = 0;
        let tracesDeleted = 0;

        for (const run of runs) {
            const assets = await assetRepo.listByRun(run.runId);
            const storageKeys = new Set(assets.map(getAssetStorageKey).filter((key): key is string => !!key));
            for (const key of storageKeys) {
                await deleteObject(key);
                storageObjectsDeleted += 1;
            }
            for (const asset of assets) {
                await assetRepo.delete(asset.assetId);
                assetsDeleted += 1;
            }
            tracesDeleted += await traceRepo.deleteByRun(run.runId);
            runNodesDeleted += await runRepo.deleteRunNodes(run.runId);
            await runRepo.deleteRun(run.runId);
        }

        const [messagesDeleted, proposalsDeleted] = await Promise.all([
            messageRepo.deleteByFlowId(id),
            proposalRepo.deleteByFlowId(id),
        ]);
        await this.delete(id);

        return {
            deleted: true,
            messagesDeleted,
            proposalsDeleted,
            runsDeleted: runs.length,
            runNodesDeleted,
            tracesDeleted,
            assetsDeleted,
            storageObjectsDeleted,
            activeRunCount: 0,
        };
    },
};
