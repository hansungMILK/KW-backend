/**
 * Shorts-pack mock orchestrator — generates fixed 8-block proposal.
 * Used when ORCHESTRATOR_MODE=mock (no API calls).
 */

import { SHORTS_8STEP_BLOCKS, SHORTS_8STEP_EDGE_PAIRS, SHORTS_COST_PER_BLOCK } from './templates/shorts-8step';
import { generateNumericId } from '../../../utils/id-generator';

import type { Orchestrator, ProposalResult } from '../../orchestrator/types';

export const shortsMockOrchestrator: Orchestrator = {
    async generateProposal(_flowId: string, _userMessage: string): Promise<ProposalResult> {
        const nodes = SHORTS_8STEP_BLOCKS.map((block, i) => ({
            id: generateNumericId(),
            blockId: `blk-${block.type}`,
            name: block.label,
            blockType: block.type,
            position: { x: 300, y: 100 + i * 120 },
            state: 'IDLE',
        }));

        const edges = SHORTS_8STEP_EDGE_PAIRS.map(([srcIdx, tgtIdx]) => ({
            id: generateNumericId(),
            sourceNodeId: nodes[srcIdx].id,
            sourcePortId: 'out',
            targetNodeId: nodes[tgtIdx].id,
            targetPortId: 'in',
        }));

        const breakdown = SHORTS_8STEP_BLOCKS.map(b => ({
            blockType: b.type,
            amount: SHORTS_COST_PER_BLOCK[b.type] ?? 0,
        }));
        const total = breakdown.reduce((sum, b) => sum + b.amount, 0);

        return {
            proposedNodes: nodes,
            proposedEdges: edges,
            estimatedCost: { currency: 'USD', total: Math.round(total * 100) / 100, breakdown },
            approvalRequired: true,
            assistantMessage: `8개 블록이 필요합니다. 예상 비용: $${total.toFixed(2)}. 승인하시겠습니까?`,
        };
    },
};
