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

const needsScriptReview = (node: NodeData): boolean =>
    getWorkflowNodeType(node) === 'content' &&
    node.config?.['reviewMode'] === 'script-first' &&
    !hasReviewedScriptOutput(node);

export const getWorkflowRunMode = (nodes: NodeData[] | undefined): WorkflowRunMode => {
    const shouldStopForScriptReview = nodes?.some(needsScriptReview) ?? false;

    return {
        executionMode: shouldStopForScriptReview ? 'step' : 'full',
        scriptReviewFirst: shouldStopForScriptReview,
    };
};
