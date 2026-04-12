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
    state: z.enum(['DRAFT', 'READY', 'ARCHIVED']).optional(),
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
// Product API — POST /flows (create)
// ============================================================================

export const ProductFlowCreateRequestSchema = z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    scenario: z.string().default('admission-shorts'),
    ownerId: z.string().optional(),
});

export const ProductFlowStatusSchema = z.enum(['DRAFT', 'READY', 'ARCHIVED']);

export const ProductFlowCreateResponseSchema = z.object({
    flowId: z.string(),
    title: z.string(),
    description: z.string().nullable().optional(),
    status: ProductFlowStatusSchema,
    nodes: z.array(z.record(z.unknown())),
    edges: z.array(z.record(z.unknown())),
    createdAt: z.string(),
    updatedAt: z.string(),
});

export type ProductFlowCreateRequest = z.infer<typeof ProductFlowCreateRequestSchema>;
export type ProductFlowCreateResponse = z.infer<typeof ProductFlowCreateResponseSchema>;

// ============================================================================
// Product API — GET /flows (list)
// ============================================================================

export const ProductFlowListQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().optional(),
    status: ProductFlowStatusSchema.optional(),
    ownerId: z.string().optional(),
});

export const ProductFlowListItemSchema = z.object({
    flowId: z.string(),
    title: z.string(),
    status: ProductFlowStatusSchema,
    updatedAt: z.string(),
});

export const ProductFlowListResponseSchema = z.object({
    items: z.array(ProductFlowListItemSchema),
    nextCursor: z.string().nullable(),
});

export type ProductFlowListResponse = z.infer<typeof ProductFlowListResponseSchema>;

// ============================================================================
// Product API — GET /flows/{flowId} (detail)
// ============================================================================

export const ProductFlowGetParamsSchema = z.object({
    flowId: z.string().min(1),
});

export const ProductFlowGetResponseSchema = z.object({
    flowId: z.string(),
    title: z.string(),
    description: z.string().nullable().optional(),
    status: ProductFlowStatusSchema,
    latestProposalId: z.string().nullable().optional(),
    nodes: z.array(z.record(z.unknown())),
    edges: z.array(z.record(z.unknown())),
    lastRunId: z.string().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

export type ProductFlowGetResponse = z.infer<typeof ProductFlowGetResponseSchema>;

// ============================================================================
// Product API — PUT /flows/{flowId} (save canvas)
// ============================================================================

export const ProductFlowSaveParamsSchema = z.object({
    flowId: z.string().min(1),
});

export const ProductFlowSaveRequestSchema = z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    nodes: z.array(z.record(z.unknown())),
    edges: z.array(z.record(z.unknown())),
});

export const ProductFlowSaveResponseSchema = z.object({
    flowId: z.string(),
    updatedAt: z.string(),
});

export type ProductFlowSaveRequest = z.infer<typeof ProductFlowSaveRequestSchema>;
export type ProductFlowSaveResponse = z.infer<typeof ProductFlowSaveResponseSchema>;

// ============================================================================
// Product API — DELETE /flows/{flowId}
// ============================================================================

export const ProductFlowDeleteParamsSchema = z.object({
    flowId: z.string().min(1),
});

export const ProductFlowDeleteResponseSchema = z.object({
    deleted: z.literal(true),
    flowId: z.string(),
});

export type ProductFlowDeleteResponse = z.infer<typeof ProductFlowDeleteResponseSchema>;

// ============================================================================
// Product API — POST /flows/{flowId}/duplicate
// ============================================================================

export const ProductFlowDuplicateParamsSchema = z.object({
    flowId: z.string().min(1),
});

export const ProductFlowDuplicateRequestSchema = z.object({
    title: z.string().optional(),
});

export const ProductFlowDuplicateResponseSchema = z.object({
    flowId: z.string(),
    sourceFlowId: z.string(),
    title: z.string(),
});

export type ProductFlowDuplicateResponse = z.infer<typeof ProductFlowDuplicateResponseSchema>;

// ============================================================================
// Product API — POST /flows/{flowId}/archive
// ============================================================================

export const ProductFlowArchiveParamsSchema = z.object({
    flowId: z.string().min(1),
});

export const ProductFlowArchiveResponseSchema = z.object({
    flowId: z.string(),
    status: z.literal('ARCHIVED'),
    updatedAt: z.string(),
});

// ============================================================================
// Product API — POST /flows/{flowId}/unarchive
// ============================================================================

export const ProductFlowUnarchiveParamsSchema = z.object({
    flowId: z.string().min(1),
});

export const ProductFlowUnarchiveResponseSchema = z.object({
    flowId: z.string(),
    status: z.literal('READY'),
    updatedAt: z.string(),
});

// ============================================================================
// Product API — GET /initial-data
// Single entry point that returns blocks catalog + user workflows.
// Combines GET /blocks + GET /flows?ownerId=... in one call.
// ============================================================================

export const InitialDataQuerySchema = z.object({
    ownerId: z.string().min(1),
    category: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const InitialDataResponseSchema = z.object({
    initialData: z.object({
        availableBlocks: z.array(z.record(z.unknown())),
        userWorkflows: z.array(ProductFlowListItemSchema),
    }),
});
