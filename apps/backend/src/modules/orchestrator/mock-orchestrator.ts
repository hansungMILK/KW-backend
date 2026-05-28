import { buildLongformGateAWorkflow, enforceLongformGateAProfile, isLongformContentProfile } from './longform-gate-a';
import { generateNumericId } from '../../utils/id-generator';
import { buildContentProfilePreferences, enrichContentProfileNodeConfig } from '../content-profile/content-profile';
import { recommendImageStyleId } from '../image-generation/image-style';
import { isImageGenerationRequestText } from '../request-intent';

import type { Orchestrator, ProposalResult } from './types';

/**
 * Mock orchestrator — generates a fixed 8-block shorts pipeline proposal.
 * Will be replaced by real Claude-based orchestrator in Phase 2C.
 */

const SHORTS_BLOCKS = [
    { type: 'search', label: '자료 수집', config: { query: '쇼츠 제작' } },
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

const COUNTRYBALL_SHORTS_BLOCKS = [
    { type: 'search', label: '자료 수집', config: { query: '컨트리볼 쇼츠 제작' } },
    { type: 'countryball-brief', label: '컨트리볼 기획 브리프', config: {} },
    { type: 'countryball-angle-lab', label: '컨트리볼 앵글 선택', config: { reviewMode: 'script-first' } },
    { type: 'countryball-writer-brain', label: '컨트리볼 작가 설계', config: {} },
    { type: 'countryball-script', label: '컨트리볼 대본 생성', config: { durationSec: 60 } },
    { type: 'countryball-data', label: '컨트리볼 데이터 정규화', config: {} },
    { type: 'countryball-analysis', label: '컨트리볼 품질 검수', config: { mode: 'countryball' } },
    {
        type: 'countryball-image',
        label: '컨트리볼 이미지 생성',
        config: { imageQuality: 'medium' },
    },
    { type: 'countryball-tts', label: '컨트리볼 음성 생성', config: { lang: 'ko' } },
    { type: 'countryball-video', label: '컨트리볼 영상 합성', config: { format: '9:16', backgroundMusic: true } },
    { type: 'integration', label: '메타데이터 생성', config: {} },
] as const;

const COUNTRYBALL_SHORTS_EDGES = [
    { from: 0, to: 1 },
    { from: 1, to: 2 },
    { from: 2, to: 3 },
    { from: 3, to: 4 },
    { from: 4, to: 5 },
    { from: 5, to: 6 },
    { from: 6, to: 7 },
    { from: 6, to: 8 },
    { from: 7, to: 9 },
    { from: 8, to: 9 },
    { from: 9, to: 10 },
];

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
    'countryball-brief': 0.03,
    'countryball-angle-lab': 0.04,
    'countryball-writer-brain': 0.04,
    'countryball-script': 0.16,
    'countryball-data': 0.01,
    'countryball-analysis': 0.04,
    'countryball-image': 0.7,
    'countryball-tts': 0.1,
    'countryball-video': 0.2,
    content: 0.15,
    data: 0.01,
    analysis: 0.05,
    'media-image': 0.7,
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
        const inferredContentProfile = buildContentProfilePreferences({
            userMessage,
            outputType: 'video',
            hasMediaVideo: true,
            hasMediaImage: true,
        });
        const contentProfile = enforceLongformGateAProfile(inferredContentProfile);
        const longformGateA = isLongformContentProfile(contentProfile.contentProfileId)
            ? buildLongformGateAWorkflow(userMessage, contentProfile)
            : undefined;
        const countryballShorts = !longformGateA && contentProfile.contentProfileId === 'shorts.countryball.v1';
        const proposalBlocks = longformGateA?.blocks ?? (countryballShorts ? COUNTRYBALL_SHORTS_BLOCKS : SHORTS_BLOCKS);
        const proposalEdges = longformGateA?.edges ?? (countryballShorts ? COUNTRYBALL_SHORTS_EDGES : undefined);
        const summary = longformGateA?.summary;

        // Generate 8 nodes in a vertical layout
        const nodes = proposalBlocks.map((block, i) => ({
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
                    ...(block.type === 'countryball-brief' ? { topic: userMessage, userRequest: userMessage } : {}),
                    ...(block.type === 'countryball-angle-lab' ? { topic: userMessage, userRequest: userMessage } : {}),
                    ...(block.type === 'countryball-writer-brain'
                        ? { topic: userMessage, userRequest: userMessage }
                        : {}),
                    ...(block.type === 'countryball-script' ? { topic: userMessage, userRequest: userMessage } : {}),
                    ...(block.type === 'countryball-image' ? { imageStyleId: 'countryball-comic' } : {}),
                    ...(block.type === 'longform-source' ? { query: userMessage, userRequest: userMessage } : {}),
                    ...(block.type === 'content' ? { topic: userMessage } : {}),
                    ...(block.type === 'longform-brief' || block.type === 'longform-script'
                        ? { topic: userMessage }
                        : {}),
                    ...(block.type === 'media-image' ? { imageStyleId } : {}),
                },
                contentProfile,
                block.type
            ),
        }));

        const edges: Record<string, unknown>[] = [];
        if (proposalEdges) {
            for (const edge of proposalEdges) {
                edges.push({
                    id: generateNumericId(),
                    sourceNodeId: nodes[edge.from].id,
                    sourcePortId: 'out',
                    targetNodeId: nodes[edge.to].id,
                    targetPortId: 'in',
                });
            }
        } else {
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
        }

        const breakdown = proposalBlocks.map(b => ({
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
            assistantMessage:
                summary ??
                (countryballShorts
                    ? `컨트리볼 브리프가 장면 수를 판단하는 전용 쇼츠 파이프라인 ${nodes.length}개 블록이 필요합니다. 예상 비용: $${total.toFixed(2)}. 승인하시겠습니까?`
                    : `기본 12장 이미지 기반 1분 쇼츠 파이프라인 ${nodes.length}개 블록이 필요합니다. 예상 비용: $${total.toFixed(2)}. 승인하시겠습니까?`),
        };
    },
};

function isImageOnlyRequest(message: string): boolean {
    const normalized = message.toLowerCase().replace(/\s+/g, '');
    const hasVideoTarget = ['쇼츠', '영상', '비디오', 'shorts', 'video'].some(term => normalized.includes(term));
    return isImageGenerationRequestText(normalized) && !hasVideoTarget;
}
