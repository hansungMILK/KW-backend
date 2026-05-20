import { DeleteCommand, GetCommand, PutCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

import { stripRetentionTtl, withRetentionTtl } from './retention';
import { TableNames, USE_REAL_DYNAMO, getDocClient, memDb } from '../adapters/aws/dynamodb';

import type { Run, RunNode } from '@flows/contracts';

type RunStatus = Run['status'];
type RunNodeStatus = RunNode['status'];

const RUNS_TABLE = USE_REAL_DYNAMO ? TableNames.runs : 'runs';
const RUN_NODES_TABLE = USE_REAL_DYNAMO ? TableNames.runNodes : 'run-nodes';

// ============================================================================
// State transition validation
// ============================================================================

const VALID_RUN_TRANSITIONS: Record<RunStatus, RunStatus[]> = {
    QUEUED: ['RUNNING', 'CANCELLED'],
    RUNNING: ['COMPLETED', 'FAILED', 'CANCELLED'],
    COMPLETED: [],
    FAILED: ['RUNNING'],
    CANCELLED: [],
};

const VALID_NODE_TRANSITIONS: Record<RunNodeStatus, RunNodeStatus[]> = {
    PENDING: ['RUNNING', 'CANCELLED'],
    RUNNING: ['RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'],
    COMPLETED: [],
    FAILED: ['PENDING'], // retry only
    SKIPPED: ['PENDING'], // downstream retry
    CANCELLED: [],
};

// ============================================================================
// Repository
// ============================================================================

export const runRepo = {
    // ── Run CRUD ──────────────────────────────────────────────────────────────

    async putRun(run: Run): Promise<void> {
        if (!USE_REAL_DYNAMO) {
            memDb.put(RUNS_TABLE, run.runId, run as unknown as Record<string, unknown>);
            return;
        }
        await getDocClient().send(
            new PutCommand({
                TableName: RUNS_TABLE,
                Item: withRetentionTtl(run as unknown as Record<string, unknown>, run.createdAt),
            })
        );
    },

    async getRun(runId: string): Promise<Run | null> {
        if (!USE_REAL_DYNAMO) {
            return (memDb.get(RUNS_TABLE, runId) as unknown as Run) ?? null;
        }
        const result = await getDocClient().send(new GetCommand({ TableName: RUNS_TABLE, Key: { runId } }));
        if (!result.Item) return null;
        return stripRetentionTtl(result.Item as Record<string, unknown>) as unknown as Run;
    },

    async deleteRun(runId: string): Promise<void> {
        if (!USE_REAL_DYNAMO) {
            memDb.delete(RUNS_TABLE, runId);
            return;
        }
        await getDocClient().send(new DeleteCommand({ TableName: RUNS_TABLE, Key: { runId } }));
    },

    async listByFlow(
        flowId: string,
        limit?: number,
        cursorToken?: string
    ): Promise<{ items: Run[]; nextCursor: string | null }> {
        if (!USE_REAL_DYNAMO) {
            let all = memDb.query(
                RUNS_TABLE,
                item => (item as { flowId?: string }).flowId === flowId
            ) as unknown as Run[];
            all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
            if (cursorToken) {
                const idx = all.findIndex(r => r.runId === cursorToken);
                if (idx >= 0) all = all.slice(idx + 1);
            }
            const maxItems = limit ?? 20;
            const page = all.slice(0, maxItems + 1);
            const hasMore = page.length > maxItems;
            const items = hasMore ? page.slice(0, maxItems) : page;
            return { items, nextCursor: hasMore ? items[items.length - 1].runId : null };
        }

        // DynamoDB: Query with GSI + native cursor
        const exclusiveStartKey = cursorToken
            ? JSON.parse(Buffer.from(cursorToken, 'base64').toString('utf-8'))
            : undefined;
        const result = await getDocClient().send(
            new QueryCommand({
                TableName: RUNS_TABLE,
                IndexName: 'flowId-createdAt-index',
                KeyConditionExpression: 'flowId = :fid',
                ExpressionAttributeValues: { ':fid': flowId },
                ScanIndexForward: false,
                Limit: limit ?? 20,
                ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
            })
        );
        const items = (result.Items || []).map(item =>
            stripRetentionTtl(item as Record<string, unknown>)
        ) as unknown as Run[];
        const nextCursor = result.LastEvaluatedKey
            ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
            : null;
        return { items, nextCursor };
    },

    async scanAll(
        filters?: { flowId?: string; status?: string },
        limit?: number,
        cursorToken?: string
    ): Promise<{ items: Run[]; nextCursor: string | null }> {
        if (!USE_REAL_DYNAMO) {
            let all = memDb.scan(RUNS_TABLE) as unknown as Run[];
            if (filters?.flowId) all = all.filter(r => r.flowId === filters.flowId);
            if (filters?.status) all = all.filter(r => r.status === filters.status);
            all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
            if (cursorToken) {
                const idx = all.findIndex(r => r.runId === cursorToken);
                if (idx >= 0) all = all.slice(idx + 1);
            }
            const maxItems = limit ?? 20;
            const page = all.slice(0, maxItems + 1);
            const hasMore = page.length > maxItems;
            const items = hasMore ? page.slice(0, maxItems) : page;
            return { items, nextCursor: hasMore ? items[items.length - 1].runId : null };
        }

        // DynamoDB: If flowId filter → Query GSI, else Scan
        if (filters?.flowId) {
            return this.listByFlow(filters.flowId, limit, cursorToken);
        }
        const exclusiveStartKey = cursorToken
            ? JSON.parse(Buffer.from(cursorToken, 'base64').toString('utf-8'))
            : undefined;
        const result = await getDocClient().send(
            new ScanCommand({
                TableName: RUNS_TABLE,
                Limit: limit ?? 20,
                ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
                ...(filters?.status
                    ? {
                          FilterExpression: '#st = :status',
                          ExpressionAttributeNames: { '#st': 'status' },
                          ExpressionAttributeValues: { ':status': filters.status },
                      }
                    : {}),
            })
        );
        const items = (result.Items || []).map(item =>
            stripRetentionTtl(item as Record<string, unknown>)
        ) as unknown as Run[];
        items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const nextCursor = result.LastEvaluatedKey
            ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
            : null;
        return { items, nextCursor };
    },

    // ── RunNode CRUD ──────────────────────────────────────────────────────────

    async putRunNode(node: RunNode): Promise<void> {
        if (!USE_REAL_DYNAMO) {
            const key = `${node.runId}#${node.nodeId}`;
            memDb.put(RUN_NODES_TABLE, key, node as unknown as Record<string, unknown>);
            return;
        }
        await getDocClient().send(
            new PutCommand({
                TableName: RUN_NODES_TABLE,
                Item: withRetentionTtl(node as unknown as Record<string, unknown>, node.updatedAt),
            })
        );
    },

    async getRunNode(runId: string, nodeId: string): Promise<RunNode | null> {
        if (!USE_REAL_DYNAMO) {
            const key = `${runId}#${nodeId}`;
            return (memDb.get(RUN_NODES_TABLE, key) as unknown as RunNode) ?? null;
        }
        const result = await getDocClient().send(
            new GetCommand({
                TableName: RUN_NODES_TABLE,
                Key: { runId, nodeId },
            })
        );
        if (!result.Item) return null;
        return stripRetentionTtl(result.Item as Record<string, unknown>) as unknown as RunNode;
    },

    async listRunNodes(runId: string): Promise<RunNode[]> {
        if (!USE_REAL_DYNAMO) {
            const all = memDb.query(
                RUN_NODES_TABLE,
                item => (item as { runId?: string }).runId === runId
            ) as unknown as RunNode[];
            return all;
        }
        // DynamoDB: Query with PK=runId (composite key: runId + nodeId)
        const items: RunNode[] = [];
        let exclusiveStartKey: Record<string, unknown> | undefined;
        do {
            const result = await getDocClient().send(
                new QueryCommand({
                    TableName: RUN_NODES_TABLE,
                    KeyConditionExpression: 'runId = :rid',
                    ExpressionAttributeValues: { ':rid': runId },
                    ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
                })
            );
            items.push(
                ...((result.Items || []).map(item =>
                    stripRetentionTtl(item as Record<string, unknown>)
                ) as unknown as RunNode[])
            );
            exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
        } while (exclusiveStartKey);
        return items;
    },

    async deleteRunNodes(runId: string): Promise<number> {
        const nodes = await this.listRunNodes(runId);
        if (!USE_REAL_DYNAMO) {
            for (const node of nodes) {
                memDb.delete(RUN_NODES_TABLE, `${node.runId}#${node.nodeId}`);
            }
            return nodes.length;
        }

        await Promise.all(
            nodes.map(node =>
                getDocClient().send(
                    new DeleteCommand({
                        TableName: RUN_NODES_TABLE,
                        Key: { runId: node.runId, nodeId: node.nodeId },
                    })
                )
            )
        );
        return nodes.length;
    },

    // ── Conditional status updates ────────────────────────────────────────────

    async updateRunStatus(
        runId: string,
        newStatus: RunStatus,
        extra?: Partial<Pick<Run, 'startedAt' | 'completedAt' | 'finalOutputSummary'>>
    ): Promise<{ ok: true; run: Run } | { ok: false; error: string }> {
        const run = await this.getRun(runId);
        if (!run) return { ok: false, error: `Run ${runId} not found` };

        const allowed = VALID_RUN_TRANSITIONS[run.status];
        if (!allowed.includes(newStatus)) {
            return {
                ok: false,
                error: `Invalid transition: Run ${runId} status ${run.status} → ${newStatus}`,
            };
        }

        const updated: Run = { ...run, ...extra, status: newStatus };
        await this.putRun(updated);
        return { ok: true, run: updated };
    },

    async updateRunNodeStatus(
        runId: string,
        nodeId: string,
        newStatus: RunNodeStatus,
        extra?: Partial<
            Pick<RunNode, 'progress' | 'startedAt' | 'completedAt' | 'outputPayload' | 'errorCode' | 'errorMessage'>
        >
    ): Promise<{ ok: true; node: RunNode } | { ok: false; error: string }> {
        const node = await this.getRunNode(runId, nodeId);
        if (!node) return { ok: false, error: `RunNode ${runId}#${nodeId} not found` };

        const allowed = VALID_NODE_TRANSITIONS[node.status];
        if (!allowed.includes(newStatus)) {
            return {
                ok: false,
                error: `Invalid transition: RunNode ${nodeId} status ${node.status} → ${newStatus}`,
            };
        }

        const retryReset =
            newStatus === 'PENDING' && (node.status === 'FAILED' || node.status === 'SKIPPED')
                ? {
                      retryCount: node.status === 'FAILED' ? node.retryCount + 1 : node.retryCount,
                      errorCode: null,
                      errorMessage: null,
                      outputPayload: undefined,
                      progress: 0,
                      completedAt: null,
                  }
                : {};
        const successReset = newStatus === 'COMPLETED' ? { errorCode: null, errorMessage: null } : {};
        const updated: RunNode = {
            ...node,
            ...retryReset,
            ...extra,
            ...successReset,
            status: newStatus,
            updatedAt: new Date().toISOString(),
        };
        await this.putRunNode(updated);
        return { ok: true, node: updated };
    },
};
