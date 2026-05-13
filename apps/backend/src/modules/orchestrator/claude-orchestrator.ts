import { buildLongformGateAWorkflow, enforceLongformGateAProfile, isLongformContentProfile } from './longform-gate-a';
import { ORCHESTRATOR_SYSTEM_PROMPT, PROMPT_VERSION, buildUserPrompt } from './prompt-templates';
import { parseClaudeResponse } from './response-parser';
import { compileWorkflowPlan, seedRootBlockInputs } from './workflow-compiler';
import { claudeAdapter } from '../../adapters/ai/claude-adapter';
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

import type { AllowedBlockType } from './response-parser';
import type { Orchestrator, ProposalResult } from './types';

const MODEL = env.anthropicDefaultModel;

const COST_ESTIMATES: Record<AllowedBlockType, number> = {
    'input-text': 0,
    'input-image': 0,
    'output-preview': 0,
    'buffer-delay': 0,
    'text-transform': 0,
    search: 0.02,
    content: 0.15,
    data: 0.01,
    analysis: 0.05,
    'media-image': 0,
    'media-tts': 0.1,
    'media-video': 0.2,
    integration: 0.02,
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

/**
 * Claude-based orchestrator.
 * Calls Claude API → parses JSON → validates with zod → builds proposal.
 * On failure: returns fallback error proposal with assistant error message.
 */
export const claudeOrchestrator: Orchestrator = {
    async generateProposal(
        flowId: string,
        userMessage: string,
        currentContext?: Record<string, unknown>
    ): Promise<ProposalResult> {
        const startMs = Date.now();

        try {
            // 1. Call Claude
            const response = await claudeAdapter.chat({
                model: MODEL,
                systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
                userMessage: buildUserPrompt(
                    userMessage,
                    currentContext ? JSON.stringify(currentContext, null, 2) : undefined
                ),
                maxTokens: 2048,
                temperature: 0.3,
            });

            // 2. Record trace: TOOL_CALL
            await traceService.record(flowId, null, 'TOOL_CALL', 'Claude orchestrator call', {
                promptVersion: PROMPT_VERSION,
                model: response.model,
                inputTokens: response.inputTokens,
                outputTokens: response.outputTokens,
                latencyMs: response.latencyMs,
                stopReason: response.stopReason,
            });

            // 3. Parse and validate
            const parseResult = parseClaudeResponse(response.content);

            if (!parseResult.ok) {
                // Record validation failure trace
                await traceService.record(flowId, null, 'ERROR', 'Claude output validation failed', {
                    error: parseResult.error,
                    zodErrors: parseResult.zodErrors,
                    rawContentLength: parseResult.rawContent.length,
                });

                // Return fallback error proposal
                return buildFallbackProposal(`AI 응답을 처리할 수 없습니다. 다시 시도해주세요. (${parseResult.error})`);
            }

            const contentProfile = buildContentProfilePreferences({
                userMessage,
                outputType: parseResult.data.plan.outputType,
                hasMediaVideo: parseResult.data.blocks.some(block => block.type === 'media-video'),
                hasMediaImage: parseResult.data.blocks.some(block => block.type === 'media-image'),
            });
            const enforcedContentProfile = enforceLongformGateAProfile(contentProfile);
            let data = buildLongformGateAWorkflow(userMessage, enforcedContentProfile);
            if (!isLongformContentProfile(enforcedContentProfile.contentProfileId)) {
                const compileResult = compileWorkflowPlan(parseResult.data);
                if (!compileResult.ok) {
                    await traceService.record(flowId, null, 'ERROR', 'Claude workflow plan rejected', {
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

            // 4. Convert to ProposalResult
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
                    position: { x: 300, y: 100 + i * 120 },
                    state: 'IDLE',
                    config: enrichContentProfileNodeConfig(config, enforcedContentProfile, block.type),
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

            // Record success trace
            await traceService.record(flowId, null, 'TOOL_RESULT', 'Claude proposal generated', {
                promptVersion: PROMPT_VERSION,
                blockCount: nodes.length,
                edgeCount: edges.length,
                estimatedCost: total,
                contentProfileId: enforcedContentProfile.contentProfileId,
                scriptToneId: enforcedContentProfile.scriptToneId,
                reviewMode: enforcedContentProfile.reviewMode,
                plan: data.plan,
                latencyMs: Date.now() - startMs,
            });

            return {
                proposedNodes: nodes,
                proposedEdges: edges,
                estimatedCost: {
                    currency: 'USD',
                    total: roundUsd(total),
                    breakdown,
                },
                metadata: {
                    ...(imageGeneration ? { imageGeneration } : {}),
                    contentProfile: enforcedContentProfile,
                },
                approvalRequired: true,
                assistantMessage:
                    data.summary ||
                    `${nodes.length}개 블록이 필요합니다. 예상 비용: $${total.toFixed(2)}. 승인하시겠습니까?`,
            };
        } catch (err) {
            const latencyMs = Date.now() - startMs;
            log.error('Claude orchestrator failed', err);

            // Record provider failure trace
            await traceService.record(flowId, null, 'ERROR', 'Claude provider error', {
                error: err instanceof Error ? err.message : String(err),
                latencyMs,
                // Never log the full error stack in production traces
            });

            return buildFallbackProposal('AI 서비스에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해주세요.');
        }
    },
};

/**
 * Fallback proposal: empty blocks, error message as assistant response.
 * System doesn't crash; user gets a meaningful error message in chat.
 */
function buildFallbackProposal(errorMessage: string): ProposalResult {
    return {
        proposedNodes: [],
        proposedEdges: [],
        estimatedCost: { currency: 'USD', total: 0 },
        approvalRequired: false,
        assistantMessage: errorMessage,
    };
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
