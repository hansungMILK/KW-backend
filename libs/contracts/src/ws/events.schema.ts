import { z } from 'zod';

/**
 * WebSocket event schemas.
 *
 * Server broadcasts flow/run/node/asset events as raw typed payloads:
 *   { type: "run.started", runId, flowId, ... }
 *
 * The $default handler also sends system responses for direct client actions:
 *   { type: "system", action: "pong", data: { timestamp }, ts }
 */

// ============================================================================
// System messages (server → client direct responses)
// ============================================================================

export const WsSystemPongSchema = z.object({
    type: z.literal('system'),
    action: z.literal('pong'),
    ts: z.string().optional(),
    data: z
        .object({
            timestamp: z.number(),
        })
        .passthrough(),
});

export const WsSystemInfoSchema = z.object({
    type: z.literal('system'),
    action: z.literal('info'),
    ts: z.string().optional(),
    data: z
        .object({
            id: z.string(),
            connectionId: z.string(),
        })
        .passthrough(),
});

export const WsSystemMessageSchema = z.discriminatedUnion('action', [WsSystemPongSchema, WsSystemInfoSchema]);

export type WsSystemPong = z.infer<typeof WsSystemPongSchema>;
export type WsSystemInfo = z.infer<typeof WsSystemInfoSchema>;
export type WsSystemMessage = z.infer<typeof WsSystemMessageSchema>;

// ============================================================================
// Flow update — client should reload via GET /flows/{flowId}
// ============================================================================

export const WsFlowUpdatedSchema = z.object({
    type: z.literal('flow'),
    id: z.string(),
    timestamp: z.number(),
});

export type WsFlowUpdated = z.infer<typeof WsFlowUpdatedSchema>;

// ============================================================================
// Node update — execution state change
// ============================================================================

export const NodeStateEnum = z.enum(['IDLE', 'READY', 'RUNNING', 'COMPLETED', 'ERROR']);

export const WsNodeUpdatedSchema = z.object({
    type: z.literal('node'),
    id: z.string(),
    flowId: z.string().optional(),
    timestamp: z.number().optional(),
    no: z.number().optional(), // sequence number
    state: NodeStateEnum.optional(),
    prevState: NodeStateEnum.optional(),
    progress: z.number().min(0).max(100).optional(),
    stereo: z.number().optional(), // 0 = no additional API fetch needed
    // deprecated — still sent for compat
    status: z.string().optional(),
    prevStatus: z.string().optional(),
});

export type WsNodeUpdated = z.infer<typeof WsNodeUpdatedSchema>;

// ============================================================================
// Port update — port data changed, client refreshes via GET /flows/{flowId}
// ============================================================================

export const WsPortUpdatedSchema = z.object({
    type: z.literal('node/port'),
    id: z.string(), // "nodeId:direction@portName"
    flowId: z.string().optional(),
    timestamp: z.number().optional(),
    no: z.number().optional(),
});

export type WsPortUpdated = z.infer<typeof WsPortUpdatedSchema>;

// ============================================================================
// Run execution events (server → client, broadcast during async execution)
// These are higher-level events on top of the low-level node updates.
// ============================================================================

export const WsRunStartedSchema = z.object({
    type: z.literal('run.started'),
    id: z.string().optional(),
    runId: z.string(),
    flowId: z.string(),
    status: z.literal('RUNNING'),
    timestamp: z.number(),
});

export const WsRunCompletedSchema = z.object({
    type: z.literal('run.completed'),
    id: z.string().optional(),
    runId: z.string(),
    flowId: z.string(),
    status: z.literal('COMPLETED'),
    timestamp: z.number(),
});

export const WsRunFailedSchema = z.object({
    type: z.literal('run.failed'),
    id: z.string().optional(),
    runId: z.string(),
    flowId: z.string(),
    status: z.literal('FAILED'),
    failedNodeId: z.string().optional(),
    errorCode: z.string().nullable().optional(),
    errorMessage: z.string().optional(),
    error: z.string().optional(),
    timestamp: z.number(),
});

