import {
    buildContentProfilePreferences,
    enrichContentProfileNodeConfig,
} from '../modules/content-profile/content-profile';
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

import type {
    ContentProfileId,
    ContentProfilePreferences,
    ReviewMode,
    ScriptToneId,
    ScriptToneIntensity,
} from '../modules/content-profile/content-profile';
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
    scriptToneId?: ScriptToneId;
    scriptToneIntensity?: ScriptToneIntensity;
    contentProfileId?: ContentProfileId;
    reviewMode?: ReviewMode;
};

type ApprovalEdge = Record<string, unknown>;

const APPROVAL_LAYOUT = {
    START_X: 100,
    BASELINE_Y: 220,
    LEVEL_WIDTH: 340,
    NODE_HEIGHT: 190,
    LEVEL_GAP: 70,
    GRID_COLS: 3,
    GRID_ROW_HEIGHT: 220,
} as const;

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

        // Persist a readable DAG layout as the saved canvas state. Frontend auto-layout
        // is only a view helper; refresh must load the same understandable layout.
        const layoutNodes = applyApprovalLayout(
            proposal.proposedNodes as Array<Record<string, unknown>>,
            proposal.proposedEdges as ApprovalEdge[],
            layoutType ?? 'horizontal'
        );

        const overriddenNodes = applyApprovalRenderCostBreakdown(
            applyApprovalOverrides(layoutNodes, overrides, proposal.metadata, proposal.proposalId),
            proposal.estimatedCost
        );
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

function applyApprovalLayout(
    nodes: Array<Record<string, unknown>>,
    edges: ApprovalEdge[],
    layout: string
): Array<Record<string, unknown>> {
    if (layout === 'vertical') return nodes;
    if (layout === 'grid') return applyGridLayout(nodes);
    return applyHorizontalDagLayout(nodes, edges);
}

function applyGridLayout(nodes: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
    return nodes.map((node, index) => ({
        ...node,
        position: {
            x: APPROVAL_LAYOUT.START_X + (index % APPROVAL_LAYOUT.GRID_COLS) * APPROVAL_LAYOUT.LEVEL_WIDTH,
            y: 100 + Math.floor(index / APPROVAL_LAYOUT.GRID_COLS) * APPROVAL_LAYOUT.GRID_ROW_HEIGHT,
        },
    }));
}

