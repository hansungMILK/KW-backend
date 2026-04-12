import { runRepo } from '../../../repositories/run-repository';
import { getQueryParam, withMiddleware } from '../../../utils/middleware';
import { ok } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * GET /runs?flowId=&status=&limit=20&cursor=
 */
const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const flowId = getQueryParam(event, 'flowId');
    const status = getQueryParam(event, 'status');
    const limitStr = getQueryParam(event, 'limit');
    const cursor = getQueryParam(event, 'cursor');
    const limit = limitStr ? Math.min(Math.max(parseInt(limitStr, 10) || 20, 1), 100) : 20;

    const result = await runRepo.scanAll(
        { flowId: flowId ?? undefined, status: status ?? undefined },
        limit,
        cursor ?? undefined
    );

    return ok({
        items: result.items.map(r => ({
            runId: r.runId,
            flowId: r.flowId,
            runType: r.runType,
            status: r.status,
            startedAt: r.startedAt ?? null,
            completedAt: r.completedAt ?? null,
            createdAt: r.createdAt,
        })),
        nextCursor: result.nextCursor,
    });
};

export const main = withMiddleware(handler);