export const WsNodeStartedSchema = z.object({
    type: z.literal('node.started'),
    id: z.string().optional(),
    runId: z.string(),
    flowId: z.string().optional(),
    nodeId: z.string(),
    status: z.literal('RUNNING'),
    timestamp: z.number(),
});

export const WsNodeProgressSchema = z.object({
    type: z.literal('node.progress'),
    id: z.string().optional(),
    runId: z.string(),
    flowId: z.string().optional(),
    nodeId: z.string(),
    progress: z.number().min(0).max(100),
    message: z.string().optional(),
    timestamp: z.number(),
});

export const WsNodeCompletedSchema = z.object({
    type: z.literal('node.completed'),
    id: z.string().optional(),
    runId: z.string(),
    flowId: z.string().optional(),
    nodeId: z.string(),
    status: z.literal('COMPLETED'),
    timestamp: z.number(),
});

export const WsNodeFailedSchema = z.object({
    type: z.literal('node.failed'),
    id: z.string().optional(),
    runId: z.string(),
    flowId: z.string().optional(),
    nodeId: z.string(),
    status: z.literal('FAILED'),
    errorCode: z.string().optional(),
    errorMessage: z.string().optional(),
    timestamp: z.number(),
});

export const WsAssetCreatedSchema = z.object({
    type: z.literal('asset.created'),
    id: z.string().optional(),
    runId: z.string(),
    flowId: z.string().optional(),
    nodeId: z.string(),
    assetId: z.string(),
    assetType: z.string(),
    url: z.string().optional(),
    publicUrl: z.string().optional(),
    timestamp: z.number(),
});

export const WsProposalCreatedSchema = z.object({
    type: z.literal('proposal.created'),
    id: z.string().optional(),
    proposalId: z.string(),
    flowId: z.string(),
    status: z.literal('PENDING'),
    blocks: z.array(z.object({ type: z.string(), label: z.string() })).optional(),
    estimatedCost: z.number().optional(),
    estimatedCostUsd: z.number().optional(),
    maxRunEstimatedCostUsd: z.number().optional(),
    description: z.string().optional(),
    approvalRequired: z.boolean(),
    timestamp: z.number(),
});

export type WsProposalCreated = z.infer<typeof WsProposalCreatedSchema>;

export type WsRunStarted = z.infer<typeof WsRunStartedSchema>;
export type WsRunCompleted = z.infer<typeof WsRunCompletedSchema>;
export type WsRunFailed = z.infer<typeof WsRunFailedSchema>;
export type WsNodeStarted = z.infer<typeof WsNodeStartedSchema>;
export type WsNodeProgress = z.infer<typeof WsNodeProgressSchema>;
export type WsNodeCompleted = z.infer<typeof WsNodeCompletedSchema>;
export type WsNodeFailed = z.infer<typeof WsNodeFailedSchema>;
export type WsAssetCreated = z.infer<typeof WsAssetCreatedSchema>;

// ============================================================================
// Union of all data events
// ============================================================================

export const WsDataEventSchema = z.discriminatedUnion('type', [
    WsFlowUpdatedSchema,
    WsNodeUpdatedSchema,
    WsPortUpdatedSchema,
    WsRunStartedSchema,
    WsRunCompletedSchema,
    WsRunFailedSchema,
    WsNodeStartedSchema,
    WsNodeProgressSchema,
    WsNodeCompletedSchema,
    WsNodeFailedSchema,
    WsAssetCreatedSchema,
    WsProposalCreatedSchema,
]);

export type WsDataEvent = z.infer<typeof WsDataEventSchema>;

// ============================================================================
// Server → client messages
// ============================================================================

export const WsServerMessageSchema = z.union([WsDataEventSchema, WsSystemMessageSchema]);

/**
 * @deprecated Use WsServerMessageSchema. Kept for older imports that still refer
 * to "raw" WebSocket messages; server messages are no longer wrapped in
 * { action, data, channel }.
 */
export const RawWsMessageSchema = WsServerMessageSchema;

export type WsServerMessage = z.infer<typeof WsServerMessageSchema>;
export type RawWsMessage = WsServerMessage;
