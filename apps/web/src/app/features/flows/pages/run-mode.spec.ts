import { describe, expect, it } from 'vitest';

import { getWorkflowRunMode } from './run-mode';

import type { NodeData } from '@flows/flows';

const contentNode = (config: Record<string, unknown>): NodeData => ({
    id: 'node-content',
    type: 'content',
    name: 'Script',
    config,
});

describe('workflow run mode', () => {
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
});
