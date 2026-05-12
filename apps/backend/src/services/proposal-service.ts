import {
    GPT_IMAGE_MODEL,
    estimateGptImage2CostUsd,
    getImageStylePreset,
    normalizeImageQuality,
    normalizeImageStyleId,
    normalizeSceneCount,
    roundUsd,
} from '../modules/image-generation/image-style';
import { type FlowRecord, flowRepo } from '../repositories/flow-repository';
import { messageRepo } from '../repositories/message-repository';
import { proposalRepo } from '../repositories/proposal-repository';
import { generateNumericId } from '../utils/id-generator';

import type { Message, Proposal } from '@flows/contracts';

/**
 * Proposal state transition rules:
 * - PENDING → APPROVED (only transition that modifies flow)
 * - PENDING → REJECTED (proposal status only, flow untouched)
 * - APPROVED/REJECTED → anything: REJECTED (409 Conflict)
 * - EXPIRED → anything: REJECTED (409 Conflict)
 */

export interface ApproveResult {
    proposal: Proposal;
    flow: FlowRecord;
}

export interface RejectResult {
    proposal: Proposal;
}

type ApprovalOverrides = {
    imageStyleId?: string;
    imageQuality?: 'low' | 'medium' | 'high';
    sceneCount?: number;
};

export const proposalService = {
    /**
     * Approve a proposal:
     * 1. Validate PENDING status (conditional)
     * 2. Replace flow nodes/edges with proposal snapshot
     * 3. Update proposal status → APPROVED
     * 4. Save SYSTEM message for audit trail
     */
    async approve(
        proposalId: string,
        decisionNote?: string,
        layoutType?: string,
        overrides?: ApprovalOverrides
    ): Promise<{ ok: true; data: ApproveResult } | { ok: false; error: string; status: number }> {
        const proposal = await proposalRepo.get(proposalId);
        if (!proposal) return { ok: false, error: `Proposal ${proposalId} not found`, status: 404 };

        // Conditional: only PENDING can be approved
        if (proposal.status !== 'PENDING') {
            return { ok: false, error: `Proposal is already ${proposal.status}`, status: 409 };
        }

        const flow = await flowRepo.get(proposal.flowId);
        if (!flow) return { ok: false, error: `Flow ${proposal.flowId} not found`, status: 404 };

        const now = new Date().toISOString();

        // Apply layout to proposed nodes based on layoutType
        let layoutNodes = proposal.proposedNodes as Array<Record<string, unknown>>;
        const layout = layoutType ?? 'vertical';
        if (layout === 'horizontal') {
            layoutNodes = layoutNodes.map((n, i) => ({
                ...n,
                position: { x: 100 + i * 300, y: 200 },
            }));
        } else if (layout === 'grid') {
            const cols = 3;
            layoutNodes = layoutNodes.map((n, i) => ({
                ...n,
                position: { x: 100 + (i % cols) * 300, y: 100 + Math.floor(i / cols) * 200 },
            }));
        }
        // 'vertical' or default: use existing positions (y-spaced by orchestrator)

        const overriddenNodes = applyApprovalOverrides(layoutNodes, overrides);
        const updatedMetadata = applyApprovalMetadataOverrides(proposal.metadata, overriddenNodes, overrides);
        const updatedEstimatedCost = applyApprovalEstimatedCostOverrides(
            proposal.estimatedCost,
            updatedMetadata,
            overriddenNodes,
            overrides
        );

        // Replace flow snapshot with proposal's nodes/edges
        const updatedFlow: FlowRecord = {
            ...flow,
            nodes: overriddenNodes,
            edges: proposal.proposedEdges,
            state: 'READY', // DRAFT → READY on approval
            updatedAt: now,
        };
        await flowRepo.put(updatedFlow);

        // Update proposal status
        const updatedProposal: Proposal = {
            ...proposal,
            status: 'APPROVED',
            decisionReason: decisionNote ?? null,
            ...(updatedEstimatedCost ? { estimatedCost: updatedEstimatedCost } : {}),
            ...(updatedMetadata ? { metadata: updatedMetadata } : {}),
            updatedAt: now,
        };
        await proposalRepo.put(updatedProposal);

        // Save SYSTEM message for audit
        const sysMsg: Message = {
            messageId: generateNumericId(),
            flowId: proposal.flowId,
            role: 'SYSTEM',
            messageType: 'STATUS',
            content: `제안이 승인되었습니다. ${proposal.proposedNodes.length}개 블록이 캔버스에 배치됩니다.`,
            proposalId,
            createdAt: now,
        };
        await messageRepo.put(sysMsg);

        return { ok: true, data: { proposal: updatedProposal, flow: updatedFlow } };
    },

    /**
     * Reject a proposal:
     * 1. Validate PENDING status (conditional)
     * 2. Update proposal status → REJECTED (flow unchanged)
     * 3. Save SYSTEM message for audit trail
     */
    async reject(
        proposalId: string,
        reason?: string
    ): Promise<{ ok: true; data: RejectResult } | { ok: false; error: string; status: number }> {
        const proposal = await proposalRepo.get(proposalId);
        if (!proposal) return { ok: false, error: `Proposal ${proposalId} not found`, status: 404 };

        if (proposal.status !== 'PENDING') {
            return { ok: false, error: `Proposal is already ${proposal.status}`, status: 409 };
        }

        const now = new Date().toISOString();

        const updatedProposal: Proposal = {
            ...proposal,
            status: 'REJECTED',
            decisionReason: reason ?? null,
            updatedAt: now,
        };
        await proposalRepo.put(updatedProposal);

        // Save SYSTEM message for audit
        const sysMsg: Message = {
            messageId: generateNumericId(),
            flowId: proposal.flowId,
            role: 'SYSTEM',
            messageType: 'STATUS',
            content: reason ? `제안이 거절되었습니다. 사유: ${reason}` : '제안이 거절되었습니다.',
            proposalId,
            createdAt: now,
        };
        await messageRepo.put(sysMsg);

        return { ok: true, data: { proposal: updatedProposal } };
    },
};

