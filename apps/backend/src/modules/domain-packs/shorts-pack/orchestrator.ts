/**
 * Shorts-pack orchestrator — domain-specific proposal generation.
 * This is the shorts-specific implementation of the Orchestrator interface.
 *
 * Core orchestrator (modules/orchestrator/) delegates to this when
 * shorts-pack is the active domain.
 */

import {
    SHORTS_ORCHESTRATOR_SYSTEM_PROMPT,
    SHORTS_PROMPT_VERSION,
    buildShortsUserPrompt,
} from './prompts/orchestrator-prompt';
import { SHORTS_COST_PER_BLOCK } from './templates/shorts-8step';
import { claudeAdapter } from '../../../adapters/ai/claude-adapter';
import { traceService } from '../../../services/trace-service';
import { generateNumericId } from '../../../utils/id-generator';
import { log } from '../../../utils/logger';
import { parseClaudeResponse } from '../../orchestrator/response-parser';

import type { Orchestrator, ProposalResult } from '../../orchestrator/types';

const MODEL = 'claude-haiku-4-5-20251001';

export const shortsOrchestrator: Orchestrator = {
    async generateProposal(flowId: string, userMessage: string): Promise<ProposalResult> {
        const startMs = Date.now();

        try {
            const response = await claudeAdapter.chat({
                model: MODEL,
                systemPrompt: SHORTS_ORCHESTRATOR_SYSTEM_PROMPT,
                userMessage: buildShortsUserPrompt(userMessage),
                maxTokens: 2048,
                temperature: 0.3,
            });

            await traceService.record(flowId, null, 'TOOL_CALL', 'Shorts orchestrator call', {
                promptVersion: SHORTS_PROMPT_VERSION,
                model: response.model,
                inputTokens: response.inputTokens,
                outputTokens: response.outputTokens,
                latencyMs: response.latencyMs,
            });

            const parseResult = parseClaudeResponse(response.content);

            if (!parseResult.ok) {
                await traceService.record(flowId, null, 'ERROR', 'Shorts orchestrator validation failed', {
                    error: parseResult.error,
                });
                return buildFallback('AI 응답을 처리할 수 없습니다. 다시 시도해주세요.');
            }

            const { data } = parseResult;
            const nodes = data.blocks.map((block, i) => ({
                id: generateNumericId(),
                blockId: `blk-${block.type}`,
                name: block.label,
                blockType: block.type,
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
                amount: SHORTS_COST_PER_BLOCK[b.type] ?? 0.01,
            }));
            const total = data.estimatedCostUsd || breakdown.reduce((sum, b) => sum + b.amount, 0);

            await traceService.record(flowId, null, 'STATUS', 'Shorts proposal generated', {
                blockCount: nodes.length,
                edgeCount: edges.length,
                estimatedCost: total,
            });

            return {
                proposedNodes: nodes,
                proposedEdges: edges,
                estimatedCost: { currency: 'USD', total: Math.round(total * 100) / 100, breakdown },
                approvalRequired: true,
                assistantMessage:
                    data.summary ||
                    `${nodes.length}개 블록이 필요합니다. 예상 비용: $${total.toFixed(2)}. 승인하시겠습니까?`,
            };
        } catch (err) {
            log.error('Shorts orchestrator failed', err);
            await traceService.record(flowId, null, 'ERROR', 'Shorts orchestrator error', {
                error: err instanceof Error ? err.message : String(err),
                latencyMs: Date.now() - startMs,
            });
            return buildFallback('AI 서비스에 일시적인 문제가 발생했습니다.');
        }
    },
};

function buildFallback(msg: string): ProposalResult {
    return {
        proposedNodes: [],
        proposedEdges: [],
        estimatedCost: { currency: 'USD', total: 0 },
        approvalRequired: false,
        assistantMessage: msg,
    };
}
