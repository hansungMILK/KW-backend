import { describe, expect, it } from 'vitest';

import {
    filterNodesByWorkflowGroup,
    getWorkflowGroupOptions,
    getWorkflowRunButtonLabel,
    getWorkflowRunMode,
    isWorkflowRunButtonDisabled,
} from './run-mode';

import type { NodeData } from '@flows/flows';

const contentNode = (config: Record<string, unknown>): NodeData => ({
    id: 'node-content',
    type: 'content',
    name: 'Script',
    config,
});

const longformReviewNode = (config: Record<string, unknown>): NodeData => ({
    id: 'node-longform-review',
    type: 'longform-review',
    name: 'Longform review',
    config,
});

const longformScriptNode = (config: Record<string, unknown>): NodeData => ({
    id: 'node-longform-script',
    type: 'longform-script',
    name: 'Longform script',
    config,
});

const countryballAngleLabNode = (config: Record<string, unknown>): NodeData => ({
    id: 'node-countryball-angle-lab',
    type: 'countryball-angle-lab',
    name: 'Countryball angle lab',
    config,
});

describe('workflow run mode', () => {
    it('keeps the run button disabled while a workflow is still running', () => {
        expect(
            isWorkflowRunButtonDisabled({
                isWorkflowRunning: false,
                isLoading: false,
                runStatus: 'running',
            })
        ).toBe(true);
    });

    it('keeps the run button enabled while waiting for script review', () => {
        expect(
            isWorkflowRunButtonDisabled({
                isWorkflowRunning: false,
                isLoading: false,
                runStatus: 'reviewing',
            })
        ).toBe(false);
    });

    it('uses countryball angle continuation wording instead of script review copy', () => {
        expect(
            getWorkflowRunButtonLabel({
                isApplyingProposal: false,
                isWorkflowRunning: false,
                runStatus: 'reviewing',
                reviewKind: 'countryball-angle',
            })
        ).toBe('선택한 앵글로 작가 설계 실행');
    });

    it('runs in step mode when the approved content node requests script-first review', () => {
        expect(getWorkflowRunMode([contentNode({ reviewMode: 'script-first' })])).toEqual({
            executionMode: 'step',
            scriptReviewFirst: true,
        });
    });

    it('runs the full workflow when review mode is direct-run', () => {
        expect(getWorkflowRunMode([contentNode({ reviewMode: 'direct-run' })])).toEqual({
            executionMode: 'full',
            scriptReviewFirst: false,
        });
    });

    it('runs the full workflow after a reviewed script has been saved', () => {
        expect(
            getWorkflowRunMode([
                contentNode({
                    reviewMode: 'script-first',
                    reviewedOutput: JSON.stringify({ scenes: [{ narration: '검수본' }] }),
                }),
            ])
        ).toEqual({
            executionMode: 'full',
            scriptReviewFirst: false,
        });
    });

    it('runs in step mode when any content node still requests script-first review', () => {
        expect(
            getWorkflowRunMode([
                contentNode({ reviewMode: 'direct-run' }),
                { ...contentNode({ reviewMode: 'script-first' }), id: 'node-content-2' },
            ])
        ).toEqual({
            executionMode: 'step',
            scriptReviewFirst: true,
        });
    });

    it('runs the full workflow when reviewed output is stored as an object', () => {
        expect(
            getWorkflowRunMode([
                contentNode({
                    reviewMode: 'script-first',
                    reviewedOutput: { scenes: [{ narration: '검수본' }] },
                }),
            ])
        ).toEqual({
            executionMode: 'full',
            scriptReviewFirst: false,
        });
    });

    it('runs longform production in step mode until the review artifact is approved', () => {
        expect(
            getWorkflowRunMode([
                longformReviewNode({
                    reviewMode: 'script-first',
                    reviewStatus: 'draft',
                    mediaExecutionAllowed: false,
                }),
                {
                    id: 'node-longform-tts',
                    type: 'longform-tts',
                    name: 'Longform TTS',
                    config: { mode: 'longform-gate-b' },
                },
            ])
        ).toEqual({
            executionMode: 'step',
            scriptReviewFirst: true,
        });
    });

    it('runs the full longform production workflow after review approval', () => {
        expect(
            getWorkflowRunMode([
                longformReviewNode({
                    reviewMode: 'script-first',
                    reviewStatus: 'approved',
                    approvedArtifactId: 'longform-review-1',
                }),
            ])
        ).toEqual({
            executionMode: 'full',
            scriptReviewFirst: false,
        });
    });

    it('runs full longform production when paid approval was saved from an upstream script preview', () => {
        expect(
            getWorkflowRunMode([
                longformScriptNode({
                    reviewMode: 'script-first',
                    reviewStatus: 'approved',
                    approvedArtifactId: 'longform-review-from-script',
                    mediaExecutionAllowed: true,
                }),
                longformReviewNode({
                    reviewMode: 'script-first',
                    reviewStatus: 'draft',
                    mediaExecutionAllowed: false,
                }),
            ])
        ).toEqual({
            executionMode: 'full',
            scriptReviewFirst: false,
        });
    });

    it('keeps longform production in step mode when the draft was saved but not explicitly approved', () => {
        expect(
            getWorkflowRunMode([
                longformReviewNode({
                    reviewMode: 'script-first',
                    reviewedOutput: JSON.stringify({
                        fullScriptDraft: '검수 완료 대본',
                        scenes: [{ sceneId: 'scene-1' }],
                    }),
                }),
            ])
        ).toEqual({
            executionMode: 'step',
            scriptReviewFirst: true,
        });
    });

    it('runs countryball production in step mode until a story angle is selected', () => {
        expect(
            getWorkflowRunMode([
                countryballAngleLabNode({
                    reviewMode: 'script-first',
                }),
            ])
        ).toEqual({
            executionMode: 'step',
            scriptReviewFirst: true,
        });
    });

    it('runs the full countryball production workflow after a story angle is selected', () => {
        expect(
            getWorkflowRunMode([
                countryballAngleLabNode({
                    reviewMode: 'script-first',
                    selectedAngleId: 'angle_1',
                }),
            ])
        ).toEqual({
            executionMode: 'full',
            scriptReviewFirst: false,
        });
    });

    it('discovers workflow groups from approved proposal metadata', () => {
        expect(
            getWorkflowGroupOptions([
                {
                    ...contentNode({}),
                    id: 'shorts-content',
                    workflowGroupId: 'proposal-shorts',
                    workflowGroupLabel: '고양이 쇼츠',
                } as NodeData,
                {
                    ...longformReviewNode({}),
                    id: 'longform-review',
                    workflowGroupId: 'proposal-longform',
                    workflowGroupLabel: 'T머니 롱폼',
                } as NodeData,
                {
                    id: 'port-1',
                    type: 'input',
                    name: 'input port',
                    workflowGroupId: 'proposal-longform',
                } as NodeData,
            ])
        ).toEqual([
            { id: 'proposal-shorts', label: '고양이 쇼츠', nodeCount: 1 },
            { id: 'proposal-longform', label: 'T머니 롱폼', nodeCount: 1 },
        ]);
    });

    it('filters run-mode decisions to the selected workflow group', () => {
        const nodes = [
            {
                ...contentNode({ reviewMode: 'script-first' }),
                id: 'old-shorts-content',
                workflowGroupId: 'proposal-shorts',
            } as NodeData,
            {
                ...longformReviewNode({ reviewMode: 'script-first', reviewStatus: 'approved' }),
                id: 'new-longform-review',
                workflowGroupId: 'proposal-longform',
            } as NodeData,
        ];

        expect(getWorkflowRunMode(nodes)).toEqual({
            executionMode: 'step',
            scriptReviewFirst: true,
        });
        expect(getWorkflowRunMode(filterNodesByWorkflowGroup(nodes, 'proposal-longform'))).toEqual({
            executionMode: 'full',
            scriptReviewFirst: false,
        });
    });
});
