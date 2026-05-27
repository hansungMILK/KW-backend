import { z } from 'zod';

import { log } from '../../utils/logger';

/**
 * Parses and validates Claude's JSON response into a typed proposal structure.
 * On validation failure: returns { ok: false } with error details for trace logging.
 */

// ============================================================================
// Schema for Claude's expected output
// ============================================================================

export const ALLOWED_BLOCK_TYPES = [
    'input-text',
    'input-image',
    'output-preview',
    'buffer-delay',
    'text-transform',
    'search',
    'countryball-brief',
    'countryball-script',
    'countryball-data',
    'countryball-analysis',
    'countryball-image',
    'countryball-tts',
    'countryball-video',
    'content',
    'media-image',
    'media-tts',
    'data',
    'analysis',
    'media-video',
    'integration',
    'longform-source',
    'longform-brief',
    'longform-script',
    'longform-storyboard',
    'longform-scene-json',
    'longform-review',
    'longform-tts',
    'longform-srt-align',
    'longform-motion-compose',
    'longform-render',
    'longform-qa',
    'longform-package',
] as const;

export type AllowedBlockType = (typeof ALLOWED_BLOCK_TYPES)[number];

const BlockSchema = z.object({
    type: z.enum(ALLOWED_BLOCK_TYPES),
    label: z.string(),
    config: z.record(z.unknown()).optional().default({}),
});

const EdgeSchema = z.object({
    from: z.number().int().min(0),
    to: z.number().int().min(0),
});

const WorkflowPlanSchema = z.object({
    goal: z.string().min(1),
    outputType: z.enum(['text', 'data', 'image', 'audio', 'video', 'automation', 'mixed']),
    planType: z.enum(['one-shot', 'pipeline', 'scheduled', 'interactive']),
    requiredCapabilities: z.array(z.string()).default([]),
    selectedBlocks: z
        .array(
            z.object({
                blockType: z.enum(ALLOWED_BLOCK_TYPES),
                reason: z.string().min(1),
            })
        )
        .min(1),
    rejectedBlocks: z
        .array(
            z.object({
                blockType: z.enum(ALLOWED_BLOCK_TYPES),
                reason: z.string().min(1),
            })
        )
        .default([]),
    assumptions: z.array(z.string()).default([]),
});

export const ClaudeProposalOutputSchema = z.object({
    plan: WorkflowPlanSchema,
    blocks: z.array(BlockSchema).min(1),
    edges: z.array(EdgeSchema),
    estimatedCostUsd: z.number().min(0),
    summary: z.string(),
});

export type ClaudeProposalOutput = z.infer<typeof ClaudeProposalOutputSchema>;

// ============================================================================
// Parser
// ============================================================================

export interface ParseSuccess {
    ok: true;
    data: ClaudeProposalOutput;
}

export interface ParseFailure {
    ok: false;
    rawContent: string;
    error: string;
    zodErrors?: z.ZodError['issues'];
}

export type ParseResult = ParseSuccess | ParseFailure;

export const parseClaudeResponse = (rawContent: string): ParseResult => {
    // Step 1: Extract JSON from response (handle markdown fences)
    let jsonStr = rawContent.trim();

    // Strip markdown code fences if present
    const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch) {
        jsonStr = fenceMatch[1].trim();
    }

    // Step 2: Parse JSON
    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonStr);
    } catch (err) {
        log.warn('Claude response is not valid JSON', { contentLength: rawContent.length });
        return {
            ok: false,
            rawContent,
            error: `JSON parse error: ${err instanceof Error ? err.message : String(err)}`,
        };
    }

    // Step 3: Validate with zod
    const result = ClaudeProposalOutputSchema.safeParse(parsed);
    if (!result.success) {
        log.warn('Claude response failed schema validation', {
            issues: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
        });
        return {
            ok: false,
            rawContent,
            error: 'Schema validation failed',
            zodErrors: result.error.issues,
        };
    }

    return { ok: true, data: result.data };
};
