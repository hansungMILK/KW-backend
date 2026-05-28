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
    'countryball-brief',
    'countryball-angle-lab',
    'countryball-writer-brain',
    'countryball-script',
    'countryball-data',
    'countryball-analysis',
    'countryball-image',
    'countryball-tts',
    'countryball-video',
    'content',
    'data',
    'analysis',
    'media-image',
    'media-tts',
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
    layout: z.string().optional(),
    panelArchetype: z.string().optional(),
    topTitleBand: z.string().optional(),
    captionTreatment: z.string().optional(),
    visualTone: z.string().optional(),
});

const ClaimTypeSchema = z.enum(['fact', 'hypothetical', 'opinion', 'joke']);

const DialogueLineSchema = z.object({
    country: z.string().optional(),
    line: z.string().optional(),
    tone: z.string().optional(),
    speaker: z.string().optional(),
    text: z.string(),
    emotion: z.string().optional(),
    captionStyle: z.string().optional(),
    captionEmphasis: z.array(z.string()).optional(),
    delivery: z.string().optional(),
    meaning: z.string().optional(),
    interpretation: z.string().optional(),
    voiceRole: z.string().optional(),
    durationSec: z.number().optional(),
    pauseAfterMs: z.number().optional(),
});

const NarratorLineSchema = z.union([
    z.string(),
    z.object({
        text: z.string(),
        voiceRole: z.string().optional(),
    }),
]);

const CountryballVoiceRoleSchema = z.enum([
    'narrator_short',
    'main_tired',
    'main_confident',
    'rival_smug',
    'rival_angry',
    'neutral_serious',
    'panic_high',
    'deep_serious',
    'old_teacher',
]);

const CountryballCaptionOverlaySchema = z.object({
    type: z.enum(['dialogue', 'action', 'reaction', 'title', 'ending']),
    text: z.string(),
    speakerCountry: z.string().optional(),
    anchorTarget: z.enum(['speaker', 'sceneCenter', 'topBand', 'bottomBand']),
    preferredPosition: z.enum([
        'upper-left',
        'upper-center',
        'upper-right',
        'middle-left',
        'center',
        'middle-right',
        'lower-left',
        'lower-center',
        'lower-right',
    ]),
    style: z.enum(['whiteBlack', 'yellowBlack', 'redBlack', 'smallWhite', 'titleBand']),
    emphasisWords: z.array(z.string()).optional(),
    avoidZones: z.array(z.string()).optional(),
});

const CountryballDialogueLineSchema = z.object({
    country: z.string(),
    line: z.string(),
    tone: z.string().optional(),
    voiceRole: CountryballVoiceRoleSchema,
    captionEmphasis: z.array(z.string()).optional(),
    pauseAfterMs: z.number().optional(),
});

const CountryballSceneSchema = z.object({
    sceneId: z.string(),
    sceneNumber: z.number().optional(),
    timeRange: z.string().optional(),
    scenePurpose: z.string(),
    location: z.string(),
    visualTone: z.string(),
    screenAction: z.string(),
    dialogueLines: z.array(CountryballDialogueLineSchema),
    expressionChanges: z.array(z.string()),
    sfx: z.array(z.string()),
    editBeat: z.string(),
    narratorLine: NarratorLineSchema.nullable().optional(),
    captionOverlay: z.array(CountryballCaptionOverlaySchema),
    props: z.array(z.string()).optional(),
    imagePrompt: z.string().optional(),
    durationSec: z.number().optional(),
});

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
    requestTopic: z.string().optional(),
    requestSpec: z.record(z.string(), z.unknown()).optional(),
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
            coverage: z.record(z.string(), z.unknown()).optional(),
        })
    ),
    trendScore: z.number().optional(),
    retrievedAt: z.string().optional(),
    presetId: z.string().optional(),
});

/** countryball-brief block */
export const CountryballBriefOutputSchema = z.object({
    mode: z.literal('countryball-brief'),
    presetId: z.literal('countryball-shorts'),
    requestTopic: z.string().optional(),
    requestSpec: z.record(z.string(), z.unknown()).optional(),
    keywords: z.array(z.string()).optional(),
    articles: z.array(SourceRefSchema).optional(),
    countryballBrief: z
        .object({
            targetCountry: z.string().optional(),
            storyGenre: z.string().optional(),
            targetFeature: z.string().optional(),
            mainConflict: z.string().optional(),
            recommendedSceneCount: z.number().optional(),
            scriptVariables: z.record(z.string(), z.unknown()).optional(),
            storyFlow: z.array(z.string()).optional(),
            cast: z.array(z.record(z.string(), z.unknown())).optional(),
            visualTheme: z.string().optional(),
            soundMapping: z.record(z.string(), z.unknown()).optional(),
            endingPayoff: z.string().optional(),
            thumbnailTexts: z.array(z.string()).optional(),
        })
        .passthrough(),
});