function applyApprovalOverrides(
    nodes: Array<Record<string, unknown>>,
    overrides: ApprovalOverrides | undefined
): Array<Record<string, unknown>> {
    const imageStyleId = normalizeImageStyleId(overrides?.imageStyleId);
    const imageQuality = overrides?.imageQuality ? normalizeImageQuality(overrides.imageQuality) : undefined;
    const sceneCount = overrides?.sceneCount ? normalizeSceneCount(overrides.sceneCount, 12) : undefined;
    if (!imageStyleId && !imageQuality && !sceneCount) return nodes;

    return nodes.map(node => {
        const blockType = node['blockType'] ?? node['type'];
        if (blockType !== 'media-image' && blockType !== 'content') return node;

        const config =
            node['config'] && typeof node['config'] === 'object' && !Array.isArray(node['config'])
                ? (node['config'] as Record<string, unknown>)
                : {};
        const preset = blockType === 'media-image' && imageStyleId ? getImageStylePreset(imageStyleId) : undefined;

        return {
            ...node,
            config: {
                ...config,
                ...(blockType === 'media-image' && imageStyleId
                    ? { imageStyleId, imageStyleLabel: preset?.label }
                    : {}),
                ...(blockType === 'media-image' && imageQuality ? { imageQuality } : {}),
                ...(sceneCount ? (blockType === 'media-image' ? { count: sceneCount } : { scenes: sceneCount }) : {}),
            },
        };
    });
}

type ProposalCost = Proposal['estimatedCost'];

type ImageGenerationMetadata = {
    model?: string;
    imageStyleId?: string;
    imageStyleLabel?: string;
    recommendedStyleId?: string;
    imageQuality?: 'low' | 'medium' | 'high';
    sceneCount?: number;
    imageEstimatedCostUsd?: number;
    textAndOtherEstimatedCostUsd?: number;
    estimatedTotalCostUsd?: number;
    styleOptions?: unknown;
    qualityOptions?: Array<{
        id: 'low' | 'medium' | 'high';
        label?: string;
        estimatedImageCostUsd?: number;
    }>;
};

