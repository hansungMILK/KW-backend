import { generateNumericId } from '../../utils/id-generator';
import { buildContentProfilePreferences, enrichContentProfileNodeConfig } from '../content-profile/content-profile';
import { recommendImageStyleId } from '../image-generation/image-style';

import type { Orchestrator, ProposalResult } from './types';

/**
 * Mock orchestrator — generates a fixed 8-block shorts pipeline proposal.
 * Will be replaced by real Claude-based orchestrator in Phase 2C.
 */

const SHORTS_BLOCKS = [
    { type: 'search', label: '자료 수집', config: { query: '정보전달 쇼츠' } },
    { type: 'content', label: '스크립트 생성', config: { scenes: 12, durationSec: 60 } },
    { type: 'data', label: '데이터 정규화', config: {} },
    { type: 'analysis', label: '품질 검수', config: { mode: 'safety' } },
    {
        type: 'media-image',
        label: '이미지 생성',
        config: { count: 12, imageQuality: 'medium' },
    },
    { type: 'media-tts', label: '음성 생성', config: { lang: 'ko' } },
    { type: 'media-video', label: '영상 합성', config: { format: '9:16', backgroundMusic: true } },
    { type: 'integration', label: '메타데이터 생성', config: {} },
] as const;

const IMAGE_BLOCKS = [
    {
        type: 'content',
        label: '이미지 프롬프트 구성',
        config: { mode: 'single-image', scenes: 1, topic: '이미지 생성 요청' },
    },
    { type: 'media-image', label: '이미지 생성', config: { count: 1, style: 'single-image' } },
] as const;

const COST_PER_BLOCK: Record<string, number> = {
    search: 0.02,
    content: 0.15,
    data: 0.01,
    analysis: 0.05,
    'media-image': 0.7,
    'media-tts': 0.1,
    'media-video': 0.2,
    integration: 0.02,
};

export const mockOrchestrator: Orchestrator = {
    async generateProposal(
        _flowId: string,
        userMessage: string,
        _currentContext?: Record<string, unknown>
    ): Promise<ProposalResult> {
        if (isImageOnlyRequest(userMessage)) {
            const contentProfile = buildContentProfilePreferences({
                userMessage,
                outputType: 'image',
                hasMediaImage: true,
            });
            const nodes = IMAGE_BLOCKS.map((block, i) => ({
                id: generateNumericId(),
                blockId: `blk-${block.type}`,
                name: block.label,
                blockType: block.type,
                position: { x: 300, y: 100 + i * 120 },
                state: 'IDLE',
                config: enrichContentProfileNodeConfig(
                    {
                        ...block.config,
                        ...(block.type === 'content' ? { topic: userMessage } : {}),
                    },
                    contentProfile,
                    block.type
                ),
            }));
            const edges = [
                {
                    id: generateNumericId(),
                    sourceNodeId: nodes[0].id,
                    sourcePortId: 'out',
                    targetNodeId: nodes[1].id,
                    targetPortId: 'in',
                },
            ];
            const breakdown = IMAGE_BLOCKS.map(b => ({
                blockType: b.type,
                amount: COST_PER_BLOCK[b.type] ?? 0,
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
                metadata: { contentProfile },
                approvalRequired: true,
                assistantMessage: `이미지 생성용 2개 블록이 필요합니다. 예상 비용: $${total.toFixed(2)}. 승인하시겠습니까?`,
            };
        }

        const imageStyleId = recommendImageStyleId(userMessage);
        const contentProfile = buildContentProfilePreferences({
            userMessage,
            outputType: 'video',
            hasMediaVideo: true,
            hasMediaImage: true,
        });

        // Generate 8 nodes in a vertical layout
        const nodes = SHORTS_BLOCKS.map((block, i) => ({
            id: generateNumericId(),
            blockId: `blk-${block.type}`,
            name: block.label,
            blockType: block.type,
            position: { x: 300, y: 100 + i * 120 },
            state: 'IDLE',
            config: enrichContentProfileNodeConfig(
                {
                    ...block.config,
                    ...(block.type === 'search' ? { query: userMessage } : {}),
                    ...(block.type === 'content' ? { topic: userMessage } : {}),
                    ...(block.type === 'media-image' ? { imageStyleId } : {}),
                },
                contentProfile,
                block.type
            ),
        }));

        // Linear edges: each node connects to the next
        // Exception: media-image (index 4) and media-tts (index 5) are parallel from analysis (index 3)
        const edges: Record<string, unknown>[] = [];
        // search → content → data → analysis
        for (let i = 0; i < 3; i++) {
            edges.push({
                id: generateNumericId(),
                sourceNodeId: nodes[i].id,
                sourcePortId: 'out',
                targetNodeId: nodes[i + 1].id,
                targetPortId: 'in',
            });
        }
        // analysis → media-image (parallel 1)
        edges.push({
            id: generateNumericId(),
            sourceNodeId: nodes[3].id,
            sourcePortId: 'out',
            targetNodeId: nodes[4].id,
            targetPortId: 'in',
        });
        // analysis → media-tts (parallel 2)
        edges.push({
            id: generateNumericId(),
            sourceNodeId: nodes[3].id,
            sourcePortId: 'out',
            targetNodeId: nodes[5].id,
            targetPortId: 'in',
        });
        // media-image → media-video
        edges.push({
            id: generateNumericId(),
            sourceNodeId: nodes[4].id,
            sourcePortId: 'out',
            targetNodeId: nodes[6].id,
            targetPortId: 'in',
        });
        // media-tts → media-video
        edges.push({
            id: generateNumericId(),
            sourceNodeId: nodes[5].id,
            sourcePortId: 'out',
            targetNodeId: nodes[6].id,
            targetPortId: 'in',
        });
        // media-video → integration
        edges.push({
            id: generateNumericId(),
            sourceNodeId: nodes[6].id,
            sourcePortId: 'out',
            targetNodeId: nodes[7].id,
            targetPortId: 'in',
        });

        const breakdown = SHORTS_BLOCKS.map(b => ({
            blockType: b.type,
            amount: COST_PER_BLOCK[b.type] ?? 0,
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
            metadata: { contentProfile },
            approvalRequired: true,
            assistantMessage: `10~15장 이미지 기반 1분 쇼츠 파이프라인 8개 블록이 필요합니다. 예상 비용: $${total.toFixed(2)}. 승인하시겠습니까?`,
        };
    },
};

function isImageOnlyRequest(message: string): boolean {
    const normalized = message.toLowerCase().replace(/\s+/g, '');
    const hasImageTarget = ['이미지', '그림', '사진', '일러스트', 'image', 'picture', 'photo'].some(term =>
        normalized.includes(term)
    );
    const hasVideoTarget = ['쇼츠', '영상', '비디오', 'shorts', 'video'].some(term => normalized.includes(term));
    return hasImageTarget && !hasVideoTarget;
}
