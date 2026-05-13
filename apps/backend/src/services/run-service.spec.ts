import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runService } from './run-service';
import { settingsService } from './settings-service';
import { queue } from '../adapters/aws/queue';
import { flowRepo } from '../repositories/flow-repository';
import { runRepo } from '../repositories/run-repository';

vi.mock('../repositories/flow-repository', () => ({
    flowRepo: {
        get: vi.fn(),
    },
}));

vi.mock('../repositories/run-repository', () => ({
    runRepo: {
        getRun: vi.fn(),
        getRunNode: vi.fn(),
        listRunNodes: vi.fn(),
        putRun: vi.fn(),
        putRunNode: vi.fn(),
        updateRunNodeStatus: vi.fn(),
        updateRunStatus: vi.fn(),
    },
}));

vi.mock('../adapters/aws/queue', () => ({
    queue: {
        send: vi.fn(),
    },
}));

vi.mock('./settings-service', () => ({
    settingsService: {
        getKeyForProviderAsync: vi.fn(),
    },
}));

const getFlow = vi.mocked(flowRepo.get);
const getRun = vi.mocked(runRepo.getRun);
const getRunNode = vi.mocked(runRepo.getRunNode);
const listRunNodes = vi.mocked(runRepo.listRunNodes);
const putRun = vi.mocked(runRepo.putRun);
const putRunNode = vi.mocked(runRepo.putRunNode);
const updateRunNodeStatus = vi.mocked(runRepo.updateRunNodeStatus);
const updateRunStatus = vi.mocked(runRepo.updateRunStatus);
const sendQueueMessage = vi.mocked(queue.send);
const getKeyForProviderAsync = vi.mocked(settingsService.getKeyForProviderAsync);

