import { buildLongformGateAWorkflow, enforceLongformGateAProfile, isLongformContentProfile } from './longform-gate-a';
import { ORCHESTRATOR_SYSTEM_PROMPT, PROMPT_VERSION, buildUserPrompt } from './prompt-templates';
import { parseClaudeResponse } from './response-parser';
import { compileWorkflowPlan, seedRootBlockInputs } from './workflow-compiler';
import { openaiAdapter } from '../../adapters/ai/openai-adapter';
import { env } from '../../config/env';
import { traceService } from '../../services/trace-service';
import { generateNumericId } from '../../utils/id-generator';
import { log } from '../../utils/logger';
import { buildContentProfilePreferences, enrichContentProfileNodeConfig } from '../content-profile/content-profile';
import {
    DEFAULT_SHORTS_SCENE_COUNT,
    buildImageGenerationPreferences,
    enrichImageNodeConfig,
    estimateGptImage2CostUsd,
    roundUsd,
} from '../image-generation/image-style';
import { DEFAULT_WORKFLOW_PACK_REGISTRY } from '../workflow-packs';

import type { AllowedBlockType, ClaudeProposalOutput } from './response-parser';
import type { Orchestrator, ProposalResult } from './types';
import type { ContentProfilePreferences } from '../content-profile/content-profile';
import type { WorkflowRecipeManifest } from '../workflow-packs';

const COST_ESTIMATES: Record<AllowedBlockType, number> = {
    'input-text': 0,
    'input-image': 0,
    'output-preview': 0,
    'buffer-delay': 0,
    'text-transform': 0,
    search: 0.01,
    content: 0.03,
    data: 0.01,
    analysis: 0.01,
    'media-image': 0,
    'media-tts': 0.01,
    'media-video': 0.2,
    integration: 0.01,
    'longform-source': 0.02,
    'longform-brief': 0.03,
    'longform-script': 0.04,
    'longform-storyboard': 0.03,
    'longform-scene-json': 0.02,
    'longform-review': 0.02,
    'longform-tts': 0.08,
    'longform-srt-align': 0.01,
    'longform-motion-compose': 0.05,
    'longform-render': 0.5,
    'longform-qa': 0.01,
    'longform-package': 0.01,
};

const LONGFORM_ORCHESTRATOR_DECISION_SYSTEM_PROMPT = `You are an AI longform workflow planner for a node-based automation product.
Decide the production intent for a Korean longform video request before the system compiles it into safe executable nodes.

Do not return executable workflow nodes. The backend compiler owns node IDs, graph shape, paid execution guards, and renderer safety.
Return compact JSON only:
{
  "plan": {
    "goal": "user-facing goal",
    "outputType": "video",
    "planType": "interactive",
    "strategy": "how the workflow should approach this topic"
  },
  "contentJudgment": {
    "primaryTask": "explain|analyze|compare|tutorial|other",
    "sourcePolicy": "url-primary|web-research|mixed",
    "scriptToneId": "informative-reframe|news-anchor|conversation-story|mz-shortform",
    "whyThisTone": "short reason"
  },
  "productionJudgment": {
    "rendererRoute": "hyperframes",
    "requiresUserReview": true,
    "paidMediaAfterReview": true
  },
  "assumptions": ["short assumption"]
}`;

