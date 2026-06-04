import type { NodeData } from '@flows/flows';

type WorkflowRunMode = {
    executionMode: 'full' | 'step';
    scriptReviewFirst: boolean;
};

export type WorkflowRunStatus = 'running' | 'reviewing' | 'completed' | 'failed' | null;
export type WorkflowReviewKind = 'script' | 'countryball-angle';
export type WorkflowGroupOption = {
    id: string;
    label: string;
    nodeCount: number;
};

export const isWorkflowRunButtonDisabled = (state: {
    isWorkflowRunning: boolean;
    isLoading: boolean;
    runStatus: WorkflowRunStatus;
}): boolean => state.isWorkflowRunning || state.isLoading || state.runStatus === 'running';

export const getWorkflowRunButtonLabel = (state: {
    isApplyingProposal: boolean;
    isWorkflowRunning: boolean;
    runStatus: WorkflowRunStatus;
    reviewKind?: WorkflowReviewKind | null;
}): string => {
    if (state.isApplyingProposal) return '제안 추가 중';
    if (state.isWorkflowRunning) return '실행 요청 중';
    if (state.runStatus === 'running') return '워크플로우 실행 중';
    if (state.runStatus === 'reviewing') {
        return state.reviewKind === 'countryball-angle' ? '선택한 앵글로 작가 설계 실행' : '검수본으로 이어서 실행';
    }
    return '워크플로우 실행';
};

const getWorkflowNodeType = (node: NodeData): string | undefined =>
    node.type ?? ((node as NodeData & { blockType?: string }).blockType as string | undefined);

const getWorkflowGroupId = (node: NodeData): string | undefined => {
    const extended = node as NodeData & { workflowGroupId?: unknown };
    const value = extended.workflowGroupId;
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
};

const getWorkflowGroupLabel = (node: NodeData): string | undefined => {
    const extended = node as NodeData & { workflowGroupLabel?: unknown };
    const value = extended.workflowGroupLabel;
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
};

const isExecutableWorkflowNode = (node: NodeData): boolean => {
    const type = getWorkflowNodeType(node);
    const stereo = (node as NodeData & { stereo?: unknown }).stereo;
    return !!type && stereo !== 'port' && type !== 'input' && type !== 'output' && type !== 'port';
};

const inferWorkflowGroupLabel = (nodeTypes: Set<string>): string => {
    if ([...nodeTypes].some(type => type.startsWith('longform-'))) return '롱폼 워크플로우';
    if (nodeTypes.has('media-video') || nodeTypes.has('media-image')) return '쇼츠/영상 워크플로우';
    return '워크플로우';
};

export const getWorkflowGroupOptions = (nodes: NodeData[] | undefined): WorkflowGroupOption[] => {
    const groups = new Map<string, { label?: string; nodeCount: number; nodeTypes: Set<string> }>();

    for (const node of nodes ?? []) {
        const groupId = getWorkflowGroupId(node);
        if (!groupId || !isExecutableWorkflowNode(node)) continue;

        const group = groups.get(groupId) ?? { nodeCount: 0, nodeTypes: new Set<string>() };
        group.nodeCount += 1;
        group.label ??= getWorkflowGroupLabel(node);
        const type = getWorkflowNodeType(node);
        if (type) group.nodeTypes.add(type);
        groups.set(groupId, group);
    }

    return [...groups.entries()].map(([id, group]) => ({
        id,
        label: group.label ?? inferWorkflowGroupLabel(group.nodeTypes),
        nodeCount: group.nodeCount,
    }));
};

export const filterNodesByWorkflowGroup = (nodes: NodeData[] | undefined, groupId: string | null): NodeData[] => {
    if (!nodes) return [];
    if (!groupId) return nodes;
    return nodes.filter(node => getWorkflowGroupId(node) === groupId);
};

const hasReviewedScriptOutput = (node: NodeData | undefined): boolean => {
    const value = node?.config?.['reviewedOutput'];
    if (typeof value === 'string') return value.trim().length > 0;
    return !!value && typeof value === 'object' && !Array.isArray(value);
};

const hasApprovedLongformReview = (node: NodeData | undefined): boolean => {
    const config = node?.config;
    if (!config) return false;

    const approvedArtifactId = config['approvedArtifactId'];
    return (
        config['mediaExecutionAllowed'] === true ||
        config['reviewStatus'] === 'approved' ||
        config['gateBApproved'] === true ||
        (typeof approvedArtifactId === 'string' && approvedArtifactId.trim().length > 0)
    );
};

const hasSelectedCountryballAngle = (node: NodeData | undefined): boolean => {
    const config = node?.config;
    if (!config) return false;
    const selectedAngleId = config['selectedAngleId'];
    return (
        config['angleSelectionStatus'] === 'selected' ||
        (typeof selectedAngleId === 'string' && selectedAngleId.trim().length > 0) ||
        (!!config['selectedAngle'] &&
            typeof config['selectedAngle'] === 'object' &&
            !Array.isArray(config['selectedAngle']))
    );
};

const isLongformGateANode = (node: NodeData): boolean => {
    const type = getWorkflowNodeType(node);
    return (
        type === 'longform-script' ||
        type === 'longform-storyboard' ||
        type === 'longform-scene-json' ||
        type === 'longform-review'
    );
};

export const getWorkflowRunMode = (nodes: NodeData[] | undefined): WorkflowRunMode => {
    const longformGateAApproved = nodes?.some(node => isLongformGateANode(node) && hasApprovedLongformReview(node));
    const shouldStopForScriptReview =
        nodes?.some(node => {
            const type = getWorkflowNodeType(node);
            if (type === 'content') {
                return node.config?.['reviewMode'] === 'script-first' && !hasReviewedScriptOutput(node);
            }
            if (type === 'longform-review') {
                return node.config?.['reviewMode'] === 'script-first' && !longformGateAApproved;
            }
            if (type === 'countryball-angle-lab') {
                return node.config?.['reviewMode'] === 'script-first' && !hasSelectedCountryballAngle(node);
            }
            return false;
        }) ?? false;

    return {
        executionMode: shouldStopForScriptReview ? 'step' : 'full',
        scriptReviewFirst: shouldStopForScriptReview,
    };
};