function applyHorizontalDagLayout(
    nodes: Array<Record<string, unknown>>,
    edges: ApprovalEdge[]
): Array<Record<string, unknown>> {
    if (nodes.length < 2) return nodes;

    const originalOrder = new Map<string, number>();
    const nodeIds = new Set<string>();
    nodes.forEach((node, index) => {
        const id = getNodeId(node);
        if (!id) return;
        originalOrder.set(id, index);
        nodeIds.add(id);
    });

    if (nodeIds.size < 2) return nodes;

    const adjacency = new Map<string, string[]>();
    const inDegree = new Map<string, number>();
    const parents = new Map<string, string[]>();
    nodeIds.forEach(id => {
        adjacency.set(id, []);
        inDegree.set(id, 0);
        parents.set(id, []);
    });

    for (const edge of edges) {
        const sourceId = getEdgeNodeId(edge, 'source');
        const targetId = getEdgeNodeId(edge, 'target');
        if (!sourceId || !targetId || !nodeIds.has(sourceId) || !nodeIds.has(targetId)) continue;
        adjacency.get(sourceId)?.push(targetId);
        parents.get(targetId)?.push(sourceId);
        inDegree.set(targetId, (inDegree.get(targetId) ?? 0) + 1);
    }

    if (edges.length === 0 || Array.from(inDegree.values()).every(value => value === 0)) {
        return nodes.map((node, index) => ({
            ...node,
            position: {
                x: APPROVAL_LAYOUT.START_X + index * APPROVAL_LAYOUT.LEVEL_WIDTH,
                y: APPROVAL_LAYOUT.BASELINE_Y,
            },
            ...getOutputPreviewSize(node),
        }));
    }

    const levels = new Map<string, number>();
    const queue = Array.from(nodeIds)
        .filter(id => (inDegree.get(id) ?? 0) === 0)
        .sort((a, b) => (originalOrder.get(a) ?? 0) - (originalOrder.get(b) ?? 0));
    queue.forEach(id => levels.set(id, 0));

    const processed = new Set<string>();
    const mutableInDegree = new Map(inDegree);

    while (queue.length > 0) {
        const current = queue.shift();
        if (!current) break;
        processed.add(current);

        for (const child of adjacency.get(current) ?? []) {
            levels.set(child, Math.max(levels.get(child) ?? 0, (levels.get(current) ?? 0) + 1));
            mutableInDegree.set(child, (mutableInDegree.get(child) ?? 0) - 1);
            if (mutableInDegree.get(child) === 0) {
                queue.push(child);
                queue.sort((a, b) => (originalOrder.get(a) ?? 0) - (originalOrder.get(b) ?? 0));
            }
        }
    }

    const fallbackLevel = Math.max(0, ...Array.from(levels.values())) + 1;
    nodeIds.forEach(id => {
        if (!processed.has(id)) levels.set(id, fallbackLevel);
    });

    const groups = new Map<number, Array<Record<string, unknown>>>();
    for (const node of nodes) {
        const id = getNodeId(node);
        const level = id ? (levels.get(id) ?? 0) : 0;
        const group = groups.get(level) ?? [];
        group.push(node);
        groups.set(level, group);
    }

    const yByNodeId = new Map<string, number>();
    const positioned = new Map<string, Record<string, unknown>>();
    const sortedLevels = Array.from(groups.keys()).sort((a, b) => a - b);

    for (const level of sortedLevels) {
        const group = [...(groups.get(level) ?? [])].sort((a, b) => {
            const aId = getNodeId(a);
            const bId = getNodeId(b);
            const aParentY = averageParentY(aId, parents, yByNodeId);
            const bParentY = averageParentY(bId, parents, yByNodeId);
            if (Math.abs(aParentY - bParentY) > 1) return aParentY - bParentY;
            return (originalOrder.get(aId ?? '') ?? 0) - (originalOrder.get(bId ?? '') ?? 0);
        });

        const totalHeight =
            group.length * APPROVAL_LAYOUT.NODE_HEIGHT + Math.max(0, group.length - 1) * APPROVAL_LAYOUT.LEVEL_GAP;
        const startY = Math.max(100, APPROVAL_LAYOUT.BASELINE_Y - totalHeight / 2 + APPROVAL_LAYOUT.NODE_HEIGHT / 2);

        group.forEach((node, index) => {
            const id = getNodeId(node);
            const x = APPROVAL_LAYOUT.START_X + level * APPROVAL_LAYOUT.LEVEL_WIDTH;
            const y = Math.round(startY + index * (APPROVAL_LAYOUT.NODE_HEIGHT + APPROVAL_LAYOUT.LEVEL_GAP));
            const key = id ?? `index-${index}`;
            if (id) yByNodeId.set(id, y);
            positioned.set(key, {
                ...node,
                position: { x, y },
                ...getOutputPreviewSize(node),
            });
        });
    }

    return nodes.map((node, index) => {
        const id = getNodeId(node);
        return positioned.get(id ?? `index-${index}`) ?? node;
    });
}

function getOutputPreviewSize(node: Record<string, unknown>): Record<string, number> {
    const blockType = String(node['blockType'] ?? node['type'] ?? '');
    if (blockType === 'media-video' || blockType === 'metadata') return { width: 360, height: 440 };
    if (blockType === 'media-image') return { width: 340, height: 320 };
    if (blockType === 'media-tts' || blockType === 'tts') return { width: 320, height: 220 };
    if (blockType === 'content' || blockType === 'longform-script' || blockType === 'longform-review') {
        return { width: 340, height: 320 };
    }
    return {};
}

