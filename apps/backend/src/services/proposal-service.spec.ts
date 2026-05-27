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

    it('saves approved proposals in a horizontal DAG layout by default', async () => {
        const proposal: Proposal = {
            proposalId: 'proposal-layout',
            flowId: 'flow-layout',
            sourceMessageId: 'message-layout',
            status: 'PENDING',
            proposedNodes: [
                { id: 'search', blockType: 'search', type: 'search', config: {} },
                { id: 'script', blockType: 'content', type: 'content', config: {} },
                { id: 'image', blockType: 'media-image', type: 'media-image', config: {} },
                { id: 'tts', blockType: 'media-tts', type: 'media-tts', config: {} },
                { id: 'video', blockType: 'media-video', type: 'media-video', config: {} },
            ],
            proposedEdges: [
                { sourceNodeId: 'search', targetNodeId: 'script' },
                { sourceNodeId: 'script', targetNodeId: 'image' },
                { sourceNodeId: 'script', targetNodeId: 'tts' },
                { sourceNodeId: 'image', targetNodeId: 'video' },
                { sourceNodeId: 'tts', targetNodeId: 'video' },
            ],
            approvalRequired: true,
            createdAt: '2026-05-11T00:00:00.000Z',
            updatedAt: '2026-05-11T00:00:00.000Z',
        };

        getProposal.mockResolvedValue(proposal);
        getFlow.mockResolvedValue({
            id: 'flow-layout',
            name: 'Flow',
            state: 'DRAFT',
            nodes: [],
            edges: [],
            createdAt: '2026-05-11T00:00:00.000Z',
            updatedAt: '2026-05-11T00:00:00.000Z',
        });

        const result = await proposalService.approve('proposal-layout');

        expect(result.ok).toBe(true);
        const savedNodes = putFlow.mock.calls[0]?.[0]?.nodes as Array<{
            id: string;
            position: { x: number; y: number };
            width?: number;
            height?: number;
        }>;
        const byId = new Map(savedNodes.map(node => [node.id, node]));

        expect(byId.get('search')?.position.x).toBeLessThan(byId.get('script')?.position.x ?? 0);
        expect(byId.get('script')?.position.x).toBeLessThan(byId.get('image')?.position.x ?? 0);
        expect(byId.get('image')?.position.x).toBe(byId.get('tts')?.position.x);
        expect(byId.get('image')?.position.y).not.toBe(byId.get('tts')?.position.y);
        expect(byId.get('video')?.position.x).toBeGreaterThan(byId.get('image')?.position.x ?? 0);
        expect(byId.get('image')).toEqual(expect.objectContaining({ width: 340, height: 320 }));
        expect(byId.get('video')).toEqual(expect.objectContaining({ width: 360, height: 440 }));
    });

    it('appends a second approved proposal without replacing the existing workflow', async () => {
        const proposal: Proposal = {
            proposalId: 'proposal-next',
            flowId: 'flow-multi',
            sourceMessageId: 'message-next',
            status: 'PENDING',
            proposedNodes: [
                { id: 'search', blockType: 'search', type: 'search', config: {} },
                { id: 'script', blockType: 'longform-script', type: 'longform-script', config: {} },
            ],
            proposedEdges: [{ id: 'edge-search-script', sourceNodeId: 'search', targetNodeId: 'script' }],
            approvalRequired: true,
            createdAt: '2026-05-11T00:00:00.000Z',
            updatedAt: '2026-05-11T00:00:00.000Z',
        };

        getProposal.mockResolvedValue(proposal);
        getFlow.mockResolvedValue({
            id: 'flow-multi',
            name: 'Flow',
            state: 'READY',
            nodes: [
                {
                    id: 'search',
                    blockType: 'search',
                    type: 'search',
                    config: {},
                    position: { x: 100, y: 220 },
                },
                {
                    id: 'script',
                    blockType: 'content',
                    type: 'content',
                    config: {},
                    position: { x: 440, y: 220 },
                },
            ],
            edges: [{ id: 'edge-search-script', sourceNodeId: 'search', targetNodeId: 'script' }],
            createdAt: '2026-05-11T00:00:00.000Z',
            updatedAt: '2026-05-11T00:00:00.000Z',
        });

        const result = await proposalService.approve('proposal-next');

        expect(result.ok).toBe(true);
        const savedFlow = putFlow.mock.calls[0]?.[0];
        const savedNodes = savedFlow?.nodes as Array<{
            id: string;
            position?: { x: number; y: number };
            workflowGroupId?: string;
        }>;
        const savedEdges = savedFlow?.edges as Array<Record<string, unknown>>;
        const appendedSearch = savedNodes.find(node => node.id.endsWith('__search') && node.id !== 'search');
        const appendedScript = savedNodes.find(node => node.id.endsWith('__script') && node.id !== 'script');

        expect(savedNodes.map(node => node.id)).toEqual(
            expect.arrayContaining([
                'search',
                'script',
                expect.stringMatching(/__search$/),
                expect.stringMatching(/__script$/),
            ])
        );
        expect(appendedSearch?.id).not.toBe('search');
        expect(appendedScript?.id).not.toBe('script');
        expect(appendedSearch?.position?.y).toBeGreaterThan(220);
        expect(appendedSearch?.workflowGroupId).toBe('proposal-next');
        expect(appendedScript?.workflowGroupId).toBe('proposal-next');
        expect(savedEdges).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ sourceNodeId: 'search', targetNodeId: 'script' }),
                expect.objectContaining({
                    id: expect.stringMatching(/^proposal-next__edge-search-script/),
                    sourceNodeId: appendedSearch?.id,
                    targetNodeId: appendedScript?.id,
                    workflowGroupId: 'proposal-next',
                }),
            ])
        );
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

    it('keeps countryball scene count AI-driven unless the user explicitly overrides it', async () => {
        const proposal: Proposal = {
            proposalId: 'proposal-countryball',
            flowId: 'flow-countryball',
            sourceMessageId: 'message-countryball',
            status: 'PENDING',
            proposedNodes: [
                {
                    id: 'node-script',
                    blockType: 'countryball-script',
                    type: 'countryball-script',
                    config: {
                        topic: '컨트리볼 쇼츠',
                    },
                },
                {
                    id: 'node-image',
                    blockType: 'countryball-image',
                    type: 'countryball-image',
                    config: {
                        imageStyleId: 'countryball-comic',
                        imageQuality: 'medium',
                    },
                },
            ],
            proposedEdges: [],
            estimatedCost: {
                currency: 'USD',
                total: 0.652,
                breakdown: [
                    { blockType: 'countryball-script', amount: 0.16 },
                    { blockType: 'countryball-image', amount: 0.492 },
                ],
            },
            metadata: {
                contentProfile: {
                    contentProfileId: 'shorts.countryball.v1',
                    reviewMode: 'direct-run',
                },
                imageGeneration: {
                    model: 'gpt-image-2',
                    imageStyleId: 'countryball-comic',
                    imageStyleLabel: '컨트리볼 만화',
                    imageQuality: 'medium',
                    sceneCount: 12,
                    sceneCountSelectionMode: 'ai-recommended',
                    imageEstimatedCostUsd: 0.492,
                    textAndOtherEstimatedCostUsd: 0.16,
                    estimatedTotalCostUsd: 0.652,
                },
            },
            approvalRequired: true,
            createdAt: '2026-05-11T00:00:00.000Z',
            updatedAt: '2026-05-11T00:00:00.000Z',
        };

        getProposal.mockResolvedValue(proposal);
        getFlow.mockResolvedValue({
            id: 'flow-countryball',
            name: 'Flow',
            state: 'DRAFT',
            nodes: [],
            edges: [],
            createdAt: '2026-05-11T00:00:00.000Z',
            updatedAt: '2026-05-11T00:00:00.000Z',
        });

        const result = await proposalService.approve('proposal-countryball', undefined, undefined, {
            contentProfileId: 'shorts.countryball.v1',
            imageStyleId: 'countryball-comic',
            imageQuality: 'medium',
        });

        expect(result.ok).toBe(true);
        const savedFlow = putFlow.mock.calls[0]?.[0];
        expect(savedFlow?.nodes).toEqual([
            expect.objectContaining({
                id: 'node-script',
                config: expect.not.objectContaining({
                    scenes: expect.anything(),
                    count: expect.anything(),
                }),
            }),
            expect.objectContaining({
                id: 'node-image',
                config: expect.not.objectContaining({
                    count: expect.anything(),
                    scenes: expect.anything(),
                }),
            }),
        ]);
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

    it('treats an approved longform direct-run proposal as Gate B approval for the generated Gate A artifact', async () => {
        const proposal: Proposal = {
            proposalId: 'proposal-longform-direct',
            flowId: 'flow-longform-direct',
            sourceMessageId: 'message-longform-direct',
            status: 'PENDING',
            proposedNodes: [
                {
                    id: 'node-script',
                    blockType: 'longform-script',
                    type: 'longform-script',
                    config: {
                        mode: 'longform-gate-a',
                        mediaExecutionAllowed: false,
                    },
                },
                {
                    id: 'node-review',
                    blockType: 'longform-review',
                    type: 'longform-review',
                    config: {
                        mode: 'longform-gate-a',
                        mediaExecutionAllowed: false,
                    },
                },
                {
                    id: 'node-render',
                    blockType: 'longform-render',
                    type: 'longform-render',
                    config: {
                        mode: 'longform-gate-b',
                        mediaExecutionAllowed: false,
                    },
                },
            ],
            proposedEdges: [],
            metadata: {
                contentProfile: {
                    contentProfileId: 'longform.explainer.v1',
                    scriptToneId: 'calm-explainer',
                    scriptToneIntensity: 'medium',
                    reviewMode: 'direct-run',
                },
            },
            approvalRequired: true,
            createdAt: '2026-05-11T00:00:00.000Z',
            updatedAt: '2026-05-11T00:00:00.000Z',
        };

        getProposal.mockResolvedValue(proposal);
        getFlow.mockResolvedValue({
            id: 'flow-longform-direct',
            name: 'Flow',
            state: 'DRAFT',
            nodes: [],
            edges: [],
            createdAt: '2026-05-11T00:00:00.000Z',
            updatedAt: '2026-05-11T00:00:00.000Z',
        });

        const result = await proposalService.approve('proposal-longform-direct', undefined, undefined, {
            reviewMode: 'direct-run',
        });

        expect(result.ok).toBe(true);
        const savedFlow = putFlow.mock.calls[0]?.[0];
        expect(savedFlow?.nodes).toEqual([
            expect.objectContaining({
                id: 'node-script',
                config: expect.objectContaining({
                    reviewMode: 'direct-run',
                    reviewStatus: 'approved',
                    mediaExecutionAllowed: true,
                    gateBApproved: true,
                    approvedArtifactId: 'proposal-proposal-longform-direct-direct-run',
                }),
            }),
            expect.objectContaining({
                id: 'node-review',
                config: expect.objectContaining({
                    reviewMode: 'direct-run',
                    reviewStatus: 'approved',
                    mediaExecutionAllowed: true,
                    gateBApproved: true,
                    approvedArtifactId: 'proposal-proposal-longform-direct-direct-run',
                }),
            }),
            expect.objectContaining({
                id: 'node-render',
                config: expect.objectContaining({
                    reviewMode: 'direct-run',
                    mediaExecutionAllowed: false,
                }),
            }),
        ]);
        expect((savedFlow?.nodes?.[2] as { config?: Record<string, unknown> } | undefined)?.config).not.toHaveProperty(
            'gateBApproved'
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
