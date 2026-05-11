import { z } from 'zod';

/**
 * Block type identifiers — single source of truth.
 * Used by: block catalog, mock/openai/claude orchestrators,
 * proposal generation, block registry, execution engine.
 */
export const BLOCK_TYPES = [
    'input-text',
    'input-image',
    'output-preview',
    'buffer-delay',
    'text-transform',
    'search',
    'content',
    'data',
    'analysis',
    'media-image',
    'media-tts',
    'media-video',
    'integration',
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

export const BlockTypeSchema = z.enum(BLOCK_TYPES);

const SourceRefSchema = z.object({
    id: z.string().optional(),
    title: z.string().optional(),
    url: z.string().optional(),
    source: z.string().optional(),
    publishedAt: z.string().nullable().optional(),
    sourceType: z.enum(['official', 'news', 'blog', 'other']).optional(),
    confidence: z.number().min(0).max(1).optional(),
    summary: z.string().optional(),
    fullText: z.string().optional(),
    keyClaims: z.array(z.string()).optional(),
    primarySource: z.boolean().optional(),
    sourcePriority: z.number().optional(),
});

const VisualSchema = z.object({
    topTitle: z.string().optional(),
    mainCaption: z.string().optional(),
    sourceLabel: z.string().optional(),
});

const ClaimTypeSchema = z.enum(['fact', 'hypothetical', 'opinion', 'joke']);

/**
 * Common block executor interface.
 * Every block implements this contract.
 */
export interface BlockExecutorResult {
    output: Record<string, unknown>;
    durationMs: number;
    /** Optional assets produced (media blocks) */
    assets?: Array<{
        assetType: 'IMAGE' | 'AUDIO' | 'VIDEO' | 'JSON' | 'TEXT';
        mimeType: string;
        data: Buffer | string;
        metadata?: Record<string, unknown>;
    }>;
}

export interface BlockExecutorContext {
    runId: string;
    nodeId: string;
    flowId?: string;
    abortSignal?: AbortSignal;
    isCancelled?: () => boolean | Promise<boolean>;
    onProgress?: (progress: number, message?: string) => Promise<void>;
    onAsset?: (asset: NonNullable<BlockExecutorResult['assets']>[number]) => Promise<void>;
}

export interface BlockExecutor {
    readonly blockType: BlockType;
    execute(
        input: unknown,
        config?: Record<string, unknown>,
        context?: BlockExecutorContext
    ): Promise<BlockExecutorResult>;
}

// ============================================================================
// Per-block input/output schemas
// ============================================================================

/** search block */
export const SearchOutputSchema = z.object({
    collectionMode: z.enum(['url', 'web_search', 'url_fallback_web_search']).optional(),
    primaryUrl: z.string().optional(),
    keywords: z.array(z.string()),
    articles: z.array(
        z.object({
            id: z.string().optional(),
            title: z.string(),
            url: z.string(),
            source: z.string(),
            publishedAt: z.string().nullable().optional(),
            sourceType: z.enum(['official', 'news', 'blog', 'other']).optional(),
            confidence: z.number().min(0).max(1).optional(),
            summary: z.string().optional(),
            fullText: z.string().optional(),
            keyClaims: z.array(z.string()).optional(),
            primarySource: z.boolean().optional(),
            sourcePriority: z.number().optional(),
        })
    ),
    trendScore: z.number().optional(),
    retrievedAt: z.string().optional(),
    presetId: z.string().optional(),
});

/** content block */
export const ContentOutputSchema = z.object({
    title: z.string().optional(),
    hook: z.string(),
    script: z
        .object({
            hook: z.string().optional(),
            angle: z.string().optional(),
            cta: z.string().optional(),
        })
        .optional(),
    style: z
        .object({
            format: z.string().optional(),
            aspectRatio: z.string().optional(),
            sceneCount: z.number().optional(),
            visualGrammar: z.record(z.unknown()).optional(),
        })
        .optional(),
    scenes: z.array(
        z.object({
            sceneNumber: z.number(),
            imageSlot: z.string().optional(),
            storyBeat: z.string().optional(),
            topTitle: z.string().optional(),
            caption: z.string().optional(),
            narration: z.string(),
            imagePrompt: z.string(),
            visualText: z.string().optional(),
            visual: VisualSchema,
            claimType: ClaimTypeSchema,
            sourceRefs: z.array(SourceRefSchema.or(z.string())),
            durationSec: z.number().optional(),
        })
    ),
    cta: z.string(),
    totalDurationSec: z.number().optional(),
    sources: z.array(SourceRefSchema).optional(),
    presetId: z.string().optional(),
});

/** data block */
export const DataOutputSchema = z.object({
    normalizedScenes: z.array(
        z.object({
            sceneNumber: z.number(),
            imageSlot: z.string().optional(),
            storyBeat: z.string().optional(),
            topTitle: z.string().optional(),
            caption: z.string().optional(),
            narration: z.string(),
            imagePrompt: z.string(),
            visualText: z.string().optional(),
            visual: VisualSchema.optional(),
            claimType: ClaimTypeSchema,
            sourceRefs: z.array(SourceRefSchema.or(z.string())),
            durationSec: z.number().optional(),
            keywords: z.array(z.string()).optional(),
        })
    ),
    metadata: z.record(z.unknown()).optional(),
});

/** analysis block */
export const AnalysisOutputSchema = z.object({
    safetyScore: z.number().min(0).max(100),
    qualityScore: z.number().min(0).max(100),
    issues: z.array(
        z.object({
            severity: z.enum(['low', 'medium', 'high', 'critical']),
            message: z.string(),
            sceneNumber: z.number().optional(),
        })
    ),
    approved: z.boolean(),
});

/** media-image block */
export const MediaImageOutputSchema = z.object({
    images: z.array(
        z.object({
            sceneNumber: z.number(),
            url: z.string(),
            width: z.number(),
            height: z.number(),
            prompt: z.string(),
        })
    ),
});

/** media-tts block */
export const MediaTtsOutputSchema = z.object({
    audio: z.object({
        url: z.string(),
        durationSec: z.number(),
        format: z.string(),
        sampleRate: z.number().optional(),
    }),
    narrationText: z.string().optional(),
    subtitleCues: z
        .array(
            z.object({
                sceneNumber: z.number(),
                text: z.string(),
                role: z.enum(['hook', 'scene', 'cta']).optional(),
                startSec: z.number(),
                endSec: z.number(),
            })
        )
        .optional(),
});

/** media-video block */
export const MediaVideoOutputSchema = z.object({
    video: z.object({
        url: z.string(),
        durationSec: z.number(),
        width: z.number(),
        height: z.number(),
        format: z.string(),
        sizeBytes: z.number().optional(),
    }),
    backgroundMusic: z
        .object({
            enabled: z.boolean().optional(),
            id: z.string().optional(),
            title: z.string().optional(),
            mood: z.string().optional(),
            volume: z.number().optional(),
            source: z.string().optional(),
            license: z.string().optional(),
            attribution: z.string().optional(),
            reason: z.string().optional(),
        })
        .optional(),
});

/** integration block — final deliverable */
export const IntegrationOutputSchema = z.object({
    title: z.string(),
    description: z.string(),
    hashtags: z.array(z.string()),
    publicUrl: z.string(),
    video: z
        .object({
            url: z.string(),
            durationSec: z.number(),
            width: z.number(),
            height: z.number(),
            format: z.string(),
        })
        .optional(),
    audio: z
        .object({
            url: z.string(),
            durationSec: z.number(),
            format: z.string(),
        })
        .optional(),
    thumbnailUrl: z.string().nullable().optional(),
    sceneCount: z.number(),
    durationSec: z.number(),
    qualitySummary: z
        .object({
            safetyScore: z.number(),
            qualityScore: z.number(),
            approved: z.boolean(),
        })
        .optional(),
    artifacts: z.array(
        z.object({
            type: z.string(),
            url: z.string(),
            label: z.string().optional(),
        })
    ),
    warnings: z.array(z.string()).optional(),
    createdAt: z.string(),
    seoMetadata: z.record(z.string()).optional(),
});