const CountryballAngleMechanismSchema = z.object({
    id: z.string(),
    reason: z.string().optional(),
});

const CountryballAngleOptionSchema = z
    .object({
        id: z.string(),
        title: z.string(),
        oneLinePitch: z.string(),
        coreObservation: z.string().optional(),
        selectedMechanisms: z.array(CountryballAngleMechanismSchema).min(1),
        storyShape: z
            .object({
                opening: z.string(),
                middleEscalation: z.string(),
                peakMoment: z.string(),
                endingPayoff: z.string(),
            })
            .passthrough(),
        scenePreview: z
            .array(
                z
                    .object({
                        beat: z.number(),
                        scene: z.string(),
                        whyItWorks: z.string().optional(),
                    })
                    .passthrough()
            )
            .min(3),
        characterUse: z.record(z.string(), z.unknown()).optional(),
        informationStrategy: z
            .object({
                directInfo: z.array(z.string()).optional(),
                visualInfo: z.array(z.string()).optional(),
                hiddenBackgroundInfo: z.array(z.string()).optional(),
            })
            .passthrough()
            .optional(),
        thumbnailPotential: z.string().optional(),
        strength: z.string().optional(),
        risk: z.string().optional(),
        bestFor: z.string().optional(),
        score: z.record(z.string(), z.number()).optional(),
    })
    .passthrough();

/** countryball-angle-lab block */
export const CountryballAngleLabOutputSchema = z.object({
    mode: z.literal('countryball-angle-lab'),
    presetId: z.literal('countryball-shorts'),
    requestTopic: z.string().optional(),
    angleOptions: z.array(CountryballAngleOptionSchema).length(3),
    selectedAngleId: z.string().optional(),
    selectedAngle: CountryballAngleOptionSchema.optional(),
    angleSelectionStatus: z.enum(['pending', 'selected']).optional(),
    recommendedChoice: z
        .object({
            id: z.string(),
            reason: z.string().optional(),
        })
        .passthrough(),
    selectionPrompt: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
});

/** countryball-writer-brain block */
export const CountryballWriterBrainOutputSchema = z
    .object({
        mode: z.literal('countryball-writer-brain'),
        presetId: z.literal('countryball-shorts'),
        selectedAngleId: z.string(),
        writerBrain: z.record(z.string(), z.unknown()),
        storyBrief: z
            .object({
                setting: z.string().optional(),
                characterEngine: z.record(z.string(), z.unknown()).optional(),
                sceneFlow: z.array(z.record(z.string(), z.unknown())).min(1),
            })
            .passthrough(),
        informationControl: z
            .object({
                canSayDirectly: z.array(z.string()).optional(),
                showVisually: z.array(z.string()).optional(),
                backgroundOnly: z.array(z.string()).optional(),
                mustNotSayLikeLecture: z.array(z.string()).optional(),
            })
            .passthrough(),
        scriptRules: z.record(z.string(), z.unknown()).optional(),
        recommendedSceneCount: z.number().optional(),
        metadata: z.record(z.unknown()).optional(),
    })
    .passthrough();

/** countryball-script block */
export const CountryballScriptOutputSchema = z.object({
    mode: z.literal('countryball-script'),
    presetId: z.literal('countryball-shorts'),
    narrativeMode: z.literal('countryball-dialogue-skit'),
    title: z.string(),
    topic: z.string().optional(),
    cast: z.array(
        z.object({
            country: z.string(),
            role: z.string().optional(),
            defaultEmotion: z.string().optional(),
            voiceRole: CountryballVoiceRoleSchema.optional(),
        })
    ),
    scenes: z.array(CountryballSceneSchema).min(1),
    thumbnailTexts: z.array(z.string()).optional(),
    metadata: z.record(z.unknown()).optional(),
});

/** countryball-data block */
export const CountryballDataOutputSchema = z.object({
    mode: z.literal('countryball-data'),
    presetId: z.literal('countryball-shorts'),
    normalizedScenes: z.array(CountryballSceneSchema).min(1),
    cast: CountryballScriptOutputSchema.shape.cast,
    metadata: z.record(z.unknown()).optional(),
});

