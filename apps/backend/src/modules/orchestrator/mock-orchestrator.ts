import { generateNumericId } from '../../utils/id-generator';
import { SHORTS_8STEP_BLOCKS, SHORTS_8STEP_EDGE_PAIRS, SHORTS_COST_PER_BLOCK } from '../domain-packs/shorts-pack';

import type { Orchestrator, ProposalResult } from './types';

/**
 * Mock orchestrator — generates a fixed 8-block shorts pipeline proposal.
 * Will be replaced by real Claude-based orchestrator in Phase 2C.
 * Block definitions come from the shorts-pack template.
 */

export const mockOrchestrator: Orchestrator = {
    async generateProposal(_flowId: string, _userMessage: string): Promise<ProposalResult> {
        // Generate 8 nodes in a vertical layout
        const nodes = SHORTS_8STEP_BLOCKS.map((block, i) => ({
            id: generateNumericId(),
            blockId: `blk-${block.type}`,
            name: block.label,
            blockType: block.type,
            position: { x: 300, y: 100 + i * 120 },
            state: 'IDLE',
        }));

        // Build edges from the canonical edge pairs
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
            estimatedCost: {
                currency: 'USD',
                total: Math.round(total * 100) / 100,
                breakdown,
            },
            approvalRequired: true,
            assistantMessage: `8개 블록이 필요합니다. 예상 비용: $${total.toFixed(2)}. 승인하시겠습니까?`,
        };
    },
};
