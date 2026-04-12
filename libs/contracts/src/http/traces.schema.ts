import { z } from 'zod';

/**
 * HTTP contracts for traces endpoints.
 * Traces record execution-level debug data per run/node.
 */

export const TraceTypeSchema = z.enum(['TOOL_CALL', 'TOOL_RESULT', 'STATUS', 'RETRY', 'ERROR', 'POLICY']);

export const TraceSchema = z.object({
    traceId: z.string(),
    runId: z.string(),
    runNodeId: z.string().nullable().optional(),
    traceType: TraceTypeSchema,
    message: z.string(),
    data: z.record(z.unknown()).nullable().optional(),
    occurredAt: z.string(),
});

export type Trace = z.infer<typeof TraceSchema>;

// GET /runs/{runId}/traces
export const TraceListParamsSchema = z.object({
    runId: z.string().min(1),
});

export const TraceListQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(1000).default(100),
    cursor: z.string().optional(),
});

export const TraceListResponseSchema = z.object({
    items: z.array(TraceSchema),
    nextCursor: z.string().nullable(),
});

export type TraceListResponse = z.infer<typeof TraceListResponseSchema>;

// ============================================================================
// Product API — GET /runs/{runId}/nodes/{nodeId}/traces
// ============================================================================

export const TraceListByNodeParamsSchema = z.object({
    runId: z.string().min(1),
    nodeId: z.string().min(1),
});

export const TraceListByNodeQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(500).default(50),
    cursor: z.string().optional(),
});

export const TraceListByNodeResponseSchema = z.object({
    items: z.array(TraceSchema),
    nextCursor: z.string().nullable(),
});

export type TraceListByNodeResponse = z.infer<typeof TraceListByNodeResponseSchema>;
