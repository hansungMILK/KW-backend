import { beforeEach, describe, expect, it, vi } from 'vitest';

import { main } from './approve-proposal';
import { proposalService } from '../../../services/proposal-service';

import type { APIGatewayProxyEvent } from 'aws-lambda';

vi.mock('../../../services/proposal-service', () => ({
    proposalService: {
        approve: vi.fn(),
    },
}));

const approveProposal = vi.mocked(proposalService.approve);

describe('approve proposal handler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.STAGE = 'local';
        delete process.env.APP_API_KEY;
    });

    it('rejects invalid image style or quality instead of silently approving without overrides', async () => {
        const response = await main({
            httpMethod: 'POST',
            path: '/proposals/proposal-1/approve',
            headers: {},
            pathParameters: { proposalId: 'proposal-1' },
            body: JSON.stringify({
                imageStyleId: 'animation',
                imageQuality: 'ultra',
            }),
        } as APIGatewayProxyEvent);

        expect(response.statusCode).toBe(400);
        expect(JSON.parse(response.body)).toEqual(
            expect.objectContaining({
                error: 'BAD_REQUEST',
            })
        );
        expect(approveProposal).not.toHaveBeenCalled();
    });

    it('passes selected content profile preferences to the approval service', async () => {
        approveProposal.mockResolvedValue({
            ok: true,
            data: {
                proposal: {
                    proposalId: 'proposal-1',
                    flowId: 'flow-1',
                    sourceMessageId: 'message-1',
                    status: 'APPROVED',
                    proposedNodes: [],
                    proposedEdges: [],
                    approvalRequired: true,
                    createdAt: '2026-05-11T00:00:00.000Z',
                    updatedAt: '2026-05-11T00:00:00.000Z',
                },
                flow: {
                    id: 'flow-1',
                    name: 'Flow',
                    state: 'READY',
                    nodes: [],
                    edges: [],
                    createdAt: '2026-05-11T00:00:00.000Z',
                    updatedAt: '2026-05-11T00:00:00.000Z',
                },
            },
        });

        const response = await main({
            httpMethod: 'POST',
            path: '/proposals/proposal-1/approve',
            headers: {},
            pathParameters: { proposalId: 'proposal-1' },
            body: JSON.stringify({
                scriptToneId: 'news-anchor',
                scriptToneIntensity: 'high',
                contentProfileId: 'shorts.info.v1',
                reviewMode: 'script-first',
            }),
        } as APIGatewayProxyEvent);

        expect(response.statusCode).toBe(200);
        expect(approveProposal).toHaveBeenCalledWith('proposal-1', undefined, 'vertical', {
            imageStyleId: undefined,
            imageQuality: undefined,
            sceneCount: undefined,
            scriptToneId: 'news-anchor',
            scriptToneIntensity: 'high',
            contentProfileId: 'shorts.info.v1',
            reviewMode: 'script-first',
        });
    });
});
