import { beforeEach, describe, expect, it, vi } from 'vitest';

import { main } from './retry-node';
import { runService } from '../../../services/run-service';

import type { APIGatewayProxyEvent } from 'aws-lambda';

vi.mock('../../../services/run-service', () => ({
    runService: {
        retryNode: vi.fn(),
    },
}));

const retryNode = vi.mocked(runService.retryNode);

describe('retry node handler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.STAGE = 'local';
        delete process.env.APP_API_KEY;
    });

    it('returns the longform HTML render cost cap error instead of a generic bad request', async () => {
        retryNode.mockResolvedValueOnce({
            ok: false,
            error: 'LONGFORM_HTML_RENDER_COST_LIMIT_EXCEEDED',
            status: 422,
            estimatedCostUsd: 5.25,
            maxCostUsd: 5,
        });

        const response = await main({
            httpMethod: 'POST',
            path: '/runs/run-1/nodes/node-render/retry',
            headers: {},
            pathParameters: { runId: 'run-1', nodeId: 'node-render' },
            body: JSON.stringify({ reason: 'retry after fix' }),
        } as APIGatewayProxyEvent);

        expect(response.statusCode).toBe(422);
        expect(JSON.parse(response.body)).toEqual(
            expect.objectContaining({
                error: 'LONGFORM_HTML_RENDER_COST_LIMIT_EXCEEDED',
                estimatedCostUsd: 5.25,
                maxCostUsd: 5,
            })
        );
    });
});
