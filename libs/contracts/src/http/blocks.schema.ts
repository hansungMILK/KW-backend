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
    category: z.string().optional(), // 특정 카테고리 필터
});

/**
 * 신규 표준 블록 규격
 */
export const BlockSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    input: z.record(z.unknown()), // { [key: string]: type_name }
    output: z.record(z.unknown()), // { [key: string]: type_name }
    category: z.string().optional(),
});

/**
 * 기존 블록 아이템 규격 (하위 호환성 유지용)
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
    blocks: z.array(BlockSchema).optional(), // 신규 규격
    list: z.array(BlockListItemSchema).optional(), // 기존 규격
});

export const BlockCategoryListResponseSchema = z.object({
    categories: z.array(z.string()),
});

export type Block = z.infer<typeof BlockSchema>;
export type BlockListItem = z.infer<typeof BlockListItemSchema>;
export type BlockListResponse = z.infer<typeof BlockListResponseSchema>;
export type BlockCategoryListResponse = z.infer<typeof BlockCategoryListResponseSchema>;
