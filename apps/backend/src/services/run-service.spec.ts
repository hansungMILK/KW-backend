import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getProviderApiKey } from './credential-resolver';
import { runService } from './run-service';
import { openaiAdapter } from '../adapters/ai/openai-adapter';
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

vi.mock('../adapters/ai/openai-adapter', () => ({
    openaiAdapter: {
        chatJson: vi.fn(),
    },
}));

vi.mock('../adapters/ai/paid-openai-guard', () => ({
    PAID_OPENAI_DISABLED: 'PAID_OPENAI_DISABLED',
    isPaidOpenAIAllowed: vi.fn(() => true),
}));

vi.mock('./credential-resolver', () => ({
    getProviderApiKey: vi.fn(),
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
const getProviderApiKeyMock = vi.mocked(getProviderApiKey);
const chatJson = vi.mocked(openaiAdapter.chatJson);

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
        getProviderApiKeyMock.mockResolvedValue(null);
        putRun.mockResolvedValue(undefined);
        putRunNode.mockResolvedValue(undefined);
        sendQueueMessage.mockResolvedValue(undefined);

        const result = await runService.createRun('flow-longform-gate-a');

        expect(result).toEqual(expect.objectContaining({ ok: true }));
        expect(getProviderApiKeyMock).not.toHaveBeenCalled();
        expect(putRun).toHaveBeenCalled();
        expect(putRunNode).toHaveBeenCalledTimes(2);
        expect(sendQueueMessage).toHaveBeenCalled();
    });

    it('accepts analysis recovery quickly by queuing the rewrite worker', async () => {
        getRunNode.mockResolvedValueOnce({
            runId: 'run-analysis-request',
            nodeId: 'node-analysis',
            blockType: 'analysis',
            label: '사실성 및 형식 검수',
            status: 'FAILED',
            progress: 100,
            retryCount: 0,
            parentNodeIds: ['node-content'],
            errorCode: 'ANALYSIS_REJECTED',
            errorMessage: 'Analysis rejected content: 핵심 주제가 부족합니다.',
            outputPayload: {
                issues: [{ severity: 'high', message: '핵심 주제가 부족합니다.' }],
            },
            updatedAt: '2026-05-13T00:00:00.000Z',
        });
        getRun.mockResolvedValueOnce({
            runId: 'run-analysis-request',
            flowId: 'flow-analysis-request',
            runType: 'FULL_FLOW',
            status: 'FAILED',
            triggerSource: 'MANUAL',
            flowSnapshot: {
                nodes: [
                    { id: 'node-content', blockType: 'content', config: {} },
                    { id: 'node-analysis', blockType: 'analysis', config: {} },
                    { id: 'node-image', blockType: 'media-image', config: {} },
                ],
                edges: [
                    { source: 'node-content', target: 'node-analysis' },
                    { source: 'node-analysis', target: 'node-image' },
                ],
            },
            createdAt: '2026-05-13T00:00:00.000Z',
        });
        listRunNodes.mockResolvedValueOnce([
            {
                runId: 'run-analysis-request',
                nodeId: 'node-content',
                blockType: 'content',
                label: '스크립트 생성',
                status: 'COMPLETED',
                progress: 100,
                retryCount: 0,
                parentNodeIds: [],
                outputPayload: { scenes: [{ sceneNumber: 1, narration: '원본' }] },
                updatedAt: '2026-05-13T00:00:00.000Z',
            },
            {
                runId: 'run-analysis-request',
                nodeId: 'node-analysis',
                blockType: 'analysis',
                label: '사실성 및 형식 검수',
                status: 'FAILED',
                progress: 100,
                retryCount: 0,
                parentNodeIds: ['node-content'],
                errorCode: 'ANALYSIS_REJECTED',
                updatedAt: '2026-05-13T00:00:00.000Z',
            },
            {
                runId: 'run-analysis-request',
                nodeId: 'node-image',
                blockType: 'media-image',
                label: '이미지 생성',
                status: 'SKIPPED',
                progress: 0,
                retryCount: 0,
                parentNodeIds: ['node-analysis'],
                updatedAt: '2026-05-13T00:00:00.000Z',
            },
        ]);
        updateRunNodeStatus.mockResolvedValue({ ok: true });
        updateRunStatus.mockResolvedValue({
            ok: true,
            run: {
                runId: 'run-analysis-request',
                flowId: 'flow-analysis-request',
                runType: 'FULL_FLOW',
                status: 'RUNNING',
                triggerSource: 'MANUAL',
                flowSnapshot: { nodes: [], edges: [] },
                createdAt: '2026-05-13T00:00:00.000Z',
            },
        });
        sendQueueMessage.mockResolvedValue(undefined);

        const result = await runService.requestAnalysisRecovery(
            'run-analysis-request',
            'node-analysis',
            'quality review feedback'
        );

        expect(result).toEqual({ ok: true, repairedSourceNodeId: 'node-content' });
        expect(chatJson).not.toHaveBeenCalled();
        expect(updateRunNodeStatus).toHaveBeenCalledWith(
            'run-analysis-request',
            'node-analysis',
            'PENDING',
            expect.objectContaining({
                outputPayload: expect.objectContaining({
                    recoveryRequest: expect.objectContaining({
                        reason: 'quality review feedback',
                        reviewError: 'Analysis rejected content: 핵심 주제가 부족합니다.',
                    }),
                }),
            })
        );
        expect(updateRunNodeStatus).toHaveBeenCalledWith('run-analysis-request', 'node-image', 'PENDING');
        expect(updateRunStatus).toHaveBeenCalledWith(
            'run-analysis-request',
            'RUNNING',
            expect.objectContaining({ completedAt: null, finalOutputSummary: null })
        );
        expect(sendQueueMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'RECOVER_ANALYSIS_NODE',
                runId: 'run-analysis-request',
                nodeId: 'node-analysis',
            })
        );
    });

    it('creates a run snapshot from only the selected workflow group', async () => {
        getFlow.mockResolvedValueOnce({
            id: 'flow-multi-group',
            name: 'Multi workflow canvas',
            state: 'READY',
            nodes: [
                {
                    id: 'old-content',
                    blockType: 'content',
                    label: 'Old shorts script',
                    workflowGroupId: 'proposal-shorts',
                    config: {},
                },
                {
                    id: 'old-image',
                    blockType: 'media-image',
                    label: 'Old shorts images',
                    workflowGroupId: 'proposal-shorts',
                    config: { count: 12 },
                },
                {
                    id: 'new-source',
                    blockType: 'longform-source',
                    label: 'Longform source',
                    workflowGroupId: 'proposal-longform',
                    config: {},
                },
                {
                    id: 'new-review',
                    blockType: 'longform-review',
                    label: 'Longform review',
                    workflowGroupId: 'proposal-longform',
                    config: {},
                },
            ],
            edges: [
                { source: 'old-content', target: 'old-image', workflowGroupId: 'proposal-shorts' },
                { source: 'new-source', target: 'new-review', workflowGroupId: 'proposal-longform' },
            ],
            createdAt: '2026-05-13T00:00:00.000Z',
            updatedAt: '2026-05-13T00:00:00.000Z',
        });
        getProviderApiKeyMock.mockResolvedValue(null);
        putRun.mockResolvedValue(undefined);
        putRunNode.mockResolvedValue(undefined);
        sendQueueMessage.mockResolvedValue(undefined);

        const result = await runService.createRun('flow-multi-group', 'MANUAL', {
            executionMode: 'full',
            scope: { type: 'workflowGroup', groupId: 'proposal-longform' },
        } as Parameters<typeof runService.createRun>[2] & {
            scope: { type: 'workflowGroup'; groupId: string };
        });

        expect(result).toEqual(expect.objectContaining({ ok: true }));
        expect(getProviderApiKeyMock).not.toHaveBeenCalled();
        expect(putRun).toHaveBeenCalledWith(
            expect.objectContaining({
                scope: { type: 'workflowGroup', groupId: 'proposal-longform' },
                flowSnapshot: {
                    nodes: [
                        expect.objectContaining({ id: 'new-source' }),
                        expect.objectContaining({ id: 'new-review' }),
                    ],
                    edges: [expect.objectContaining({ source: 'new-source', target: 'new-review' })],
                },
            })
        );
        expect(putRunNode.mock.calls.map(call => call[0].nodeId)).toEqual(['new-source', 'new-review']);
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
        getProviderApiKeyMock.mockResolvedValue(null);
        putRun.mockResolvedValue(undefined);
        putRunNode.mockResolvedValue(undefined);
        sendQueueMessage.mockResolvedValue(undefined);

        const result = await runService.createRun('flow-longform-full-factory', 'MANUAL', { executionMode: 'step' });

        expect(result).toEqual(expect.objectContaining({ ok: true }));
        expect(getProviderApiKeyMock).not.toHaveBeenCalled();
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
        getProviderApiKeyMock.mockResolvedValue('test-key');
        putRun.mockResolvedValue(undefined);
        putRunNode.mockResolvedValue(undefined);
        sendQueueMessage.mockResolvedValue(undefined);

        const result = await runService.createRun('flow-longform-approved', 'MANUAL', { executionMode: 'full' });

        expect(result).toEqual(expect.objectContaining({ ok: true }));
        expect(getProviderApiKeyMock).toHaveBeenCalledTimes(2);
        expect(getProviderApiKeyMock).toHaveBeenCalledWith('elevenlabs');
        expect(getProviderApiKeyMock).not.toHaveBeenCalledWith('openai');
        expect(putRun).toHaveBeenCalled();
        expect(putRunNode).toHaveBeenCalledTimes(4);
        expect(sendQueueMessage).toHaveBeenCalled();
    });

    it('treats approval saved on an upstream longform script node as Gate B approval', async () => {
        getFlow.mockResolvedValueOnce({
            id: 'flow-longform-script-approved',
            name: 'Longform script approved flow',
            state: 'READY',
            nodes: [
                {
                    id: 'node-script',
                    blockType: 'longform-script',
                    label: 'Longform script',
                    config: {
                        reviewMode: 'script-first',
                        reviewStatus: 'approved',
                        approvedArtifactId: 'longform-review-from-script',
                        mediaExecutionAllowed: true,
                    },
                },
                {
                    id: 'node-review',
                    blockType: 'longform-review',
                    label: 'Longform review',
                    config: { reviewMode: 'script-first', reviewStatus: 'draft', mediaExecutionAllowed: false },
                },
                {
                    id: 'node-tts',
                    blockType: 'longform-tts',
                    label: 'Longform narration',
                    config: { mode: 'longform-gate-b', mediaExecutionAllowed: false },
                },
            ],
            edges: [
                { source: 'node-script', target: 'node-review' },
                { source: 'node-review', target: 'node-tts' },
            ],
            createdAt: '2026-05-13T00:00:00.000Z',
            updatedAt: '2026-05-13T00:00:00.000Z',
        });
        getProviderApiKeyMock.mockResolvedValue('test-key');
        putRun.mockResolvedValue(undefined);
        putRunNode.mockResolvedValue(undefined);
        sendQueueMessage.mockResolvedValue(undefined);

        const result = await runService.createRun('flow-longform-script-approved', 'MANUAL', {
            executionMode: 'step',
        });

        expect(result).toEqual(expect.objectContaining({ ok: true }));
        expect(getProviderApiKeyMock).toHaveBeenCalledWith('openai');
        expect(getProviderApiKeyMock).toHaveBeenCalledWith('elevenlabs');
        expect(putRunNode).toHaveBeenCalledTimes(3);
        expect(sendQueueMessage).toHaveBeenCalled();
    });

    it('requires provider keys for longform OpenAI planning and Gate B execution before queueing', async () => {
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
        getProviderApiKeyMock.mockResolvedValue(null);

        const result = await runService.createRun('flow-longform-providers');

        expect(result).toEqual(
            expect.objectContaining({
                ok: false,
                error: 'MISSING_API_KEYS',
                status: 422,
                missingProviders: ['openai', 'elevenlabs'],
            })
        );
        expect(putRun).not.toHaveBeenCalled();
        expect(putRunNode).not.toHaveBeenCalled();
        expect(sendQueueMessage).not.toHaveBeenCalled();
    });

    it('allows TTS execution with an OpenAI key when ElevenLabs is not configured', async () => {
        getFlow.mockResolvedValueOnce({
            id: 'flow-tts-openai-fallback',
            name: 'OpenAI TTS fallback flow',
            state: 'READY',
            nodes: [
                {
                    id: 'node-tts',
                    blockType: 'media-tts',
                    label: 'Narration',
                    config: {},
                },
            ],
            edges: [],
            createdAt: '2026-05-19T00:00:00.000Z',
            updatedAt: '2026-05-19T00:00:00.000Z',
        });
        getProviderApiKeyMock.mockImplementation(async provider => (provider === 'openai' ? 'openai-key' : null));
        putRun.mockResolvedValue(undefined);
        putRunNode.mockResolvedValue(undefined);
        sendQueueMessage.mockResolvedValue(undefined);

        const result = await runService.createRun('flow-tts-openai-fallback');

        expect(result).toEqual(expect.objectContaining({ ok: true }));
        expect(getProviderApiKeyMock).toHaveBeenCalledWith('elevenlabs');
        expect(getProviderApiKeyMock).toHaveBeenCalledWith('openai');
        expect(putRun).toHaveBeenCalled();
        expect(sendQueueMessage).toHaveBeenCalled();
    });

    it('does not treat raw node apiKeyOverride config as a configured provider credential', async () => {
        getFlow.mockResolvedValueOnce({
            id: 'flow-node-override',
            name: 'Node override flow',
            state: 'READY',
            nodes: [
                {
                    id: 'node-image',
                    blockType: 'media-image',
                    label: 'Image generation',
                    config: {
                        apiKeyOverride: 'sk-node-override',
                    },
                },
            ],
            edges: [],
            createdAt: '2026-05-19T00:00:00.000Z',
            updatedAt: '2026-05-19T00:00:00.000Z',
        });
        getProviderApiKeyMock.mockResolvedValue(null);

        const result = await runService.createRun('flow-node-override');

        expect(result).toEqual(
            expect.objectContaining({
                ok: false,
                error: 'MISSING_API_KEYS',
                status: 422,
                missingProviders: ['openai'],
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
        expect(getProviderApiKeyMock).not.toHaveBeenCalled();
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
        expect(getProviderApiKeyMock).not.toHaveBeenCalled();
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
        expect(getProviderApiKeyMock).not.toHaveBeenCalled();
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
        expect(getProviderApiKeyMock).not.toHaveBeenCalled();
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

    it('allows retrying a failed longform Gate B node when an earlier review node output already approved Gate A', async () => {
        getRunNode.mockResolvedValueOnce({
            runId: 'run-retry-approved',
            nodeId: 'node-motion',
            blockType: 'longform-motion-compose',
            label: 'Motion',
            status: 'FAILED',
            progress: 25,
            retryCount: 0,
            parentNodeIds: ['node-review'],
            inputPayload: {
                mediaExecutionAllowed: false,
            },
            updatedAt: '2026-05-13T00:00:00.000Z',
        });
        getRun.mockResolvedValueOnce({
            runId: 'run-retry-approved',
            flowId: 'flow-retry-approved',
            runType: 'FULL_FLOW',
            status: 'FAILED',
            triggerSource: 'MANUAL',
            flowSnapshot: {
                nodes: [
                    {
                        id: 'node-review',
                        blockType: 'longform-review',
                        config: {},
                    },
                    {
                        id: 'node-motion',
                        blockType: 'longform-motion-compose',
                        config: {
                            mediaExecutionAllowed: false,
                        },
                    },
                    {
                        id: 'node-render',
                        blockType: 'longform-render',
                        config: {
                            renderer: 'hyperframes',
                            longformHtmlRenderEstimatedCostUsd: 1,
                            mediaExecutionAllowed: false,
                        },
                    },
                ],
                edges: [
                    { source: 'node-review', target: 'node-motion' },
                    { source: 'node-motion', target: 'node-render' },
                ],
            },
            createdAt: '2026-05-13T00:00:00.000Z',
        });
        listRunNodes.mockResolvedValueOnce([
            {
                runId: 'run-retry-approved',
                nodeId: 'node-review',
                blockType: 'longform-review',
                label: 'Review',
                status: 'COMPLETED',
                progress: 100,
                retryCount: 0,
                parentNodeIds: [],
                outputPayload: {
                    approvedArtifactId: 'approved-1',
                    reviewStatus: 'approved',
                    mediaExecutionAllowed: true,
                },
                updatedAt: '2026-05-13T00:00:00.000Z',
            },
            {
                runId: 'run-retry-approved',
                nodeId: 'node-motion',
                blockType: 'longform-motion-compose',
                label: 'Motion',
                status: 'FAILED',
                progress: 25,
                retryCount: 0,
                parentNodeIds: ['node-review'],
                inputPayload: {
                    mediaExecutionAllowed: false,
                },
                updatedAt: '2026-05-13T00:00:00.000Z',
            },
            {
                runId: 'run-retry-approved',
                nodeId: 'node-render',
                blockType: 'longform-render',
                label: 'Render',
                status: 'SKIPPED',
                progress: 0,
                retryCount: 0,
                parentNodeIds: ['node-motion'],
                updatedAt: '2026-05-13T00:00:00.000Z',
            },
        ]);
        updateRunNodeStatus.mockResolvedValue({ ok: true });
        updateRunStatus.mockResolvedValue({ ok: true });
        sendQueueMessage.mockResolvedValue(undefined);

        const result = await runService.retryNode('run-retry-approved', 'node-motion');

        expect(result).toEqual({ ok: true });
        expect(updateRunNodeStatus).toHaveBeenCalledWith('run-retry-approved', 'node-motion', 'PENDING');
        expect(updateRunNodeStatus).toHaveBeenCalledWith('run-retry-approved', 'node-render', 'PENDING');
        expect(updateRunStatus).toHaveBeenCalledWith(
            'run-retry-approved',
            'RUNNING',
            expect.objectContaining({ completedAt: null, finalOutputSummary: null })
        );
        expect(sendQueueMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'EXECUTE_RUN' }));
    });

    it('rewrites the upstream script and resumes from a failed analysis node', async () => {
        const originalOutput = {
            title: '바나나 장점',
            hook: '바나나는 왜 좋을까?',
            script: { hook: '바나나는 왜 좋을까?', angle: '장점 요약', cta: '저장해두세요' },
            style: { format: 'vertical-shorts', aspectRatio: '9:16', sceneCount: 2 },
            scenes: [
                {
                    sceneNumber: 1,
                    imageSlot: '[Image #1]',
                    storyBeat: 'hook',
                    topTitle: '바나나 장점',
                    caption: '기분이 좋아져요',
                    narration: '바나나는 우울과 불안을 완화합니다.',
                    imagePrompt: 'banana on a bright kitchen table',
                    visualText: '기분 관리',
                    visual: { topTitle: '바나나 장점', mainCaption: '기분 관리' },
                    claimType: 'fact',
                    sourceRefs: [],
                    durationSec: 5,
                },
                {
                    sceneNumber: 2,
                    imageSlot: '[Image #2]',
                    storyBeat: 'takeaway',
                    topTitle: '바나나 장점',
                    caption: '한 줄 결론',
                    narration: '바나나는 건강에 확실한 장점이 있습니다.',
                    imagePrompt: 'banana beside a simple checklist',
                    visualText: '장점 정리',
                    visual: { topTitle: '바나나 장점', mainCaption: '장점 정리' },
                    claimType: 'fact',
                    sourceRefs: [],
                    durationSec: 5,
                },
            ],
            cta: '저장해두세요',
            totalDurationSec: 10,
            sources: [],
        };
        const repairedOutput = {
            ...originalOutput,
            scenes: originalOutput.scenes.map(scene => ({
                ...scene,
                narration:
                    scene.sceneNumber === 1
                        ? '연구에 따르면 바나나는 기분 관리에 도움이 될 수 있습니다.'
                        : '바나나의 장점은 에너지와 간편함에서 볼 수 있습니다.',
                claimType: 'opinion',
            })),
        };

        getRunNode
            .mockResolvedValueOnce({
                runId: 'run-analysis-recover',
                nodeId: 'node-analysis',
                blockType: 'analysis',
                label: '사실성 및 형식 검수',
                status: 'FAILED',
                progress: 100,
                retryCount: 0,
                parentNodeIds: ['node-content'],
                errorCode: 'ANALYSIS_REJECTED',
                errorMessage:
                    'Analysis rejected content: 요청한 핵심 주제(장점)가 대본 본문/자막에 충분히 반영되지 않았습니다.',
                outputPayload: {
                    approved: false,
                    issues: [
                        {
                            severity: 'high',
                            message: '요청한 핵심 주제(장점)가 대본 본문/자막에 충분히 반영되지 않았습니다.',
                        },
                        {
                            severity: 'high',
                            message: "건강 효능을 단정하기보다 '도움이 될 수 있습니다'처럼 완화하세요.",
                        },
                    ],
                },
                updatedAt: '2026-05-13T00:00:00.000Z',
            })
            .mockResolvedValueOnce({
                runId: 'run-analysis-recover',
                nodeId: 'node-analysis',
                blockType: 'analysis',
                label: '사실성 및 형식 검수',
                status: 'FAILED',
                progress: 100,
                retryCount: 0,
                parentNodeIds: ['node-content'],
                errorCode: 'ANALYSIS_REJECTED',
                updatedAt: '2026-05-13T00:00:00.000Z',
            });
        getRun
            .mockResolvedValueOnce({
                runId: 'run-analysis-recover',
                flowId: 'flow-analysis-recover',
                runType: 'FULL_FLOW',
                status: 'FAILED',
                triggerSource: 'MANUAL',
                flowSnapshot: {
                    nodes: [
                        { id: 'node-content', blockType: 'content', config: {} },
                        { id: 'node-analysis', blockType: 'analysis', config: {} },
                        { id: 'node-image', blockType: 'media-image', config: {} },
                    ],
                    edges: [
                        { source: 'node-content', target: 'node-analysis' },
                        { source: 'node-analysis', target: 'node-image' },
                    ],
                },
                createdAt: '2026-05-13T00:00:00.000Z',
            })
            .mockResolvedValueOnce({
                runId: 'run-analysis-recover',
                flowId: 'flow-analysis-recover',
                runType: 'FULL_FLOW',
                status: 'FAILED',
                triggerSource: 'MANUAL',
                flowSnapshot: {
                    nodes: [
                        { id: 'node-content', blockType: 'content', config: {} },
                        { id: 'node-analysis', blockType: 'analysis', config: {} },
                        { id: 'node-image', blockType: 'media-image', config: {} },
                    ],
                    edges: [
                        { source: 'node-content', target: 'node-analysis' },
                        { source: 'node-analysis', target: 'node-image' },
                    ],
                },
                createdAt: '2026-05-13T00:00:00.000Z',
            });
        listRunNodes
            .mockResolvedValueOnce([
                {
                    runId: 'run-analysis-recover',
                    nodeId: 'node-content',
                    blockType: 'content',
                    label: '스크립트 생성',
                    status: 'COMPLETED',
                    progress: 100,
                    retryCount: 0,
                    parentNodeIds: [],
                    outputPayload: originalOutput,
                    updatedAt: '2026-05-13T00:00:00.000Z',
                },
                {
                    runId: 'run-analysis-recover',
                    nodeId: 'node-analysis',
                    blockType: 'analysis',
                    label: '사실성 및 형식 검수',
                    status: 'FAILED',
                    progress: 100,
                    retryCount: 0,
                    parentNodeIds: ['node-content'],
                    errorCode: 'ANALYSIS_REJECTED',
                    updatedAt: '2026-05-13T00:00:00.000Z',
                },
                {
                    runId: 'run-analysis-recover',
                    nodeId: 'node-image',
                    blockType: 'media-image',
                    label: '이미지 생성',
                    status: 'SKIPPED',
                    progress: 0,
                    retryCount: 0,
                    parentNodeIds: ['node-analysis'],
                    updatedAt: '2026-05-13T00:00:00.000Z',
                },
            ])
            .mockResolvedValueOnce([
                {
                    runId: 'run-analysis-recover',
                    nodeId: 'node-content',
                    blockType: 'content',
                    label: '스크립트 생성',
                    status: 'COMPLETED',
                    progress: 100,
                    retryCount: 0,
                    parentNodeIds: [],
                    outputPayload: repairedOutput,
                    updatedAt: '2026-05-13T00:00:00.000Z',
                },
                {
                    runId: 'run-analysis-recover',
                    nodeId: 'node-analysis',
                    blockType: 'analysis',
                    label: '사실성 및 형식 검수',
                    status: 'FAILED',
                    progress: 100,
                    retryCount: 0,
                    parentNodeIds: ['node-content'],
                    errorCode: 'ANALYSIS_REJECTED',
                    updatedAt: '2026-05-13T00:00:00.000Z',
                },
                {
                    runId: 'run-analysis-recover',
                    nodeId: 'node-image',
                    blockType: 'media-image',
                    label: '이미지 생성',
                    status: 'SKIPPED',
                    progress: 0,
                    retryCount: 0,
                    parentNodeIds: ['node-analysis'],
                    updatedAt: '2026-05-13T00:00:00.000Z',
                },
            ]);
        chatJson
            .mockResolvedValueOnce({
                content: '{"hook":"truncated"',
                model: 'gpt-test',
                inputTokens: 100,
                outputTokens: 200,
                latencyMs: 25,
            })
            .mockResolvedValueOnce({
                content: JSON.stringify(repairedOutput),
                model: 'gpt-test',
                inputTokens: 100,
                outputTokens: 200,
                latencyMs: 25,
            });
        putRunNode.mockResolvedValue(undefined);
        updateRunNodeStatus.mockResolvedValue({ ok: true });
        updateRunStatus.mockResolvedValue({ ok: true });
        sendQueueMessage.mockResolvedValue(undefined);

        const result = await runService.recoverAnalysisNode('run-analysis-recover', 'node-analysis', 'user requested');

        expect(result).toEqual({ ok: true, repairedSourceNodeId: 'node-content' });
        expect(chatJson).toHaveBeenCalledTimes(2);
        expect(chatJson).toHaveBeenCalledWith(
            expect.objectContaining({
                systemPrompt: expect.stringContaining('quality-review feedback'),
                userMessage: expect.stringContaining('요청한 핵심 주제'),
            })
        );
        expect(chatJson).toHaveBeenLastCalledWith(
            expect.objectContaining({
                systemPrompt: expect.stringContaining('previous recovery output was rejected'),
            })
        );
        expect(putRunNode).toHaveBeenCalledWith(
            expect.objectContaining({
                nodeId: 'node-content',
                outputPayload: expect.objectContaining({
                    scenes: expect.arrayContaining([
                        expect.objectContaining({
                            narration: expect.stringContaining('도움이 될 수 있습니다'),
                        }),
                    ]),
                    recovery: expect.objectContaining({
                        recoveredFromNodeId: 'node-analysis',
                        reason: 'user requested',
                    }),
                }),
            })
        );
        expect(updateRunNodeStatus).toHaveBeenCalledWith('run-analysis-recover', 'node-analysis', 'PENDING');
        expect(updateRunNodeStatus).toHaveBeenCalledWith('run-analysis-recover', 'node-image', 'PENDING');
        expect(updateRunStatus).toHaveBeenCalledWith(
            'run-analysis-recover',
            'RUNNING',
            expect.objectContaining({ completedAt: null, finalOutputSummary: null })
        );
        expect(sendQueueMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'EXECUTE_RUN' }));
    });
});