function applyApprovalMetadataOverrides(
    metadata: Record<string, unknown> | undefined,
    nodes: Array<Record<string, unknown>>,
    overrides: ApprovalOverrides | undefined
): Record<string, unknown> | undefined {
    const existingImageGeneration = getImageGenerationMetadata(metadata);
    const imageNode = findMediaImageNode(nodes);
    if (!existingImageGeneration && !imageNode) return metadata;

    const sceneCount = normalizeSceneCount(
        overrides?.sceneCount ?? existingImageGeneration?.sceneCount,
        getMediaImageSceneCount(imageNode)
    );
    const imageQuality = normalizeImageQuality(overrides?.imageQuality ?? existingImageGeneration?.imageQuality);
    const imageStyleId =
        normalizeImageStyleId(overrides?.imageStyleId ?? existingImageGeneration?.imageStyleId) ??
        normalizeImageStyleId(existingImageGeneration?.recommendedStyleId) ??
        'explainer-comic';
    const preset = getImageStylePreset(imageStyleId);
    const imageEstimatedCostUsd = estimateGptImage2CostUsd(sceneCount, imageQuality);
    const textAndOtherEstimatedCostUsd = roundUsd(readNumber(existingImageGeneration?.textAndOtherEstimatedCostUsd, 0));
    const estimatedTotalCostUsd = roundUsd(imageEstimatedCostUsd + textAndOtherEstimatedCostUsd);

    const imageGeneration: ImageGenerationMetadata = {
        ...(existingImageGeneration ?? {}),
        model: GPT_IMAGE_MODEL,
        imageStyleId,
        imageStyleLabel: preset.label,
        imageQuality,
        sceneCount,
        imageEstimatedCostUsd,
        textAndOtherEstimatedCostUsd,
        estimatedTotalCostUsd,
        qualityOptions: (['low', 'medium', 'high'] as const).map(quality => ({
            id: quality,
            label: quality,
            estimatedImageCostUsd: estimateGptImage2CostUsd(sceneCount, quality),
        })),
    };

    return {
        ...(metadata ?? {}),
        imageGeneration,
    };
}

function applyApprovalEstimatedCostOverrides(
    estimatedCost: ProposalCost,
    metadata: Record<string, unknown> | undefined,
    nodes: Array<Record<string, unknown>>,
    overrides: ApprovalOverrides | undefined
): ProposalCost {
    if (!estimatedCost && !findMediaImageNode(nodes)) return estimatedCost;

    const imageGeneration = getImageGenerationMetadata(metadata);
    const imageNode = findMediaImageNode(nodes);
    const sceneCount = normalizeSceneCount(
        overrides?.sceneCount ?? imageGeneration?.sceneCount,
        getMediaImageSceneCount(imageNode)
    );
    const imageQuality = normalizeImageQuality(overrides?.imageQuality ?? imageGeneration?.imageQuality);
    const imageEstimatedCostUsd = estimateGptImage2CostUsd(sceneCount, imageQuality);

    if (estimatedCost?.breakdown?.length) {
        const breakdown = estimatedCost.breakdown.map(item =>
            item.blockType === 'media-image' ? { ...item, amount: imageEstimatedCostUsd } : item
        );
        return {
            ...estimatedCost,
            total: roundUsd(breakdown.reduce((sum, item) => sum + item.amount, 0)),
            breakdown,
        };
    }

    if (imageGeneration) {
        return {
            currency: estimatedCost?.currency ?? 'USD',
            total: roundUsd(imageGeneration.estimatedTotalCostUsd ?? imageEstimatedCostUsd),
        };
    }

    return estimatedCost;
}

function getImageGenerationMetadata(
    metadata: Record<string, unknown> | undefined
): ImageGenerationMetadata | undefined {
    const imageGeneration = metadata?.['imageGeneration'];
    if (!imageGeneration || typeof imageGeneration !== 'object' || Array.isArray(imageGeneration)) return undefined;
    return imageGeneration as ImageGenerationMetadata;
}

function findMediaImageNode(nodes: Array<Record<string, unknown>>): Record<string, unknown> | undefined {
    return nodes.find(node => (node['blockType'] ?? node['type']) === 'media-image');
}

function getMediaImageSceneCount(node: Record<string, unknown> | undefined): number {
    const config =
        node?.['config'] && typeof node['config'] === 'object' && !Array.isArray(node['config'])
            ? (node['config'] as Record<string, unknown>)
            : undefined;
    return readPositiveInt(
        config?.['count'] ?? config?.['scenes'] ?? config?.['sceneCount'] ?? config?.['frameCount'],
        12
    );
}

function readPositiveInt(value: unknown, fallback: number): number {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
    return Math.max(1, Math.floor(fallback));
}

function readNumber(value: unknown, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}
