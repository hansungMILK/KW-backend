import { z } from 'zod';

/**
 * HTTP contracts for /blocks/* endpoints.
 * BlockDefinition internal shape owned by @lemoncloud/eureka-flows-api.
 */

// ============================================================================
// GET /blocks/0/list?cores=1&limit=-1
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
// Product API — GET /blocks/{blockType}
// ============================================================================

export const BlockGetParamsSchema = z.object({
    blockType: z.string().min(1),
});

export const BlockGetResponseSchema = z.object({
    blockType: z.string(),
    name: z.string(),
    description: z.string(),
    category: z.string(),
    configFields: z.array(z.record(z.unknown())),
    inputSchema: z.record(z.unknown()),
    outputSchema: z.record(z.unknown()),
    estimatedCost: z.record(z.unknown()).optional(),
});

export type BlockGetResponse = z.infer<typeof BlockGetResponseSchema>;

// ============================================================================
// Product API — GET /blocks (catalog list)
// Unlike compat GET /blocks/0/list which returns $definition format,
// this returns product-shaped items: {blockType, name, description, category, ...}
// ============================================================================

export const ProductBlockListQuerySchema = z.object({
    scenario: z.string().optional(), // default: 'admission-shorts'
    category: z.string().optional(), // filter: search, content, media, data, analysis, integration
});

export const ProductBlockListItemSchema = z.object({
    blockType: z.string(),
    name: z.string(),
    description: z.string(),
    category: z.string(),
    inputSchema: z.record(z.unknown()),
    outputSchema: z.record(z.unknown()),
    estimatedCost: z.record(z.unknown()).nullable().optional(),
});

export const ProductBlockListResponseSchema = z.object({
    items: z.array(ProductBlockListItemSchema),
});

export type ProductBlockListItem = z.infer<typeof ProductBlockListItemSchema>;
export type ProductBlockListResponse = z.infer<typeof ProductBlockListResponseSchema>;
