import { z } from 'zod';

/**
 * Block Definition — the source of truth for what a block IS.
 * Stored in BlockDefinitionsTable, versioned, workspace-scoped.
 *
 * This is NOT the runtime executor — it's the metadata/contract layer.
 * Runtime execution is handled by block-registry (executor lookup).
 * Catalog (this) and registry are separate concerns.
 */

// ============================================================================
// Portable Schema DSL (JSON Schema subset, LLM-generatable)
// ============================================================================

export const PortableFieldSchema: z.ZodType<unknown> = z.lazy(() =>
    z.object({
        type: z.enum(['string', 'number', 'boolean', 'array', 'object']),
        description: z.string().optional(),
        default: z.unknown().optional(),
        enum: z.array(z.string()).optional(),
        minLength: z.number().optional(),
        maxLength: z.number().optional(),
        minimum: z.number().optional(),
        maximum: z.number().optional(),
        items: z.lazy(() => PortableFieldSchema).optional(),
        minItems: z.number().optional(),
        maxItems: z.number().optional(),
        properties: z.record(z.lazy(() => PortableFieldSchema)).optional(),
        required: z.array(z.string()).optional(),
    })
);

export const PortableSchemaSchema = z.object({
    type: z.literal('object'),
    properties: z.record(PortableFieldSchema),
    required: z.array(z.string()).optional(),
});

export type PortableSchema = z.infer<typeof PortableSchemaSchema>;

// ============================================================================
// Enums
// ============================================================================

export const ExecutionModeSchema = z.enum(['builtin', 'prompt-agent', 'domain-pack']);
export const BlockSourceSchema = z.enum(['builtin', 'domain-pack', 'ai-generated', 'user-created']);

// ============================================================================
// BlockDefinition model
// ============================================================================

export const BlockDefinitionSchema = z.object({
    // Identity — PK=type, SK=version
    id: z.string(),
    type: z.string(),
    version: z.string(),
    isLatest: z.boolean(),

    // Scope
    workspaceId: z.string().nullable().optional(),

    // Display
    name: z.string(),
    description: z.string(),
    category: z.string(),
    icon: z.string().optional(),

    // Execution contract (PortableSchema DSL)
    executionMode: ExecutionModeSchema,
    inputSchema: PortableSchemaSchema,
    outputSchema: PortableSchemaSchema,
    configSchema: PortableSchemaSchema,

    // Agent behavior (prompt-agent only, nullable for builtin)
    systemPrompt: z.string().nullable().optional(),
    promptTemplate: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    temperature: z.number().nullable().optional(),
    maxTokens: z.number().nullable().optional(),
    outputFormat: z.enum(['json', 'text', 'markdown']).nullable().optional(),

    // Constraints
    costHint: z
        .object({
            currency: z.string(),
            estimated: z.number(),
        })
        .nullable()
        .optional(),
    requiredSecrets: z.array(z.string()).optional(),
    allowedModels: z.array(z.string()).optional(),
    maxExecutionSec: z.number().nullable().optional(),

    // Provenance
    source: BlockSourceSchema,
    domainPack: z.string().nullable().optional(),
    createdBy: z.string().nullable().optional(),
    approved: z.boolean(),

    // Timestamps
    createdAt: z.string(),
    updatedAt: z.string(),
});

export type BlockDefinitionModel = z.infer<typeof BlockDefinitionSchema>;

// ============================================================================
// GET /blocks/{type}
// ============================================================================

export const BlockDefGetParamsSchema = z.object({
    type: z.string().min(1),
});

export const BlockDefGetResponseSchema = BlockDefinitionSchema;

// ============================================================================
// GET /blocks/definitions (list all latest)
// ============================================================================

export const BlockDefListResponseSchema = z.object({
    items: z.array(BlockDefinitionSchema),
});
