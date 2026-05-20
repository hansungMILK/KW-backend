import { beforeEach, describe, expect, it, vi } from 'vitest';

import { main } from './recover-node';
import { runService } from '../../../services/run-service';

import type { APIGatewayProxyEvent } from 'aws-lambda';

vi.mock('../../../services/run-service', () => ({
    runService: {
        recoverAnalysisNode: vi.fn(),
    },
}));

const recoverAnalysisNode = vi.mocked(runService.recoverAnalysisNode);

describe('recover node handler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.STAGE = 'local';
        delete process.env.APP_API_KEY;
    });

    it('accepts analysis recovery requests', async () => {
        recoverAnalysisNode.mockResolvedValueOnce({ ok: true, repairedSourceNodeId: 'node-content' });

        const response = await main({
            httpMethod: 'POST',
            path: '/runs/run-1/nodes/node-analysis/recover',
            headers: {},
            pathParameters: { runId: 'run-1', nodeId: 'node-analysis' },
            body: JSON.stringify({ reason: 'apply review feedback' }),
        } as APIGatewayProxyEvent);

        expect(response.statusCode).toBe(200);
        expect(recoverAnalysisNode).toHaveBeenCalledWith('run-1', 'node-analysis', 'apply review feedback');
        expect(JSON.parse(response.body)).toEqual({
            runId: 'run-1',
            nodeId: 'node-analysis',
            recoveryAccepted: true,
            repairedSourceNodeId: 'node-content',
        });
    });
});
