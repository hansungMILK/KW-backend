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
});
