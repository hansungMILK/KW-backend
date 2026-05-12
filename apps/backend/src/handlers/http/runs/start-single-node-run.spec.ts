import { beforeEach, describe, expect, it, vi } from 'vitest';

import { main } from './start-single-node-run';
import { runService } from '../../../services/run-service';

import type { APIGatewayProxyEvent } from 'aws-lambda';

vi.mock('../../../services/run-service', () => ({
    runService: {
        createSingleNodeRun: vi.fn(),
    },
}));

const createSingleNodeRun = vi.mocked(runService.createSingleNodeRun);

describe('start single-node run handler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.STAGE = 'local';
        delete process.env.APP_API_KEY;
    });

    it('returns the longform HTML render cost cap error instead of reporting missing API keys', async () => {
        createSingleNodeRun.mockResolvedValueOnce({
            ok: false,
            error: 'LONGFORM_HTML_RENDER_COST_LIMIT_EXCEEDED',
            status: 422,
            estimatedCostUsd: 5.01,
            maxCostUsd: 5,
        });

        const response = await main({
            httpMethod: 'POST',
            path: '/flows/flow-1/nodes/node-render/runs',
            headers: {},
            pathParameters: { flowId: 'flow-1', nodeId: 'node-render' },
            body: JSON.stringify({ triggerSource: 'MANUAL' }),
        } as APIGatewayProxyEvent);

        expect(response.statusCode).toBe(422);
        expect(JSON.parse(response.body)).toEqual(
            expect.objectContaining({
                error: 'LONGFORM_HTML_RENDER_COST_LIMIT_EXCEEDED',
                estimatedCostUsd: 5.01,
                maxCostUsd: 5,
            })
        );
    });
});
