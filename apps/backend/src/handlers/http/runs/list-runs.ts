import { RunListParamsSchema } from '@flows/contracts';

import { runRepo } from '../../../repositories/run-repository';
import { getPathParam, getQueryParam, withMiddleware } from '../../../utils/middleware';
import { badRequest, ok } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * GET /flows/{flowId}/runs?limit=20&cursor=
 */
const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const flowId = getPathParam(event, 'flowId');
    const paramsParsed = RunListParamsSchema.safeParse({ flowId });
    if (!paramsParsed.success) return badRequest('flowId is required');

    const limitStr = getQueryParam(event, 'limit');
    const cursor = getQueryParam(event, 'cursor');
    const limit = limitStr ? Math.min(Math.max(parseInt(limitStr, 10) || 20, 1), 100) : 20;

    const result = await runRepo.listByFlow(paramsParsed.data.flowId, limit, cursor ?? undefined);

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