export const openaiOrchestrator: Orchestrator = {
    async generateProposal(
        flowId: string,
        userMessage: string,
        currentContext?: Record<string, unknown>
    ): Promise<ProposalResult> {
        const startMs = Date.now();

        try {
            const deterministicGenericWorkflow = buildDeterministicGenericWorkflow(userMessage);
            if (deterministicGenericWorkflow) {
                const contentProfile = buildContentProfilePreferences({
                    userMessage,
                    outputType: deterministicGenericWorkflow.plan.outputType,
                    hasMediaImage: deterministicGenericWorkflow.blocks.some(block => block.type === 'media-image'),
                    hasMediaVideo: deterministicGenericWorkflow.blocks.some(block => block.type === 'media-video'),
                });
                const proposal = buildProposalResult(deterministicGenericWorkflow, userMessage, contentProfile);
                await traceService.record(flowId, null, 'TOOL_RESULT', 'Deterministic generic proposal generated', {
                    promptVersion: PROMPT_VERSION,
                    blockCount: proposal.proposedNodes.length,
                    edgeCount: proposal.proposedEdges.length,
                    estimatedCost: proposal.estimatedCost.total,
                    contentProfileId: contentProfile.contentProfileId,
                    scriptToneId: contentProfile.scriptToneId,
                    reviewMode: contentProfile.reviewMode,
                    plan: deterministicGenericWorkflow.plan,
                    latencyMs: Date.now() - startMs,
                });
                return proposal;
            }

            const deterministicContentProfile = enforceLongformGateAProfile(
                buildContentProfilePreferences({
                    userMessage,
                    outputType: 'video',
                    hasMediaVideo: true,
                })
            );
            if (isLongformContentProfile(deterministicContentProfile.contentProfileId)) {
                const aiDecisionResponse = await openaiAdapter.chatJson({
                    model: env.openaiOrchestratorModel,
                    systemPrompt: LONGFORM_ORCHESTRATOR_DECISION_SYSTEM_PROMPT,
                    userMessage: buildLongformDecisionPrompt(userMessage, currentContext, deterministicContentProfile),
                    maxTokens: 1200,
                });
                const aiOrchestratorDecision = parseJsonObject(aiDecisionResponse.content);
                const aiContentProfile = buildAiLongformContentProfile(
                    userMessage,
                    deterministicContentProfile,
                    aiOrchestratorDecision
                );
                const data = buildLongformGateAWorkflow(userMessage, aiContentProfile);
                applyAiLongformDecisionToWorkflow(data, aiOrchestratorDecision);
                const proposal = buildProposalResult(data, userMessage, aiContentProfile, {
                    aiOrchestratorDecision,
                });
                await traceService.record(flowId, null, 'TOOL_RESULT', 'AI longform workflow judgment generated', {
                    promptVersion: PROMPT_VERSION,
                    blockCount: proposal.proposedNodes.length,
                    edgeCount: proposal.proposedEdges.length,
                    estimatedCost: proposal.estimatedCost.total,
                    contentProfileId: deterministicContentProfile.contentProfileId,
                    scriptToneId: aiContentProfile.scriptToneId,
                    reviewMode: aiContentProfile.reviewMode,
                    aiDecisionModel: aiDecisionResponse.model,
                    aiDecisionLatencyMs: aiDecisionResponse.latencyMs,
                    plan: data.plan,
                    latencyMs: Date.now() - startMs,
                });
                return proposal;
            }

            const response = await openaiAdapter.chatJson({
                model: env.openaiOrchestratorModel,
                systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
                userMessage: buildUserPrompt(
                    userMessage,
                    currentContext ? JSON.stringify(currentContext, null, 2) : undefined
                ),
                maxTokens: 2048,
            });

            await traceService.record(flowId, null, 'TOOL_CALL', 'OpenAI orchestrator call', {
                promptVersion: PROMPT_VERSION,
                model: response.model,
                inputTokens: response.inputTokens,
                outputTokens: response.outputTokens,
                latencyMs: response.latencyMs,
            });

            const parseResult = parseClaudeResponse(response.content);

            if (!parseResult.ok) {
                await traceService.record(flowId, null, 'ERROR', 'OpenAI output validation failed', {
                    error: parseResult.error,
                    zodErrors: parseResult.zodErrors,
                    rawContentLength: parseResult.rawContent.length,
                });
                return buildFallbackProposal(`AI 응답을 처리할 수 없습니다. 다시 시도해주세요. (${parseResult.error})`);
            }

            const inferredContentProfile = buildContentProfilePreferences({
                userMessage,
                outputType: parseResult.data.plan.outputType,
                hasMediaVideo: parseResult.data.blocks.some(block => block.type === 'media-video'),
                hasMediaImage: parseResult.data.blocks.some(block => block.type === 'media-image'),
            });
            const contentProfile = enforceLongformGateAProfile(inferredContentProfile);
            let data = buildLongformGateAWorkflow(userMessage, contentProfile);
            if (!isLongformContentProfile(contentProfile.contentProfileId)) {
                const compileResult = compileWorkflowPlan(parseResult.data);
                if (!compileResult.ok) {
                    await traceService.record(flowId, null, 'ERROR', 'OpenAI workflow plan rejected', {
                        error: compileResult.error,
                        promptVersion: PROMPT_VERSION,
                        outputType: parseResult.data.plan.outputType,
                        selectedBlocks: parseResult.data.plan.selectedBlocks.map(block => block.blockType),
                    });
                    return buildFallbackProposal(
                        `워크플로우 계획이 요청과 맞지 않습니다. 다시 시도해주세요. (${compileResult.error})`
                    );
                }
                data = seedRootBlockInputs(compileResult.data, userMessage);
            }
            const proposal = buildProposalResult(data, userMessage, contentProfile);

            await traceService.record(flowId, null, 'TOOL_RESULT', 'OpenAI proposal generated', {
                promptVersion: PROMPT_VERSION,
                blockCount: proposal.proposedNodes.length,
                edgeCount: proposal.proposedEdges.length,
                estimatedCost: proposal.estimatedCost.total,
                contentProfileId: contentProfile.contentProfileId,
                scriptToneId: contentProfile.scriptToneId,
                reviewMode: contentProfile.reviewMode,
                plan: data.plan,
                latencyMs: Date.now() - startMs,
            });

            return proposal;
        } catch (err) {
            const latencyMs = Date.now() - startMs;
            log.error('OpenAI orchestrator failed', err);

            await traceService.record(flowId, null, 'ERROR', 'OpenAI provider error', {
                error: err instanceof Error ? err.message : String(err),
                latencyMs,
            });

            return buildFallbackProposal('AI 서비스에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해주세요.');
        }
    },
};

