import { beforeEach, describe, expect, it, vi } from 'vitest';

import { main } from './start-run';
import { runService } from '../../../services/run-service';

import type { APIGatewayProxyEvent } from 'aws-lambda';

vi.mock('../../../services/run-service', () => ({
    runService: {
        createRun: vi.fn(),
    },
}));

const createRun = vi.mocked(runService.createRun);

describe('start run handler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.STAGE = 'local';
        delete process.env.APP_API_KEY;
    });

    it('returns the longform HTML render cost cap error instead of reporting missing API keys', async () => {
        createRun.mockResolvedValueOnce({
            ok: false,
            error: 'LONGFORM_HTML_RENDER_COST_LIMIT_EXCEEDED',
            status: 422,
            estimatedCostUsd: 5.05,
            maxCostUsd: 5,
        });

        const response = await main({
            httpMethod: 'POST',
            path: '/flows/flow-1/runs',
            headers: {},
            pathParameters: { flowId: 'flow-1' },
            body: JSON.stringify({ triggerSource: 'MANUAL' }),
        } as APIGatewayProxyEvent);

        expect(response.statusCode).toBe(422);
        expect(JSON.parse(response.body)).toEqual(
            expect.objectContaining({
                error: 'LONGFORM_HTML_RENDER_COST_LIMIT_EXCEEDED',
                estimatedCostUsd: 5.05,
                maxCostUsd: 5,
            })
        );
    });

    it('returns conflict when longform Gate B execution has not been approved', async () => {
        createRun.mockResolvedValueOnce({
            ok: false,
            error: 'LONGFORM_GATE_B_APPROVAL_REQUIRED',
            status: 409,
        });

        const response = await main({
            httpMethod: 'POST',
            path: '/flows/flow-1/runs',
            headers: {},
            pathParameters: { flowId: 'flow-1' },
            body: JSON.stringify({ triggerSource: 'MANUAL', executionMode: 'full' }),
        } as APIGatewayProxyEvent);

        expect(response.statusCode).toBe(409);
        expect(JSON.parse(response.body)).toEqual(
            expect.objectContaining({
                error: 'CONFLICT',
                message: 'LONGFORM_GATE_B_APPROVAL_REQUIRED',
            })
        );
    });
});
