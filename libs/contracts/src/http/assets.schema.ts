import { z } from 'zod';

/**
 * HTTP contracts for assets endpoints.
 * Assets are files (images, audio, video) produced during execution.
 */

export const AssetTypeSchema = z.enum(['IMAGE', 'AUDIO', 'VIDEO', 'JSON', 'TEXT']);

export const AssetSchema = z.object({
    assetId: z.string(),
    runId: z.string(),
    runNodeId: z.string(),
    flowId: z.string(),
    assetType: AssetTypeSchema,
    mimeType: z.string(),
    publicUrl: z.string().nullable().optional(),
    metadata: z.record(z.unknown()).optional(),
    createdAt: z.string(),
});

export type Asset = z.infer<typeof AssetSchema>;

// GET /runs/{runId}/assets
export const AssetListParamsSchema = z.object({
    runId: z.string().min(1),
});

export const AssetListResponseSchema = z.object({
    items: z.array(AssetSchema),
});

// GET /assets/{assetId}
export const AssetGetParamsSchema = z.object({
    assetId: z.string().min(1),
});

export const AssetGetResponseSchema = AssetSchema;
export type AssetGetResponse = z.infer<typeof AssetGetResponseSchema>;

// ============================================================================
// Product API — GET /runs/{runId}/results
// Unified results endpoint with export options + quality filter
// ============================================================================

export const RunResultsParamsSchema = z.object({
    runId: z.string().min(1),
});

export const RunResultsQuerySchema = z.object({
    includeAssets: z.enum(['true', 'false']).default('true'),
    quality: z.string().optional(), // '720p', '1080p'
});

export const RunResultsResponseSchema = z.object({
    executionId: z.string(),
    completedAt: z.string().nullable(),
    assets: z.array(
        z.object({
            assetId: z.string(),
            type: AssetTypeSchema,
            label: z.string(),
            url: z.string().nullable(),
            format: z.string().nullable().optional(),
            mimeType: z.string(),
            metadata: z.record(z.unknown()).optional(),
        })
    ),
    exportOptions: z.object({
        youtubeShorts: z.string(),
        tikTok: z.string(),
    }),
    message: z.string(),
});

export type RunResultsResponse = z.infer<typeof RunResultsResponseSchema>;

// ============================================================================
// Product API — POST /runs/{runId}/export/{platform}
// Export run results to external platform (stub — actual integration future)
// ============================================================================

export const RunExportParamsSchema = z.object({
    runId: z.string().min(1),
    platform: z.enum(['youtube', 'tiktok']),
});

export const RunExportResponseSchema = z.object({
    exportId: z.string(),
    runId: z.string(),
    platform: z.enum(['youtube', 'tiktok']),
    status: z.enum(['ready', 'processing', 'completed', 'failed']),
    videoUrl: z.string().nullable(),
    assetCount: z.number().int(),
    message: z.string(),
});

export type RunExportResponse = z.infer<typeof RunExportResponseSchema>;