/** countryball-image block */
export const CountryballImageOutputSchema = z.object({
    images: z.array(
        z.object({
            sceneNumber: z.number(),
            sceneId: z.string().optional(),
            url: z.string(),
            width: z.number(),
            height: z.number(),
            prompt: z.string(),
            captionOverlay: z.array(CountryballCaptionOverlaySchema).optional(),
        })
    ),
    normalizedScenes: z.array(CountryballSceneSchema).optional(),
    metadata: z.record(z.unknown()).optional(),
});

/** countryball-tts block */
export const CountryballTtsOutputSchema = z.object({
    audio: z.object({
        url: z.string(),
        durationSec: z.number(),
        format: z.string(),
        sampleRate: z.number().optional(),
        provider: z.string().optional(),
        model: z.string().optional(),
        voiceMode: z.literal('countryball-role-voices').optional(),
        voiceSegments: z
            .array(
                z.object({
                    sceneId: z.string().optional(),
                    sceneNumber: z.number(),
                    country: z.string(),
                    text: z.string(),
                    voiceRole: z.string(),
                    voiceId: z.string(),
                    durationSec: z.number().optional(),
                    pauseAfterMs: z.number().optional(),
                })
            )
            .optional(),
    }),
    narrationText: z.string().optional(),
    subtitleCues: z
        .array(
            z.object({
                sceneNumber: z.number(),
                text: z.string(),
                role: z.enum(['title', 'dialogue', 'action', 'reaction', 'ending']).optional(),
                speakerCountry: z.string().optional(),
                startSec: z.number(),
                endSec: z.number(),
            })
        )
        .optional(),
    normalizedScenes: z.array(CountryballSceneSchema).optional(),
    metadata: z.record(z.unknown()).optional(),
});

/** content block */
export const ContentOutputSchema = z.object({
    title: z.string().optional(),
    mode: z.string().optional(),
    outputKind: z.string().optional(),
    promptPlan: z.record(z.string(), z.unknown()).optional(),
    requestTopic: z.string().optional(),
    requestSpec: z.record(z.string(), z.unknown()).optional(),
    outputContract: z.record(z.string(), z.unknown()).optional(),
    sourceCoverage: z.array(z.record(z.string(), z.unknown())).optional(),
    countryballBrief: CountryballBriefOutputSchema.shape.countryballBrief.optional(),
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
            visualStyle: z.string().optional(),
            narrativeMode: z.string().optional(),
            requestBasis: z.string().optional(),
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
            scenePurpose: z.string().optional(),
            location: z.string().optional(),
            visualTone: z.string().optional(),
            screenAction: z.string().optional(),
            characters: z.array(z.record(z.unknown())).optional(),
            dramatizedAction: z.string().optional(),
            dialogueLines: z.array(DialogueLineSchema.or(z.string())).optional(),
            expressionChanges: z.array(z.string()).optional(),
            sfx: z.array(z.string()).optional(),
            editBeat: z.string().optional(),
            audioEvents: z.array(z.record(z.unknown())).optional(),
            interpretation: z.string().optional(),
            narratorLine: NarratorLineSchema.optional(),
            factualClaim: z.string().optional(),
            evidenceRefs: z.array(SourceRefSchema.or(z.string())).optional(),
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
            scenePurpose: z.string().optional(),
            location: z.string().optional(),
            visualTone: z.string().optional(),
            screenAction: z.string().optional(),
            characters: z.array(z.record(z.unknown())).optional(),
            dramatizedAction: z.string().optional(),
            dialogueLines: z.array(DialogueLineSchema.or(z.string())).optional(),
            expressionChanges: z.array(z.string()).optional(),
            sfx: z.array(z.string()).optional(),
            editBeat: z.string().optional(),
            audioEvents: z.array(z.record(z.unknown())).optional(),
            interpretation: z.string().optional(),
            narratorLine: NarratorLineSchema.optional(),
            factualClaim: z.string().optional(),
            evidenceRefs: z.array(SourceRefSchema.or(z.string())).optional(),
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
    autoRemediations: z
        .array(
            z.object({
                sceneNumber: z.number(),
                action: z.string(),
                before: z.string(),
                after: z.string(),
                reason: z.string(),
            })
        )
        .optional(),
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
