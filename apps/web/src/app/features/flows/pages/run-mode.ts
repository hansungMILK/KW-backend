import type { NodeData } from '@flows/flows';

type WorkflowRunMode = {
    executionMode: 'full' | 'step';
    scriptReviewFirst: boolean;
};

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

const needsScriptReview = (node: NodeData): boolean =>
    (getWorkflowNodeType(node) === 'content' &&
        node.config?.['reviewMode'] === 'script-first' &&
        !hasReviewedScriptOutput(node)) ||
    (getWorkflowNodeType(node) === 'longform-review' &&
        node.config?.['reviewMode'] === 'script-first' &&
        !hasApprovedLongformReview(node));

export const getWorkflowRunMode = (nodes: NodeData[] | undefined): WorkflowRunMode => {
    const shouldStopForScriptReview = nodes?.some(needsScriptReview) ?? false;

    return {
        executionMode: shouldStopForScriptReview ? 'step' : 'full',
        scriptReviewFirst: shouldStopForScriptReview,
    };
};