describe('runService cost guards', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not require provider keys for deterministic longform Gate A review nodes', async () => {
        getFlow.mockResolvedValueOnce({
            id: 'flow-longform-gate-a',
            name: 'Longform Gate A flow',
            state: 'READY',
            nodes: [
                {
                    id: 'node-source',
                    blockType: 'longform-source',
                    label: 'Longform source',
                    config: {},
                },
                {
                    id: 'node-review',
                    blockType: 'longform-review',
                    label: 'Longform review',
                    config: {},
                },
            ],
            edges: [{ source: 'node-source', target: 'node-review' }],
            createdAt: '2026-05-13T00:00:00.000Z',
            updatedAt: '2026-05-13T00:00:00.000Z',
        });
        getKeyForProviderAsync.mockResolvedValue(null);
        putRun.mockResolvedValue(undefined);
        putRunNode.mockResolvedValue(undefined);
        sendQueueMessage.mockResolvedValue(undefined);

        const result = await runService.createRun('flow-longform-gate-a');

        expect(result).toEqual(expect.objectContaining({ ok: true }));
        expect(getKeyForProviderAsync).not.toHaveBeenCalled();
        expect(putRun).toHaveBeenCalled();
        expect(putRunNode).toHaveBeenCalledTimes(2);
        expect(sendQueueMessage).toHaveBeenCalled();
    });

    it('allows a step longform run to queue with future Gate B nodes before approval', async () => {
        getFlow.mockResolvedValueOnce({
            id: 'flow-longform-full-factory',
            name: 'Longform full factory flow',
            state: 'READY',
            nodes: [
                {
                    id: 'node-source',
                    blockType: 'longform-source',
                    label: 'Longform source',
                    config: {},
                },
                {
                    id: 'node-review',
                    blockType: 'longform-review',
                    label: 'Longform review',
                    config: { reviewMode: 'script-first', reviewStatus: 'draft' },
                },
                {
                    id: 'node-tts',
                    blockType: 'longform-tts',
                    label: 'Longform narration',
                    config: { mode: 'longform-gate-b', mediaExecutionAllowed: false },
                },
                {
                    id: 'node-render',
                    blockType: 'longform-render',
                    label: 'Longform render',
                    config: {
                        mode: 'longform-gate-b',
                        mediaExecutionAllowed: false,
                        longformHtmlRenderEstimatedCostUsd: 4.5,
                    },
                },
            ],
            edges: [
                { source: 'node-source', target: 'node-review' },
                { source: 'node-review', target: 'node-tts' },
                { source: 'node-tts', target: 'node-render' },
            ],
            createdAt: '2026-05-13T00:00:00.000Z',
            updatedAt: '2026-05-13T00:00:00.000Z',
        });
        getKeyForProviderAsync.mockResolvedValue(null);
        putRun.mockResolvedValue(undefined);
        putRunNode.mockResolvedValue(undefined);
        sendQueueMessage.mockResolvedValue(undefined);

        const result = await runService.createRun('flow-longform-full-factory', 'MANUAL', { executionMode: 'step' });

        expect(result).toEqual(expect.objectContaining({ ok: true }));
        expect(getKeyForProviderAsync).not.toHaveBeenCalled();
        expect(putRun).toHaveBeenCalled();
        expect(putRunNode).toHaveBeenCalledTimes(4);
        expect(sendQueueMessage).toHaveBeenCalled();
    });

    it('allows full Gate B execution when the same workflow has an approved longform review artifact', async () => {
        getFlow.mockResolvedValueOnce({
            id: 'flow-longform-approved',
            name: 'Approved longform flow',
            state: 'READY',
            nodes: [
                {
                    id: 'node-source',
                    blockType: 'longform-source',
                    label: 'Longform source',
                    config: {},
                },
                {
                    id: 'node-review',
                    blockType: 'longform-review',
                    label: 'Longform review',
                    config: {
                        reviewMode: 'script-first',
                        reviewedOutput: JSON.stringify({
                            fullScriptDraft: '승인된 대본',
                            visualChapters: [{ chapterId: 'chapter-1' }],
                            scenes: [{ sceneId: 'scene-1' }],
                        }),
                    },
                },
                {
                    id: 'node-tts',
                    blockType: 'longform-tts',
                    label: 'Longform narration',
                    config: { mode: 'longform-gate-b', mediaExecutionAllowed: false },
                },
                {
                    id: 'node-render',
                    blockType: 'longform-render',
                    label: 'Longform render',
                    config: {
                        mode: 'longform-gate-b',
                        mediaExecutionAllowed: false,
                        longformHtmlRenderEstimatedCostUsd: 4.5,
                    },
                },
            ],
            edges: [
                { source: 'node-source', target: 'node-review' },
                { source: 'node-review', target: 'node-tts' },
                { source: 'node-tts', target: 'node-render' },
            ],
            createdAt: '2026-05-13T00:00:00.000Z',
            updatedAt: '2026-05-13T00:00:00.000Z',
        });
        getKeyForProviderAsync.mockResolvedValue({ provider: 'elevenlabs', apiKey: 'test-key' } as never);
        putRun.mockResolvedValue(undefined);
        putRunNode.mockResolvedValue(undefined);
        sendQueueMessage.mockResolvedValue(undefined);

        const result = await runService.createRun('flow-longform-approved', 'MANUAL', { executionMode: 'full' });

        expect(result).toEqual(expect.objectContaining({ ok: true }));
        expect(getKeyForProviderAsync).toHaveBeenCalledTimes(1);
        expect(getKeyForProviderAsync).toHaveBeenCalledWith('elevenlabs');
        expect(putRun).toHaveBeenCalled();
        expect(putRunNode).toHaveBeenCalledTimes(4);
        expect(sendQueueMessage).toHaveBeenCalled();
    });

    it('requires provider keys for longform Gate B execution nodes before queueing', async () => {
        getFlow.mockResolvedValueOnce({
            id: 'flow-longform-providers',
            name: 'Longform provider guard flow',
            state: 'READY',
            nodes: [
                {
                    id: 'node-script',
                    blockType: 'longform-script',
                    label: 'Longform script',
                    config: {},
                },
                {
                    id: 'node-tts',
                    blockType: 'longform-tts',
                    label: 'Longform narration',
                    config: {
                        mediaExecutionAllowed: true,
                        approvedArtifactId: 'gate-a-artifact-1',
                    },
                },
            ],
            edges: [{ source: 'node-script', target: 'node-tts' }],
            createdAt: '2026-05-13T00:00:00.000Z',
            updatedAt: '2026-05-13T00:00:00.000Z',
        });
        getKeyForProviderAsync.mockResolvedValue(null);

        const result = await runService.createRun('flow-longform-providers');

        expect(result).toEqual(
            expect.objectContaining({
                ok: false,
                error: 'MISSING_API_KEYS',
                status: 422,
                missingProviders: ['elevenlabs'],
            })
        );
        expect(putRun).not.toHaveBeenCalled();
        expect(putRunNode).not.toHaveBeenCalled();
        expect(sendQueueMessage).not.toHaveBeenCalled();
    });

    it('blocks longform HTML and HyperFrames render attempts above the $5 cap before any execution side effect', async () => {
        getFlow.mockResolvedValueOnce({
            id: 'flow-longform-cap',
            name: 'Longform cap flow',
            state: 'READY',
            nodes: [
                {
                    id: 'node-render',
                    blockType: 'media-video',
                    label: 'HyperFrames render',
                    config: {
                        contentProfileId: 'longform.explainer.v1',
                        renderer: 'hyperframes',
                        htmlComposeEstimatedCostUsd: 2.75,
                        hyperframesRenderEstimatedCostUsd: 2.3,
                    },
                },
            ],
            edges: [],
            createdAt: '2026-05-13T00:00:00.000Z',
            updatedAt: '2026-05-13T00:00:00.000Z',
        });

        const result = await runService.createRun('flow-longform-cap');

        expect(result).toEqual(
            expect.objectContaining({
                ok: false,
                error: 'LONGFORM_HTML_RENDER_COST_LIMIT_EXCEEDED',
                status: 422,
                estimatedCostUsd: 5.05,
                maxCostUsd: 5,
            })
        );
        expect(putRun).not.toHaveBeenCalled();
        expect(putRunNode).not.toHaveBeenCalled();
        expect(sendQueueMessage).not.toHaveBeenCalled();
        expect(getKeyForProviderAsync).not.toHaveBeenCalled();
    });

    it('does not block non-render longform nodes just because they carry generic cost fields', async () => {
        getFlow.mockResolvedValueOnce({
            id: 'flow-longform-content',
            name: 'Longform content flow',
            state: 'READY',
            nodes: [
                {
                    id: 'node-content',
                    blockType: 'content',
                    label: 'Longform outline',
                    config: {
                        contentProfileId: 'longform.explainer.v1',
                        composeEstimatedCostUsd: 8,
                    },
                },
            ],
            edges: [],
            createdAt: '2026-05-13T00:00:00.000Z',
            updatedAt: '2026-05-13T00:00:00.000Z',
        });

        const result = await runService.createRun('flow-longform-content');

        expect(result).toEqual(
            expect.objectContaining({
                ok: false,
                error: 'MISSING_API_KEYS',
                status: 422,
            })
        );
        expect(putRun).not.toHaveBeenCalled();
        expect(sendQueueMessage).not.toHaveBeenCalled();
    });

    it('applies the same longform HTML render cap before single-node execution side effects', async () => {
        getFlow.mockResolvedValueOnce({
            id: 'flow-single-longform-cap',
            name: 'Single node longform cap flow',
            state: 'READY',
            nodes: [
                {
                    id: 'node-source',
                    blockType: 'content',
                    label: 'Outline',
                    config: {},
                },
                {
                    id: 'node-render',
                    blockType: 'media-video',
                    label: 'HyperFrames render',
                    config: {
                        contentProfileId: 'longform.documentary.v1',
                        renderer: 'hyperframes',
                        longformHtmlRenderEstimatedCostUsd: 5.01,
                    },
                },
            ],
            edges: [{ source: 'node-source', target: 'node-render' }],
            createdAt: '2026-05-13T00:00:00.000Z',
            updatedAt: '2026-05-13T00:00:00.000Z',
        });

        const result = await runService.createSingleNodeRun('flow-single-longform-cap', 'node-render');

        expect(result).toEqual(
            expect.objectContaining({
                ok: false,
                error: 'LONGFORM_HTML_RENDER_COST_LIMIT_EXCEEDED',
                status: 422,
                estimatedCostUsd: 5.01,
                maxCostUsd: 5,
            })
        );
        expect(putRun).not.toHaveBeenCalled();
        expect(putRunNode).not.toHaveBeenCalled();
        expect(sendQueueMessage).not.toHaveBeenCalled();
        expect(getKeyForProviderAsync).not.toHaveBeenCalled();
    });

    it('blocks longform-render nodes above the $5 cap before any execution side effect', async () => {
        getFlow.mockResolvedValueOnce({
            id: 'flow-longform-render-cap',
            name: 'Longform render cap flow',
            state: 'READY',
            nodes: [
                {
                    id: 'node-render',
                    blockType: 'longform-render',
                    label: 'Longform HyperFrames render',
                    config: {
                        rendererRoute: 'hyperframes',
                        htmlComposeEstimatedCostUsd: 2.75,
                        hyperframesRenderEstimatedCostUsd: 2.35,
                    },
                },
            ],
            edges: [],
            createdAt: '2026-05-13T00:00:00.000Z',
            updatedAt: '2026-05-13T00:00:00.000Z',
        });

        const result = await runService.createRun('flow-longform-render-cap');

        expect(result).toEqual(
            expect.objectContaining({
                ok: false,
                error: 'LONGFORM_HTML_RENDER_COST_LIMIT_EXCEEDED',
                status: 422,
                estimatedCostUsd: 5.1,
                maxCostUsd: 5,
            })
        );
        expect(putRun).not.toHaveBeenCalled();
        expect(putRunNode).not.toHaveBeenCalled();
        expect(sendQueueMessage).not.toHaveBeenCalled();
        expect(getKeyForProviderAsync).not.toHaveBeenCalled();
    });

    it('blocks longform Gate B nodes without an approved Gate A artifact before queueing', async () => {
        getFlow.mockResolvedValueOnce({
            id: 'flow-longform-unapproved',
            name: 'Longform unapproved flow',
            state: 'READY',
            nodes: [
                {
                    id: 'node-render',
                    blockType: 'longform-render',
                    label: 'Longform HyperFrames render',
                    config: {
                        rendererRoute: 'hyperframes',
                        longformHtmlRenderEstimatedCostUsd: 1.25,
                    },
                },
            ],
            edges: [],
            createdAt: '2026-05-13T00:00:00.000Z',
            updatedAt: '2026-05-13T00:00:00.000Z',
        });

        const result = await runService.createRun('flow-longform-unapproved');

        expect(result).toEqual(
            expect.objectContaining({
                ok: false,
                error: 'LONGFORM_GATE_B_APPROVAL_REQUIRED',
                status: 409,
            })
        );
        expect(putRun).not.toHaveBeenCalled();
        expect(putRunNode).not.toHaveBeenCalled();
        expect(sendQueueMessage).not.toHaveBeenCalled();
        expect(getKeyForProviderAsync).not.toHaveBeenCalled();
    });

    it('blocks single-node config overrides that would make the actual render execution exceed the longform cap', async () => {
        getFlow.mockResolvedValueOnce({
            id: 'flow-single-override-cap',
            name: 'Single node override cap flow',
            state: 'READY',
            nodes: [
                {
                    id: 'node-render',
                    blockType: 'media-video',
                    label: 'Video render',
                    config: {
                        format: '16:9',
                    },
                },
            ],
            edges: [],
            createdAt: '2026-05-13T00:00:00.000Z',
            updatedAt: '2026-05-13T00:00:00.000Z',
        });

        const result = await runService.createSingleNodeRun('flow-single-override-cap', 'node-render', 'MANUAL', {
            config: {
                renderer: 'hyperframes',
                longformHtmlRenderEstimatedCostUsd: 5.75,
            },
        });

        expect(result).toEqual(
            expect.objectContaining({
                ok: false,
                error: 'LONGFORM_HTML_RENDER_COST_LIMIT_EXCEEDED',
                status: 422,
                estimatedCostUsd: 5.75,
                maxCostUsd: 5,
            })
        );
        expect(putRun).not.toHaveBeenCalled();
        expect(putRunNode).not.toHaveBeenCalled();
        expect(sendQueueMessage).not.toHaveBeenCalled();
    });

    it('blocks retry attempts that would re-run an over-cap downstream longform render node', async () => {
        getRunNode.mockResolvedValueOnce({
            runId: 'run-retry-cap',
            nodeId: 'node-content',
            blockType: 'content',
            label: 'Script',
            status: 'FAILED',
            progress: 50,
            retryCount: 0,
            parentNodeIds: [],
            updatedAt: '2026-05-13T00:00:00.000Z',
        });
        getRun.mockResolvedValueOnce({
            runId: 'run-retry-cap',
            flowId: 'flow-retry-cap',
            runType: 'FULL_FLOW',
            status: 'FAILED',
            triggerSource: 'MANUAL',
            flowSnapshot: {
                nodes: [
                    {
                        id: 'node-content',
                        blockType: 'content',
                        config: {},
                    },
                    {
                        id: 'node-render',
                        blockType: 'media-video',
                        config: {
                            renderer: 'hyperframes',
                            longformHtmlRenderEstimatedCostUsd: 5.25,
                        },
                    },
                ],
                edges: [{ source: 'node-content', target: 'node-render' }],
            },
            createdAt: '2026-05-13T00:00:00.000Z',
        });
        listRunNodes.mockResolvedValueOnce([
            {
                runId: 'run-retry-cap',
                nodeId: 'node-content',
                blockType: 'content',
                label: 'Script',
                status: 'FAILED',
                progress: 50,
                retryCount: 0,
                parentNodeIds: [],
                updatedAt: '2026-05-13T00:00:00.000Z',
            },
            {
                runId: 'run-retry-cap',
                nodeId: 'node-render',
                blockType: 'media-video',
                label: 'Render',
                status: 'SKIPPED',
                progress: 0,
                retryCount: 0,
                parentNodeIds: ['node-content'],
                updatedAt: '2026-05-13T00:00:00.000Z',
            },
        ]);

        const result = await runService.retryNode('run-retry-cap', 'node-content');

        expect(result).toEqual(
            expect.objectContaining({
                ok: false,
                error: 'LONGFORM_HTML_RENDER_COST_LIMIT_EXCEEDED',
                status: 422,
                estimatedCostUsd: 5.25,
                maxCostUsd: 5,
            })
        );
        expect(updateRunNodeStatus).not.toHaveBeenCalled();
        expect(updateRunStatus).not.toHaveBeenCalled();
        expect(sendQueueMessage).not.toHaveBeenCalled();
    });

    it('blocks retry attempts when the over-cap render config lives in the stored RunNode input payload', async () => {
        getRunNode.mockResolvedValueOnce({
            runId: 'run-retry-payload-cap',
            nodeId: 'node-render',
            blockType: 'media-video',
            label: 'Render',
            status: 'FAILED',
            progress: 50,
            retryCount: 0,
            parentNodeIds: [],
            inputPayload: {
                renderer: 'hyperframes',
                longformHtmlRenderEstimatedCostUsd: 5.5,
            },
            updatedAt: '2026-05-13T00:00:00.000Z',
        });
        getRun.mockResolvedValueOnce({
            runId: 'run-retry-payload-cap',
            flowId: 'flow-retry-payload-cap',
            runType: 'SINGLE_NODE',
            targetNodeId: 'node-render',
            status: 'FAILED',
            triggerSource: 'MANUAL',
            flowSnapshot: {
                nodes: [
                    {
                        id: 'node-render',
                        blockType: 'media-video',
                        config: {
                            format: '16:9',
                        },
                    },
                ],
                edges: [],
            },
            createdAt: '2026-05-13T00:00:00.000Z',
        });
        listRunNodes.mockResolvedValueOnce([
            {
                runId: 'run-retry-payload-cap',
                nodeId: 'node-render',
                blockType: 'media-video',
                label: 'Render',
                status: 'FAILED',
                progress: 50,
                retryCount: 0,
                parentNodeIds: [],
                inputPayload: {
                    renderer: 'hyperframes',
                    longformHtmlRenderEstimatedCostUsd: 5.5,
                },
                updatedAt: '2026-05-13T00:00:00.000Z',
            },
        ]);

        const result = await runService.retryNode('run-retry-payload-cap', 'node-render');

        expect(result).toEqual(
            expect.objectContaining({
                ok: false,
                error: 'LONGFORM_HTML_RENDER_COST_LIMIT_EXCEEDED',
                status: 422,
                estimatedCostUsd: 5.5,
                maxCostUsd: 5,
            })
        );
        expect(updateRunNodeStatus).not.toHaveBeenCalled();
        expect(updateRunStatus).not.toHaveBeenCalled();
        expect(sendQueueMessage).not.toHaveBeenCalled();
    });
});
