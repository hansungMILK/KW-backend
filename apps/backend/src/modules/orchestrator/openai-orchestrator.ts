import { ORCHESTRATOR_SYSTEM_PROMPT, PROMPT_VERSION, buildUserPrompt } from './prompt-templates';
import { parseClaudeResponse } from './response-parser';
import { compileWorkflowPlan } from './workflow-compiler';
import { openaiAdapter } from '../../adapters/ai/openai-adapter';
import { env } from '../../config/env';
import { traceService } from '../../services/trace-service';
import { generateNumericId } from '../../utils/id-generator';
import { log } from '../../utils/logger';

import type { AllowedBlockType } from './response-parser';
import type { Orchestrator, ProposalResult } from './types';

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
    'media-image': 0.11,
    'media-tts': 0.01,
    'media-video': 0.2,
    integration: 0.01,
};

export const openaiOrchestrator: Orchestrator = {
    async generateProposal(
        flowId: string,
        userMessage: string,
        currentContext?: Record<string, unknown>
    ): Promise<ProposalResult> {
        const startMs = Date.now();

        try {
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

            const { data } = compileResult;
            const nodes = data.blocks.map((block, i) => ({
                id: generateNumericId(),
                blockId: `blk-${block.type}`,
                name: block.label,
                blockType: block.type,
                type: block.type,
                position: { x: 300, y: 100 + i * 120 },
                state: 'IDLE',
                config: block.config,
            }));

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
                amount: COST_ESTIMATES[b.type] ?? 0.01,
            }));
            const total = data.estimatedCostUsd || breakdown.reduce((sum, b) => sum + b.amount, 0);

            await traceService.record(flowId, null, 'TOOL_RESULT', 'OpenAI proposal generated', {
                promptVersion: PROMPT_VERSION,
                blockCount: nodes.length,
                edgeCount: edges.length,
                estimatedCost: total,
                plan: data.plan,
                latencyMs: Date.now() - startMs,
            });

            return {
                proposedNodes: nodes,
                proposedEdges: edges,
                estimatedCost: {
                    currency: 'USD',
                    total: Math.round(total * 100) / 100,
                    breakdown,
                },
                approvalRequired: true,
                assistantMessage:
                    data.summary ||
                    `${nodes.length}개 블록이 필요합니다. 예상 비용: $${total.toFixed(2)}. 승인하시겠습니까?`,
            };
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
