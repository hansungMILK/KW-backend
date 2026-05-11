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
        });

        expect(result.ok).toBe(true);
        expect(putFlow).toHaveBeenCalledOnce();
        const savedFlow = putFlow.mock.calls[0]?.[0];
        expect(savedFlow?.nodes).toEqual([
            expect.objectContaining({
                config: expect.objectContaining({
                    count: 12,
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
            total: 2.21,
            breakdown: [
                { blockType: 'content', amount: 0.03 },
                { blockType: 'media-image', amount: 1.98 },
                { blockType: 'media-video', amount: 0.2 },
            ],
        });
        expect(savedProposal?.metadata?.['imageGeneration']).toEqual(
            expect.objectContaining({
                model: 'gpt-image-2',
                imageStyleId: 'animation',
                imageStyleLabel: '애니메이션',
                imageQuality: 'high',
                sceneCount: 12,
                imageEstimatedCostUsd: 1.98,
                textAndOtherEstimatedCostUsd: 0.23,
                estimatedTotalCostUsd: 2.21,
            })
        );
        expect(putMessage).toHaveBeenCalledOnce();
    });
});