function getNodeId(node: Record<string, unknown>): string | undefined {
    const id = node['id'];
    return typeof id === 'string' && id.length > 0 ? id : undefined;
}

function getEdgeNodeId(edge: ApprovalEdge, direction: 'source' | 'target'): string | undefined {
    const keys =
        direction === 'source'
            ? ['sourceNodeId', 'source', 'fromNodeId', 'from']
            : ['targetNodeId', 'target', 'toNodeId', 'to'];
    for (const key of keys) {
        const value = edge[key];
        if (typeof value === 'string' && value.length > 0) return value;
    }
    return undefined;
}

function averageParentY(
    nodeId: string | undefined,
    parents: Map<string, string[]>,
    yByNodeId: Map<string, number>
): number {
    if (!nodeId) return APPROVAL_LAYOUT.BASELINE_Y;
    const parentIds = parents.get(nodeId) ?? [];
    const knownParents = parentIds
        .map(parentId => yByNodeId.get(parentId))
        .filter((value): value is number => typeof value === 'number');
    if (knownParents.length === 0) return APPROVAL_LAYOUT.BASELINE_Y;
    return knownParents.reduce((sum, value) => sum + value, 0) / knownParents.length;
}

function applyApprovalOverrides(
    nodes: Array<Record<string, unknown>>,
    overrides: ApprovalOverrides | undefined,
    metadata: Record<string, unknown> | undefined,
    proposalId?: string
): Array<Record<string, unknown>> {
    const imageStyleId = normalizeImageStyleId(overrides?.imageStyleId);
    const imageQuality = overrides?.imageQuality ? normalizeImageQuality(overrides.imageQuality) : undefined;
    const sceneCount = overrides?.sceneCount ? normalizeSceneCount(overrides.sceneCount, 12) : undefined;
    const contentProfile = buildApprovalContentProfilePreferences(overrides, nodes, metadata);
    if (!imageStyleId && !imageQuality && !sceneCount && !contentProfile) return nodes;

    return nodes.map(node => {
        const blockType = node['blockType'] ?? node['type'];
        if (typeof blockType !== 'string') return node;
        const shouldApplyImageOverrides = blockType === 'media-image' || blockType === 'content';
        if (!shouldApplyImageOverrides && !contentProfile) return node;

        const config =
            node['config'] && typeof node['config'] === 'object' && !Array.isArray(node['config'])
                ? (node['config'] as Record<string, unknown>)
                : {};
        const preset = blockType === 'media-image' && imageStyleId ? getImageStylePreset(imageStyleId) : undefined;
        const overriddenConfig = {
            ...config,
            ...(blockType === 'media-image' && imageStyleId ? { imageStyleId, imageStyleLabel: preset?.label } : {}),
            ...(blockType === 'media-image' && imageQuality ? { imageQuality } : {}),
            ...(sceneCount ? (blockType === 'media-image' ? { count: sceneCount } : { scenes: sceneCount }) : {}),
            ...longformDirectRunApprovalConfig(contentProfile, blockType, proposalId),
        };

        return {
            ...node,
            config: contentProfile
                ? enrichContentProfileNodeConfig(overriddenConfig, contentProfile, blockType)
                : overriddenConfig,
        };
    });
}

const LONGFORM_GATE_A_APPROVAL_BLOCKS = new Set([
    'longform-script',
    'longform-storyboard',
    'longform-scene-json',
    'longform-review',
]);

function longformDirectRunApprovalConfig(
    contentProfile: ContentProfilePreferences | undefined,
    blockType: string,
    proposalId: string | undefined
): Record<string, unknown> {
    if (!contentProfile?.contentProfileId.startsWith('longform.')) return {};
    if (contentProfile.reviewMode !== 'direct-run') return {};
    if (!LONGFORM_GATE_A_APPROVAL_BLOCKS.has(blockType)) return {};

    return {
        reviewStatus: 'approved',
        mediaExecutionAllowed: true,
        gateBApproved: true,
        approvedArtifactId: `proposal-${proposalId ?? 'approved'}-direct-run`,
    };
}

