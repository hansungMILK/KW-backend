import { TraceListByNodeParamsSchema } from '@flows/contracts';

import { traceRepo } from '../../../repositories/trace-repository';
import { getPathParam, getQueryParam, withMiddleware } from '../../../utils/middleware';
import { badRequest, ok } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * GET /runs/{runId}/nodes/{nodeId}/traces?limit=50&cursor=
 *
 * Product API — list traces for a specific node within a run.
 * Supports cursor pagination.
 */
const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const runId = getPathParam(event, 'runId');
    const nodeId = getPathParam(event, 'nodeId');

    const parsed = TraceListByNodeParamsSchema.safeParse({ runId, nodeId });
    if (!parsed.success) return badRequest('runId and nodeId are required');

    const limit = Number(getQueryParam(event, 'limit') || '50');
    const cursor = getQueryParam(event, 'cursor');

    const result = await traceRepo.listByRunNode(parsed.data.runId, parsed.data.nodeId, limit, cursor);

    return ok({
        items: result.items,
        nextCursor: result.nextCursor,
    });
};

export const main = withMiddleware(handler);
