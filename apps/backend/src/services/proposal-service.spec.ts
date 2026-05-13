import { beforeEach, describe, expect, it, vi } from 'vitest';

import { proposalService } from './proposal-service';
import { flowRepo } from '../repositories/flow-repository';
import { messageRepo } from '../repositories/message-repository';
import { proposalRepo } from '../repositories/proposal-repository';

import type { Proposal } from '@flows/contracts';

vi.mock('../repositories/flow-repository', () => ({
    flowRepo: {
        get: vi.fn(),
        put: vi.fn(async () => undefined),
    },
}));

vi.mock('../repositories/message-repository', () => ({
    messageRepo: {
        put: vi.fn(async () => undefined),
    },
}));

vi.mock('../repositories/proposal-repository', () => ({
    proposalRepo: {
        get: vi.fn(),
        put: vi.fn(async () => undefined),
    },
}));

vi.mock('../utils/id-generator', () => ({
    generateNumericId: vi.fn(() => 'system-message-1'),
}));

const getProposal = vi.mocked(proposalRepo.get);
const putProposal = vi.mocked(proposalRepo.put);
const getFlow = vi.mocked(flowRepo.get);
const putFlow = vi.mocked(flowRepo.put);
const putMessage = vi.mocked(messageRepo.put);

describe('proposalService.approve image generation overrides', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('applies selected image style and quality to the approved flow and keeps proposal cost metadata in sync', async () => {
        const proposal: Proposal = {
            proposalId: 'proposal-1',
            flowId: 'flow-1',
            sourceMessageId: 'message-1',
            status: 'PENDING',
            proposedNodes: [
                {
                    id: 'node-content',
                    blockType: 'content',
                    type: 'content',
                    config: {
                        scenes: 12,
                    },
                },
                {
                    id: 'node-image',
                    blockType: 'media-image',
                    type: 'media-image',
                    config: {
                        count: 12,
                        imageStyleId: 'explainer-comic',
                        imageQuality: 'medium',
                    },
                },
            ],
            proposedEdges: [],
            estimatedCost: {
                currency: 'USD',
                total: 0.722,
                breakdown: [
                    { blockType: 'content', amount: 0.03 },
                    { blockType: 'media-image', amount: 0.492 },
                    { blockType: 'media-video', amount: 0.2 },
                ],
            },
            metadata: {
                imageGeneration: {
                    model: 'gpt-image-2',
                    imageStyleId: 'explainer-comic',
                    imageStyleLabel: '정보전달 만화',
                    imageQuality: 'medium',
                    sceneCount: 12,
                    imageEstimatedCostUsd: 0.492,
                    textAndOtherEstimatedCostUsd: 0.23,
                    estimatedTotalCostUsd: 0.722,
                },
            },
            approvalRequired: true,
            createdAt: '2026-05-11T00:00:00.000Z',
            updatedAt: '2026-05-11T00:00:00.000Z',
        };

        getProposal.mockResolvedValue(proposal);
        getFlow.mockResolvedValue({
            id: 'flow-1',
            name: 'Flow',
            state: 'DRAFT',
            nodes: [],
            edges: [],
            createdAt: '2026-05-11T00:00:00.000Z',
            updatedAt: '2026-05-11T00:00:00.000Z',
        });

        const result = await proposalService.approve('proposal-1', undefined, undefined, {
            imageStyleId: 'animation',
            imageQuality: 'high',
            sceneCount: 8,
        });

        expect(result.ok).toBe(true);
        expect(putFlow).toHaveBeenCalledOnce();
        const savedFlow = putFlow.mock.calls[0]?.[0];
        expect(savedFlow?.nodes).toEqual([
            expect.objectContaining({
                id: 'node-content',
                config: expect.objectContaining({
                    scenes: 8,
                }),
            }),
            expect.objectContaining({
                id: 'node-image',
                config: expect.objectContaining({
                    count: 8,
                    imageStyleId: 'animation',
                    imageStyleLabel: '애니메이션',
                    imageQuality: 'high',
                }),
            }),
        ]);

        expect(putProposal).toHaveBeenCalledOnce();
        const savedProposal = putProposal.mock.calls[0]?.[0];
        expect(savedProposal?.estimatedCost).toEqual({
            currency: 'USD',
            total: 1.55,
            breakdown: [
                { blockType: 'content', amount: 0.03 },
                { blockType: 'media-image', amount: 1.32 },
                { blockType: 'media-video', amount: 0.2 },
            ],
        });
        expect(savedProposal?.metadata?.['imageGeneration']).toEqual(
            expect.objectContaining({
                model: 'gpt-image-2',
                imageStyleId: 'animation',
                imageStyleLabel: '애니메이션',
                imageQuality: 'high',
                sceneCount: 8,
                imageEstimatedCostUsd: 1.32,
                textAndOtherEstimatedCostUsd: 0.23,
                estimatedTotalCostUsd: 1.55,
            })
        );
        expect(putMessage).toHaveBeenCalledOnce();
    });

    it('applies selected content profile preferences to approved nodes and proposal metadata', async () => {
        const proposal: Proposal = {
            proposalId: 'proposal-2',
            flowId: 'flow-2',
            sourceMessageId: 'message-2',
            status: 'PENDING',
            proposedNodes: [
                {
                    id: 'node-content',
                    blockType: 'content',
                    type: 'content',
                    config: {
                        scenes: 12,
                    },
                },
                {
                    id: 'node-data',
                    blockType: 'data',
                    type: 'data',
                    config: {},
                },
                {
                    id: 'node-tts',
                    blockType: 'media-tts',
                    type: 'media-tts',
                    config: {
                        lang: 'ko',
                    },
                },
                {
                    id: 'node-video',
                    blockType: 'media-video',
                    type: 'media-video',
                    config: {
                        format: '9:16',
                    },
                },
            ],
            proposedEdges: [],
            estimatedCost: {
                currency: 'USD',
                total: 0.34,
            },
            metadata: {},
            approvalRequired: true,
            createdAt: '2026-05-11T00:00:00.000Z',
            updatedAt: '2026-05-11T00:00:00.000Z',
        };

        getProposal.mockResolvedValue(proposal);
        getFlow.mockResolvedValue({
            id: 'flow-2',
            name: 'Flow',
            state: 'DRAFT',
            nodes: [],
            edges: [],
            createdAt: '2026-05-11T00:00:00.000Z',
            updatedAt: '2026-05-11T00:00:00.000Z',
        });

        const result = await proposalService.approve('proposal-2', undefined, undefined, {
            contentProfileId: 'shorts.info.v1',
            scriptToneId: 'news-anchor',
            scriptToneIntensity: 'high',
            reviewMode: 'script-first',
        });

        expect(result.ok).toBe(true);
        const savedFlow = putFlow.mock.calls[0]?.[0];
        expect(savedFlow?.nodes).toEqual([
            expect.objectContaining({
                id: 'node-content',
                config: expect.objectContaining({
                    contentProfileId: 'shorts.info.v1',
                    scriptToneId: 'news-anchor',
                    scriptToneIntensity: 'high',
                    reviewMode: 'script-first',
                }),
            }),
            expect.objectContaining({
                id: 'node-data',
                config: expect.objectContaining({
                    contentProfileId: 'shorts.info.v1',
                    reviewMode: 'script-first',
                }),
            }),
            expect.objectContaining({
                id: 'node-tts',
                config: expect.objectContaining({
                    contentProfileId: 'shorts.info.v1',
                    reviewMode: 'script-first',
                }),
            }),
            expect.objectContaining({
                id: 'node-video',
                config: expect.objectContaining({
                    contentProfileId: 'shorts.info.v1',
                    reviewMode: 'script-first',
                }),
            }),
        ]);

        const savedProposal = putProposal.mock.calls[0]?.[0];
        expect(savedProposal?.metadata?.['contentProfile']).toEqual(
            expect.objectContaining({
                contentProfileId: 'shorts.info.v1',
                scriptToneId: 'news-anchor',
                scriptToneIntensity: 'high',
                reviewMode: 'script-first',
            })
        );
    });

    it('preserves existing content profile metadata when approval sends only a partial preference override', async () => {
        const proposal: Proposal = {
            proposalId: 'proposal-3',
            flowId: 'flow-3',
            sourceMessageId: 'message-3',
            status: 'PENDING',
            proposedNodes: [
                {
                    id: 'node-search',
                    blockType: 'search',
                    type: 'search',
                    config: {
                        query: '롱폼 제작',
                    },
                },
                {
                    id: 'node-content',
                    blockType: 'content',
                    type: 'content',
                    config: {
                        scenes: 8,
                    },
                },
                {
                    id: 'node-video',
                    blockType: 'media-video',
                    type: 'media-video',
                    config: {
                        format: '16:9',
                    },
                },
            ],
            proposedEdges: [],
            metadata: {
                contentProfile: {
                    contentProfileId: 'longform.explainer.v1',
                    scriptToneId: 'calm-explainer',
                    scriptToneIntensity: 'low',
                    reviewMode: 'direct-run',
                },
            },
            approvalRequired: true,
            createdAt: '2026-05-11T00:00:00.000Z',
            updatedAt: '2026-05-11T00:00:00.000Z',
        };

        getProposal.mockResolvedValue(proposal);
        getFlow.mockResolvedValue({
            id: 'flow-3',
            name: 'Flow',
            state: 'DRAFT',
            nodes: [],
            edges: [],
            createdAt: '2026-05-11T00:00:00.000Z',
            updatedAt: '2026-05-11T00:00:00.000Z',
        });

        const result = await proposalService.approve('proposal-3', undefined, undefined, {
            reviewMode: 'script-first',
        });

        expect(result.ok).toBe(true);
        const savedFlow = putFlow.mock.calls[0]?.[0];
        expect(savedFlow?.nodes).toEqual([
            expect.objectContaining({
                id: 'node-search',
                config: expect.objectContaining({
                    contentProfileId: 'longform.explainer.v1',
                    reviewMode: 'script-first',
                }),
            }),
            expect.objectContaining({
                id: 'node-content',
                config: expect.objectContaining({
                    contentProfileId: 'longform.explainer.v1',
                    scriptToneId: 'calm-explainer',
                    scriptToneIntensity: 'low',
                    reviewMode: 'script-first',
                }),
            }),
            expect.objectContaining({
                id: 'node-video',
                config: expect.objectContaining({
                    contentProfileId: 'longform.explainer.v1',
                    reviewMode: 'script-first',
                }),
            }),
        ]);

        const savedProposal = putProposal.mock.calls[0]?.[0];
        expect(savedProposal?.metadata?.['contentProfile']).toEqual(
            expect.objectContaining({
                contentProfileId: 'longform.explainer.v1',
                scriptToneId: 'calm-explainer',
                scriptToneIntensity: 'low',
                reviewMode: 'script-first',
            })
        );
    });

    it('copies longform HTML render cost breakdown into the approved render node config', async () => {
        const proposal: Proposal = {
            proposalId: 'proposal-4',
            flowId: 'flow-4',
            sourceMessageId: 'message-4',
            status: 'PENDING',
            proposedNodes: [
                {
                    id: 'node-content',
                    blockType: 'content',
                    type: 'content',
                    config: {},
                },
                {
                    id: 'node-video',
                    blockType: 'media-video',
                    type: 'media-video',
                    config: {
                        contentProfileId: 'longform.explainer.v1',
                        renderer: 'hyperframes',
                    },
                },
            ],
            proposedEdges: [],
            estimatedCost: {
                currency: 'USD',
                total: 5.2,
                breakdown: [
                    { blockType: 'content', amount: 0.1 },
                    { blockType: 'hyperframes-compose', amount: 2.7 },
                    { blockType: 'hyperframes-render', amount: 2.4 },
                ],
            },
            metadata: {
                contentProfile: {
                    contentProfileId: 'longform.explainer.v1',
                    scriptToneId: 'calm-explainer',
                    scriptToneIntensity: 'medium',
                    reviewMode: 'script-first',
                },
            },
            approvalRequired: true,
            createdAt: '2026-05-11T00:00:00.000Z',
            updatedAt: '2026-05-11T00:00:00.000Z',
        };

        getProposal.mockResolvedValue(proposal);
        getFlow.mockResolvedValue({
            id: 'flow-4',
            name: 'Flow',
            state: 'DRAFT',
            nodes: [],
            edges: [],
            createdAt: '2026-05-11T00:00:00.000Z',
            updatedAt: '2026-05-11T00:00:00.000Z',
        });

        const result = await proposalService.approve('proposal-4');

        expect(result.ok).toBe(true);
        const savedFlow = putFlow.mock.calls[0]?.[0];
        expect(savedFlow?.nodes).toEqual([
            expect.objectContaining({
                id: 'node-content',
                config: expect.not.objectContaining({
                    longformHtmlRenderEstimatedCostUsd: expect.any(Number),
                }),
            }),
            expect.objectContaining({
                id: 'node-video',
                config: expect.objectContaining({
                    renderer: 'hyperframes',
                    htmlComposeEstimatedCostUsd: 2.7,
                    hyperframesRenderEstimatedCostUsd: 2.4,
                    longformHtmlRenderEstimatedCostUsd: 5.1,
                }),
            }),
        ]);
    });

    it('copies longform render cost breakdown into a longform-render node config', async () => {
        const proposal: Proposal = {
            proposalId: 'proposal-5',
            flowId: 'flow-5',
            sourceMessageId: 'message-5',
            status: 'PENDING',
            proposedNodes: [
                {
                    id: 'node-render',
                    blockType: 'longform-render',
                    type: 'longform-render',
                    config: {
                        rendererRoute: 'hyperframes',
                    },
                },
            ],
            proposedEdges: [],
            estimatedCost: {
                currency: 'USD',
                total: 4.2,
                breakdown: [
                    { blockType: 'hyperframes-compose', amount: 2.1 },
                    { blockType: 'hyperframes-render', amount: 1.8 },
                ],
            },
            metadata: {
                contentProfile: {
                    contentProfileId: 'longform.explainer.v1',
                    scriptToneId: 'calm-explainer',
                    scriptToneIntensity: 'medium',
                    reviewMode: 'script-first',
                },
            },
            approvalRequired: true,
            createdAt: '2026-05-11T00:00:00.000Z',
            updatedAt: '2026-05-11T00:00:00.000Z',
        };

        getProposal.mockResolvedValue(proposal);
        getFlow.mockResolvedValue({
            id: 'flow-5',
            name: 'Flow',
            state: 'DRAFT',
            nodes: [],
            edges: [],
            createdAt: '2026-05-11T00:00:00.000Z',
            updatedAt: '2026-05-11T00:00:00.000Z',
        });

        const result = await proposalService.approve('proposal-5');

        expect(result.ok).toBe(true);
        const savedFlow = putFlow.mock.calls[0]?.[0];
        expect(savedFlow?.nodes).toEqual([
            expect.objectContaining({
                id: 'node-render',
                config: expect.objectContaining({
                    rendererRoute: 'hyperframes',
                    htmlComposeEstimatedCostUsd: 2.1,
                    hyperframesRenderEstimatedCostUsd: 1.8,
                    longformHtmlRenderEstimatedCostUsd: 3.9,
                }),
            }),
        ]);
    });
});