type ProposalCost = Proposal['estimatedCost'];
type ProposalCostBreakdownItem = { blockType: string; amount: number };

const LONGFORM_RENDER_COST_KEYS = {
    compose: new Set(['html-compose', 'hyperframes-compose', 'longform-html-compose']),
    render: new Set(['html-render', 'hyperframes-render', 'mp4-render', 'longform-html-render']),
    combined: new Set(['longform-html-render-generation', 'longform-render', 'hyperframes-generation']),
};

function applyApprovalRenderCostBreakdown(
    nodes: Array<Record<string, unknown>>,
    estimatedCost: ProposalCost
): Array<Record<string, unknown>> {
    const breakdown = estimatedCost?.breakdown;
    if (!breakdown?.length) return nodes;

    const composeCost = sumBreakdownAmount(breakdown, LONGFORM_RENDER_COST_KEYS.compose);
    const renderCost = sumBreakdownAmount(breakdown, LONGFORM_RENDER_COST_KEYS.render);
    const combinedCost = sumBreakdownAmount(breakdown, LONGFORM_RENDER_COST_KEYS.combined);
    const totalRenderCost = combinedCost || roundUsd(composeCost + renderCost);
    if (totalRenderCost <= 0) return nodes;

    let appliedMediaVideoCost = false;

    return nodes.map(node => {
        const blockType = node['blockType'] ?? node['type'];
        if (typeof blockType !== 'string') return node;

        const config = getNodeConfig(node);
        const costConfig = getApprovalRenderCostConfig(blockType, config, {
            composeCost,
            renderCost,
            totalRenderCost,
            appliedMediaVideoCost,
        });
        if (!costConfig) return node;
        if (blockType === 'media-video') appliedMediaVideoCost = true;

        return {
            ...node,
            config: {
                ...config,
                ...costConfig,
            },
        };
    });
}

function sumBreakdownAmount(breakdown: ProposalCostBreakdownItem[], keys: Set<string>): number {
    return roundUsd(
        breakdown.reduce((sum, item) => {
            const blockType = String(item.blockType ?? '')
                .trim()
                .toLowerCase();
            return keys.has(blockType) ? sum + readNumber(item.amount, 0) : sum;
        }, 0)
    );
}

function isApprovalRenderNode(blockType: string, config: Record<string, unknown>): boolean {
    if (blockType === 'longform-render') return true;
    if (LONGFORM_RENDER_COST_KEYS.compose.has(blockType) || LONGFORM_RENDER_COST_KEYS.render.has(blockType)) {
        return true;
    }
    if (blockType !== 'media-video') return false;

    const renderer = String(config['renderer'] ?? config['rendererRoute'] ?? config['renderRoute'] ?? '');
    const contentProfileId = String(config['contentProfileId'] ?? '');
    return /hyperframes|html/i.test(renderer) || contentProfileId.startsWith('longform.');
}

function getApprovalRenderCostConfig(
    blockType: string,
    config: Record<string, unknown>,
    costs: {
        composeCost: number;
        renderCost: number;
        totalRenderCost: number;
        appliedMediaVideoCost: boolean;
    }
): Record<string, unknown> | null {
    if (LONGFORM_RENDER_COST_KEYS.compose.has(blockType)) {
        return costs.composeCost > 0
            ? {
                  htmlComposeEstimatedCostUsd: costs.composeCost,
                  longformHtmlRenderEstimatedCostUsd: costs.composeCost,
              }
            : null;
    }

    if (LONGFORM_RENDER_COST_KEYS.render.has(blockType)) {
        return costs.renderCost > 0
            ? {
                  hyperframesRenderEstimatedCostUsd: costs.renderCost,
                  longformHtmlRenderEstimatedCostUsd: costs.renderCost,
              }
            : null;
    }

    if (!isApprovalRenderNode(blockType, config) || costs.appliedMediaVideoCost) return null;

    return {
        ...(blockType === 'media-video' && !config['renderer'] ? { renderer: 'hyperframes' } : {}),
        ...(costs.composeCost > 0 ? { htmlComposeEstimatedCostUsd: costs.composeCost } : {}),
        ...(costs.renderCost > 0 ? { hyperframesRenderEstimatedCostUsd: costs.renderCost } : {}),
        longformHtmlRenderEstimatedCostUsd: costs.totalRenderCost,
    };
}

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

