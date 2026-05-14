import type { NodeData } from '@flows/flows';

type WorkflowRunMode = {
    executionMode: 'full' | 'step';
    scriptReviewFirst: boolean;
};

export type WorkflowRunStatus = 'running' | 'completed' | 'failed' | null;

export const isWorkflowRunButtonDisabled = (state: {
    isWorkflowRunning: boolean;
    isLoading: boolean;
    runStatus: WorkflowRunStatus;
}): boolean => state.isWorkflowRunning || state.isLoading || state.runStatus === 'running';

const getWorkflowNodeType = (node: NodeData): string | undefined =>
    node.type ?? ((node as NodeData & { blockType?: string }).blockType as string | undefined);

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
            return false;
        }) ?? false;

    return {
        executionMode: shouldStopForScriptReview ? 'step' : 'full',
        scriptReviewFirst: shouldStopForScriptReview,
    };
};