function buildFallbackProposal(errorMessage: string): ProposalResult {
    return {
        proposedNodes: [],
        proposedEdges: [],
        estimatedCost: { currency: 'USD', total: 0 },
        approvalRequired: false,
        assistantMessage: errorMessage,
    };
}

function buildDeterministicGenericWorkflow(userMessage: string): ClaudeProposalOutput | null {
    const normalized = normalizeRequestText(userMessage);
    const hasUrl = /https?:\/\/[^\s"'<>]+/i.test(userMessage);
    const wantsVideo =
        /쇼츠|shorts|릴스|reels|틱톡|tiktok|롱폼|longform|긴영상|영상|비디오|video|mp4|유튜브|youtube/.test(normalized);
    const wantsImage = /이미지|그림|사진|일러스트|삽화|썸네일|image|picture|photo|illustration|thumbnail/.test(
        normalized
    );
    const wantsTextWriting =
        /블로그|글|본문|문서|아티클|포스트|설명문|요약문|blog|article|post|document|write/.test(normalized) ||
        (hasUrl && /설명|요약|정리|분석|해설|읽어|explain|summarize|analyze|brief/.test(normalized));

    if (wantsVideo) return null;

    if (wantsImage && !wantsTextWriting) {
        return buildWorkflowFromRecipe('image.single.v1', userMessage, {
            summary: '요청한 이미지를 만들기 위해 프롬프트를 정리한 뒤 단일 이미지를 생성합니다.',
            blockConfigOverrides: {
                content: {
                    topic: userMessage.trim() || '이미지 생성',
                    scenes: 1,
                },
                'media-image': {
                    count: 1,
                },
            },
        });
    }

    if (wantsTextWriting) {
        return buildWorkflowFromRecipe(hasUrl ? 'text.url-explainer.v1' : 'text.blog.v1', userMessage, {
            summary: hasUrl
                ? 'URL 원문을 수집한 뒤 블로그나 설명문으로 읽기 좋은 글을 생성합니다.'
                : '요청한 주제로 블로그나 문서에 바로 쓸 수 있는 글을 생성합니다.',
            blockConfigOverrides: hasUrl
                ? {
                      search: { query: userMessage.trim() || 'URL 설명' },
                      content: { topic: userMessage.trim() || '글 작성' },
                  }
                : {
                      content: { topic: userMessage.trim() || '글 작성' },
                  },
        });
    }

    return null;
}

function buildWorkflowFromRecipe(
    recipeId: string,
    userMessage: string,
    options: {
        summary: string;
        blockConfigOverrides?: Record<string, Record<string, unknown>>;
    }
): ClaudeProposalOutput {
    const recipe = DEFAULT_WORKFLOW_PACK_REGISTRY.getRecipe(recipeId);
    if (!recipe) {
        throw new Error(`Missing workflow recipe: ${recipeId}`);
    }
    const blocks = recipe.defaultBlocks.map(block => ({
        type: block.blockType as AllowedBlockType,
        label: block.label,
        config: {
            ...block.config,
            ...(options.blockConfigOverrides?.[block.blockType] ?? {}),
        },
    }));

    return {
        plan: {
            goal: buildRecipeGoal(recipe, userMessage),
            outputType: recipe.outputType,
            planType: 'pipeline',
            requiredCapabilities: recipe.requiredCapabilities,
            selectedBlocks: recipe.defaultBlocks.map(block => ({
                blockType: block.blockType as AllowedBlockType,
                reason: `${recipe.displayName} 레시피에 필요한 ${block.label} 단계`,
            })),
            rejectedBlocks: buildGenericRejectedBlocks(recipe),
            assumptions: [recipe.description],
        },
        blocks,
        edges: recipe.defaultEdges,
        estimatedCostUsd: recipe.costPolicy?.estimatedCostUsd ?? 0,
        summary: options.summary,
    };
}

function buildRecipeGoal(recipe: WorkflowRecipeManifest, userMessage: string): string {
    const topic = userMessage.trim();
    if (topic) return `${topic} 요청을 ${recipe.displayName} 레시피로 처리한다`;
    return recipe.description;
}

function buildGenericRejectedBlocks(recipe: WorkflowRecipeManifest): ClaudeProposalOutput['plan']['rejectedBlocks'] {
    const selected = new Set(recipe.defaultBlocks.map(block => block.blockType));
    const candidates: Array<{ blockType: AllowedBlockType; reason: string }> = [
        { blockType: 'search', reason: '자료 수집이 필요하지 않은 요청이면 제외한다' },
        { blockType: 'media-image', reason: '이미지 산출물이 아니면 제외한다' },
        { blockType: 'media-tts', reason: '음성 산출물이 아니면 제외한다' },
        { blockType: 'media-video', reason: '영상 산출물이 아니면 제외한다' },
        { blockType: 'integration', reason: '배포 메타데이터가 필요하지 않으면 제외한다' },
    ];
    return candidates.filter(candidate => !selected.has(candidate.blockType));
}

function normalizeRequestText(text: string): string {
    return text.toLowerCase().replace(/\s+/g, '');
}

function buildAiLongformContentProfile(
    userMessage: string,
    base: ContentProfilePreferences,
    aiOrchestratorDecision: Record<string, unknown>
): ContentProfilePreferences {
    return enforceLongformGateAProfile(
        buildContentProfilePreferences({
            userMessage,
            outputType: 'video',
            hasMediaVideo: true,
            contentProfileId: base.contentProfileId,
            scriptToneId:
                readNestedString(aiOrchestratorDecision, ['contentJudgment', 'scriptToneId']) ?? base.scriptToneId,
            scriptToneIntensity: base.scriptToneIntensity,
            reviewMode: base.reviewMode,
        })
    );
}

function applyAiLongformDecisionToWorkflow(
    data: ClaudeProposalOutput,
    aiOrchestratorDecision: Record<string, unknown>
): void {
    const aiGoal = readNestedString(aiOrchestratorDecision, ['plan', 'goal']);
    const aiStrategy = readNestedString(aiOrchestratorDecision, ['plan', 'strategy']);
    const sourcePolicy = readNestedString(aiOrchestratorDecision, ['contentJudgment', 'sourcePolicy']);
    const primaryTask = readNestedString(aiOrchestratorDecision, ['contentJudgment', 'primaryTask']);
    const whyThisTone = readNestedString(aiOrchestratorDecision, ['contentJudgment', 'whyThisTone']);
    const assumptions = readNestedStringArray(aiOrchestratorDecision, ['assumptions']);

    if (aiGoal) data.plan.goal = aiGoal;
    if (assumptions.length > 0) data.plan.assumptions = assumptions;

    for (const block of data.blocks) {
        if (!block.type.startsWith('longform-')) continue;
        block.config = {
            ...block.config,
            ...(aiStrategy ? { orchestratorStrategy: aiStrategy } : {}),
            ...(sourcePolicy ? { orchestratorSourcePolicy: sourcePolicy } : {}),
            ...(primaryTask ? { orchestratorPrimaryTask: primaryTask } : {}),
            ...(whyThisTone ? { orchestratorToneReason: whyThisTone } : {}),
        };
    }
}

function buildProposalResult(
    data: ClaudeProposalOutput,
    userMessage: string,
    contentProfile: ContentProfilePreferences,
    extraMetadata: Record<string, unknown> = {}
): ProposalResult {
    const mediaImageBlock = data.blocks.find(block => block.type === 'media-image');
    const sceneCount = resolveProposalSceneCount(userMessage, data);
    const textAndOtherEstimatedCostUsd = estimateNonImageCostUsd(data.blocks);
    const imageGeneration = mediaImageBlock
        ? buildImageGenerationPreferences({
              userMessage,
              sceneCount,
              imageQuality: mediaImageBlock.config?.['imageQuality'] ?? env.openaiImageQuality,
              imageStyleId: mediaImageBlock.config?.['imageStyleId'] ?? mediaImageBlock.config?.['style'],
              textAndOtherEstimatedCostUsd,
          })
        : undefined;

    const nodes = data.blocks.map((block, i) => {
        const config =
            block.type === 'media-image' && imageGeneration
                ? enrichImageNodeConfig(block.config, imageGeneration)
                : block.config;
        return {
            id: generateNumericId(),
            blockId: `blk-${block.type}`,
            name: block.label,
            blockType: block.type,
            type: block.type,
            position: { x: 300, y: 100 + i * 120 },
            state: 'IDLE',
            config: enrichContentProfileNodeConfig(config, contentProfile, block.type),
        };
    });

    const edges = data.edges
        .map(edge => ({
            id: generateNumericId(),
            sourceNodeId: nodes[edge.from]?.id,
            sourcePortId: 'out',
            targetNodeId: nodes[edge.to]?.id,
            targetPortId: 'in',
        }))
        .filter(e => e.sourceNodeId && e.targetNodeId);

    const breakdown = data.blocks.map(b => ({
        blockType: b.type,
        amount:
            b.type === 'media-image'
                ? estimateGptImage2CostUsd(sceneCount, imageGeneration?.imageQuality)
                : (COST_ESTIMATES[b.type] ?? 0.01),
    }));
    const total = imageGeneration?.estimatedTotalCostUsd || data.estimatedCostUsd || sumBreakdown(breakdown);

    return {
        proposedNodes: nodes,
        proposedEdges: edges,
        estimatedCost: {
            currency: 'USD',
            total: roundUsd(total),
            breakdown,
        },
        metadata: {
            ...extraMetadata,
            ...(imageGeneration ? { imageGeneration } : {}),
            contentProfile,
        },
        approvalRequired: true,
        assistantMessage:
            data.summary || `${nodes.length}개 블록이 필요합니다. 예상 비용: $${total.toFixed(2)}. 승인하시겠습니까?`,
    };
}

function buildLongformDecisionPrompt(
    userMessage: string,
    currentContext: Record<string, unknown> | undefined,
    contentProfile: ContentProfilePreferences
): string {
    return [
        `USER_REQUEST:\n${userMessage}`,
        `DETECTED_CONTENT_PROFILE:\n${JSON.stringify(contentProfile, null, 2)}`,
        currentContext ? `CURRENT_CONTEXT:\n${JSON.stringify(currentContext, null, 2)}` : undefined,
    ]
        .filter(Boolean)
        .join('\n\n');
}

function parseJsonObject(content: string): Record<string, unknown> {
    const trimmed = content.trim();
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    const json = start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('OpenAI longform planner returned a non-object JSON payload');
    }
    return parsed as Record<string, unknown>;
}