type ContentProfileMetadata = Partial<ContentProfilePreferences>;

function applyApprovalMetadataOverrides(
    metadata: Record<string, unknown> | undefined,
    nodes: Array<Record<string, unknown>>,
    overrides: ApprovalOverrides | undefined
): Record<string, unknown> | undefined {
    const existingImageGeneration = getImageGenerationMetadata(metadata);
    const imageNode = findMediaImageNode(nodes);
    const contentProfile = buildApprovalContentProfilePreferences(overrides, nodes, metadata);
    if (!existingImageGeneration && !imageNode && !contentProfile) return metadata;

    const imageGeneration =
        existingImageGeneration || imageNode
            ? buildApprovalImageGenerationMetadata(existingImageGeneration, imageNode, overrides)
            : undefined;

    return {
        ...(metadata ?? {}),
        ...(imageGeneration ? { imageGeneration } : {}),
        ...(contentProfile ? { contentProfile } : {}),
    };
}

function buildApprovalImageGenerationMetadata(
    existingImageGeneration: ImageGenerationMetadata | undefined,
    imageNode: Record<string, unknown> | undefined,
    overrides: ApprovalOverrides | undefined
): ImageGenerationMetadata {
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

    return {
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
}

function buildApprovalContentProfilePreferences(
    overrides: ApprovalOverrides | undefined,
    nodes: Array<Record<string, unknown>>,
    metadata?: Record<string, unknown> | undefined
): ContentProfilePreferences | undefined {
    const existing = getContentProfileMetadata(metadata);
    const hasOverrides = Boolean(
        overrides?.scriptToneId ||
            overrides?.scriptToneIntensity ||
            overrides?.contentProfileId ||
            overrides?.reviewMode
    );
    if (!existing && !hasOverrides) return undefined;

    return buildContentProfilePreferences({
        userMessage: '',
        outputType: nodes.some(node => (node['blockType'] ?? node['type']) === 'media-video') ? 'video' : undefined,
        hasMediaVideo: nodes.some(node => (node['blockType'] ?? node['type']) === 'media-video'),
        hasMediaImage: nodes.some(node => (node['blockType'] ?? node['type']) === 'media-image'),
        contentProfileId: overrides?.contentProfileId ?? existing?.contentProfileId,
        scriptToneId: overrides?.scriptToneId ?? existing?.scriptToneId,
        scriptToneIntensity: overrides?.scriptToneIntensity ?? existing?.scriptToneIntensity,
        reviewMode: overrides?.reviewMode ?? existing?.reviewMode,
    });
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

function getContentProfileMetadata(metadata: Record<string, unknown> | undefined): ContentProfileMetadata | undefined {
    const contentProfile = metadata?.['contentProfile'];
    if (!contentProfile || typeof contentProfile !== 'object' || Array.isArray(contentProfile)) return undefined;
    return contentProfile as ContentProfileMetadata;
}

function findMediaImageNode(nodes: Array<Record<string, unknown>>): Record<string, unknown> | undefined {
    return nodes.find(node => (node['blockType'] ?? node['type']) === 'media-image');
}

function getNodeConfig(node: Record<string, unknown>): Record<string, unknown> {
    return node['config'] && typeof node['config'] === 'object' && !Array.isArray(node['config'])
        ? (node['config'] as Record<string, unknown>)
        : {};
}

function getMediaImageSceneCount(node: Record<string, unknown> | undefined): number {
    const config = node ? getNodeConfig(node) : undefined;
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
