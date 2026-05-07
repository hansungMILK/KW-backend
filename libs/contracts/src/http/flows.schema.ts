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
// Legacy client-side compatibility shapes
// ============================================================================

export const FlowLoadParamsSchema = z.object({
    id: z.string().min(1),
});

export const FlowLoadResponseSchema = z.object({
    id: z.string().optional(),
    stereo: z.string().optional(),
    name: z.string().optional(),
    state: z.enum(['draft', 'active', 'archived']).optional(),
    description: z.string().optional(),
    seq: z.number().optional(),
    meta: z.unknown().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
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

export const FlowSaveParamsSchema = z.object({
    id: z.string().min(1),
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
    nodes$$: z.array(z.record(z.unknown())).optional(),
    edges$$: z.array(z.record(z.unknown())).optional(),
    ports$$: z.array(z.record(z.unknown())).optional(),
});

export type FlowSaveParams = z.infer<typeof FlowSaveParamsSchema>;
export type FlowSaveRequest = z.infer<typeof FlowSaveRequestSchema>;
export type FlowSaveResponse = z.infer<typeof FlowSaveResponseSchema>;

export const FlowUpsertParamsSchema = FlowLoadParamsSchema;
export const FlowUpsertRequestSchema = FlowSaveRequestSchema;
export const FlowUpsertResponseSchema = FlowSaveResponseSchema;

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
// FlowStatus + spec schemas (P1) + lifecycle response shapes (P2/P3)
// ============================================================================

export const FlowStatusSchema = z.enum(['DRAFT', 'READY', 'ARCHIVED']);
export type FlowStatus = z.infer<typeof FlowStatusSchema>;

// ============================================================================
// POST /flows  (spec)
// ============================================================================

export const FlowCreateRequestSchema = z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    scenario: z.string().optional(),
});

export const FlowSummarySchema = z.object({
    flowId: z.string(),
    title: z.string(),
    description: z.string().optional(),
    status: FlowStatusSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
});

export type FlowCreateRequest = z.infer<typeof FlowCreateRequestSchema>;
export type FlowSummary = z.infer<typeof FlowSummarySchema>;

// ============================================================================
// GET /flows  (spec)
// ============================================================================

export const FlowListQuerySchema = z.object({
    limit: z.string().optional(),
    cursor: z.string().optional(),
    status: FlowStatusSchema.optional(),
});

export const FlowListResponseSchema = z.object({
    items: z.array(FlowSummarySchema),
    nextCursor: z.string().optional(),
});

export type FlowListQuery = z.infer<typeof FlowListQuerySchema>;
export type FlowListResponse = z.infer<typeof FlowListResponseSchema>;

// ============================================================================
// GET /flows/{flowId}  (spec)
// ============================================================================

export const FlowDetailResponseSchema = FlowSummarySchema.extend({
    nodes: z.array(z.record(z.unknown())),
    edges: z.array(z.record(z.unknown())),
    latestProposalId: z.string().nullable().optional(),
    lastRunId: z.string().nullable().optional(),
});

export type FlowDetailResponse = z.infer<typeof FlowDetailResponseSchema>;

// ============================================================================
// PUT /flows/{flowId}  (spec) — unified canvas save
// ============================================================================

export const FlowPutRequestSchema = z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    nodes: z.array(z.record(z.unknown())),
    edges: z.array(z.record(z.unknown())),
});

export type FlowPutRequest = z.infer<typeof FlowPutRequestSchema>;

// ============================================================================
// DELETE /flows/{flowId}  (audit #7)
// ============================================================================

export const FlowDeleteResponseSchema = z.object({
    deleted: z.literal(true),
    messagesDeleted: z.number().int().nonnegative(),
    proposalsDeleted: z.number().int().nonnegative(),
});
export type FlowDeleteResponse = z.infer<typeof FlowDeleteResponseSchema>;

// ============================================================================
// POST /flows/{flowId}/archive|unarchive|duplicate  (audit #8~10)
// ============================================================================

export const FlowLifecycleResponseSchema = FlowSummarySchema;
export type FlowLifecycleResponse = z.infer<typeof FlowLifecycleResponseSchema>;
