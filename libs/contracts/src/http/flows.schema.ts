import { z } from 'zod';

/**
 * HTTP contracts for /flows/* endpoints.
 *
 * Domain types (NodeData, EdgeData) come from @lemoncloud/eureka-flows-api.
 * These schemas define only the HTTP request/response boundary shapes.
 * We use z.any() for NodeData/EdgeData arrays because their internal shape
 * is owned by the upstream package — we validate the envelope, not the payload.
 */

// ============================================================================
// GET /flows/{id}/load
// Caller: libs/flows/src/api/flows.ts → loadFlow()
// ============================================================================

export const FlowLoadParamsSchema = z.object({
    id: z.string().min(1),
});

export const FlowLoadResponseSchema = z.object({
    // FlowModel fields
    id: z.string().optional(),
    stereo: z.string().optional(),
    name: z.string().optional(),
    state: z.enum(['draft', 'active', 'archived']).optional(),
    description: z.string().optional(),
    seq: z.number().optional(),
    meta: z.unknown().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
    // Payload — validated as arrays, internal shape owned by eureka-flows-api
    nodes: z.array(z.record(z.unknown())),
    edges: z.array(z.record(z.unknown())),
    ports: z
        .array(
            z.object({
                id: z.string(),
                nodeId: z.string(),
                portId: z.string(),
                data: z.union([
                    z.object({
                        value: z.unknown(),
                        type: z.string(),
                        timestamp: z.number().optional(),
                    }),
                    z.null(),
                ]),
            })
        )
        .optional(),
    channelId: z.string().optional(),
});

export type FlowLoadParams = z.infer<typeof FlowLoadParamsSchema>;
export type FlowLoadResponse = z.infer<typeof FlowLoadResponseSchema>;

// ============================================================================
// POST /flows/{id}/save
// Caller: libs/flows/src/api/flows.ts → saveFlow()
// id="0" → create new flow
// ============================================================================

export const FlowSaveParamsSchema = z.object({
    id: z.string().min(1), // "0" for create
});

export const FlowSaveRequestSchema = z.object({
    nodes: z.array(z.record(z.unknown())),
    edges: z.array(z.record(z.unknown())),
});

export const FlowSaveResponseSchema = z.object({
    id: z.string().optional(),
    name: z.string().optional(),
    state: z.string().optional(),
    nodes: z.array(z.record(z.unknown())).optional(),
    edges: z.array(z.record(z.unknown())).optional(),
    ports: z.array(z.record(z.unknown())).optional(),
    // deprecated — backend should still return these for compat
    nodes$$: z.array(z.record(z.unknown())).optional(),
    edges$$: z.array(z.record(z.unknown())).optional(),
    ports$$: z.array(z.record(z.unknown())).optional(),
});

export type FlowSaveParams = z.infer<typeof FlowSaveParamsSchema>;
export type FlowSaveRequest = z.infer<typeof FlowSaveRequestSchema>;
export type FlowSaveResponse = z.infer<typeof FlowSaveResponseSchema>;

// ============================================================================
// POST /flows/{id}/upsert
// Caller: libs/flows/src/api/flows.ts → upsertFlow()
// Same request/response shape as save
// ============================================================================

export const FlowUpsertParamsSchema = FlowLoadParamsSchema;
export const FlowUpsertRequestSchema = FlowSaveRequestSchema;
export const FlowUpsertResponseSchema = FlowSaveResponseSchema;

// ============================================================================
// POST /flows/{id} — metadata update
// Caller: libs/flows/src/api/flows.ts → updateFlowMetadata()
// ============================================================================

export const FlowUpdateMetaParamsSchema = z.object({
    id: z.string().min(1),
});

export const FlowUpdateMetaRequestSchema = z.object({
    name: z.string().optional(),
});

export const FlowUpdateMetaResponseSchema = z.object({
    id: z.string().optional(),
    name: z.string().optional(),
    state: z.string().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
});

export type FlowUpdateMetaRequest = z.infer<typeof FlowUpdateMetaRequestSchema>;
export type FlowUpdateMetaResponse = z.infer<typeof FlowUpdateMetaResponseSchema>;

// ============================================================================
// P2 — FlowStatus + lifecycle response shapes
//
// NOTE for merge: P1 (feat/flows-blocks-spec) introduces the same FlowStatusSchema
// and FlowSummarySchema. On merge, dedupe — these are identical shapes.
// ============================================================================

export const FlowStatusSchema = z.enum(['DRAFT', 'READY', 'ARCHIVED']);
export type FlowStatus = z.infer<typeof FlowStatusSchema>;

export const FlowSummarySchema = z.object({
    flowId: z.string(),
    title: z.string(),
    description: z.string().optional(),
    status: FlowStatusSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type FlowSummary = z.infer<typeof FlowSummarySchema>;

// ============================================================================
// DELETE /flows/{flowId}  (audit #7)
// Cascade: Messages/Proposals deleted, Runs/Assets preserved.
// ============================================================================

export const FlowDeleteResponseSchema = z.object({
    deleted: z.literal(true),
    messagesDeleted: z.number().int().nonnegative(),
    proposalsDeleted: z.number().int().nonnegative(),
});
export type FlowDeleteResponse = z.infer<typeof FlowDeleteResponseSchema>;

// ============================================================================
// POST /flows/{flowId}/archive   (audit #9 / F-31)
// POST /flows/{flowId}/unarchive (audit #10 / F-35)
// POST /flows/{flowId}/duplicate (audit #8 / F-19)
// All return a FlowSummary of the affected (or newly created) flow.
// ============================================================================

export const FlowLifecycleResponseSchema = FlowSummarySchema;
export type FlowLifecycleResponse = z.infer<typeof FlowLifecycleResponseSchema>;