function readNestedString(record: Record<string, unknown>, path: string[]): string | undefined {
    let current: unknown = record;
    for (const segment of path) {
        if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
        current = (current as Record<string, unknown>)[segment];
    }
    return typeof current === 'string' && current.trim() ? current.trim() : undefined;
}

function readNestedStringArray(record: Record<string, unknown>, path: string[]): string[] {
    let current: unknown = record;
    for (const segment of path) {
        if (!current || typeof current !== 'object' || Array.isArray(current)) return [];
        current = (current as Record<string, unknown>)[segment];
    }
    if (!Array.isArray(current)) return [];
    return current
        .map(String)
        .map(value => value.trim())
        .filter(Boolean);
}

function resolveProposalSceneCount(
    userMessage: string,
    data: { plan: { outputType: string }; blocks: Array<{ type: string; config?: Record<string, unknown> }> }
): number {
    const explicit = detectRequestedSceneCount(userMessage);
    if (explicit) return explicit;
    if (data.plan.outputType === 'video' || data.blocks.some(block => block.type === 'media-video')) {
        return DEFAULT_SHORTS_SCENE_COUNT;
    }
    const mediaImageBlock = data.blocks.find(block => block.type === 'media-image');
    return getMediaImageSceneCount(mediaImageBlock?.config);
}

function detectRequestedSceneCount(userMessage: string): number | undefined {
    const match = userMessage.match(/(\d{1,2})\s*(?:장|컷|씬|scene|scenes|images?)/i);
    if (!match) return undefined;
    const count = Number(match[1]);
    return Number.isFinite(count) && count > 0 ? Math.min(24, Math.floor(count)) : undefined;
}

function getMediaImageSceneCount(config: Record<string, unknown> | undefined): number {
    const count = Number(config?.['count'] ?? config?.['scenes'] ?? config?.['sceneCount'] ?? config?.['frameCount']);
    return Number.isFinite(count) && count > 0 ? Math.floor(count) : DEFAULT_SHORTS_SCENE_COUNT;
}

function estimateNonImageCostUsd(blocks: Array<{ type: AllowedBlockType }>): number {
    return roundUsd(
        blocks.reduce((sum, block) => {
            if (block.type === 'media-image') return sum;
            return sum + (COST_ESTIMATES[block.type] ?? 0.01);
        }, 0)
    );
}

function sumBreakdown(breakdown: Array<{ amount: number }>): number {
    return roundUsd(breakdown.reduce((sum, item) => sum + item.amount, 0));
}
