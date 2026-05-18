import { z } from 'zod';

/**
 * HTTP contracts for /blocks/* endpoints.
 * BlockDefinition internal shape owned by @lemoncloud/eureka-flows-api.
 */

// ============================================================================
// GET /blocks
// Caller: libs/flows/src/api/blocks.ts → listBlocks()
// ============================================================================

export const BlockListQuerySchema = z.object({
    cores: z.string().optional(), // "1"
    limit: z.string().optional(), // "-1"
});

/**
 * Single block item in list response.
 * The frontend checks `$definition.label` to filter valid blocks.
 */
export const BlockListItemSchema = z
    .object({
        $definition: z
            .object({
                id: z.string().optional(),
                type: z.string(),
                label: z.string(),
                description: z.string().optional(),
                inputs: z.array(z.record(z.unknown())).optional(),
                outputs: z.array(z.record(z.unknown())).optional(),
                configSchema: z.array(z.record(z.unknown())).optional(),
            })
            .passthrough(),
        isFrontend: z.union([z.literal(0), z.literal(1)]).optional(),
        stereo: z.enum(['input', 'process', 'output']).optional(),
        isRunnable: z.boolean().optional(),
    })
    .passthrough();

export const BlockListResponseSchema = z.object({
    list: z.array(BlockListItemSchema),
});

export type BlockListItem = z.infer<typeof BlockListItemSchema>;
export type BlockListResponse = z.infer<typeof BlockListResponseSchema>;

// ============================================================================
// GET /blocks  (spec)
// Returns: { items: [{ blockType, name, description, category, inputSchema, outputSchema, estimatedCost, configFields }] }
// ============================================================================

export const BlockSpecSummarySchema = z.object({
    blockType: z.string(),
    name: z.string(),
    description: z.string(),
    category: z.enum(['input', 'process', 'output']),
    inputSchema: z.array(z.unknown()),
    outputSchema: z.array(z.unknown()),
    estimatedCost: z.number(),
    configFields: z.array(z.unknown()).optional(),
});

export const BlockSpecListResponseSchema = z.object({
    items: z.array(BlockSpecSummarySchema),
});

export type BlockSpecSummary = z.infer<typeof BlockSpecSummarySchema>;
export type BlockSpecListResponse = z.infer<typeof BlockSpecListResponseSchema>;

// ============================================================================
// GET /blocks/{blockType}  (spec)
// 404 BLOCK_NOT_FOUND if blockType is not in catalog
// Returns summary fields + configFields
// ============================================================================

export const BlockSpecDetailParamsSchema = z.object({
    blockType: z.string().min(1),
});

export const BlockSpecDetailResponseSchema = BlockSpecSummarySchema.extend({
    configFields: z.array(z.unknown()),
});

export type BlockSpecDetailParams = z.infer<typeof BlockSpecDetailParamsSchema>;
export type BlockSpecDetailResponse = z.infer<typeof BlockSpecDetailResponseSchema>;
