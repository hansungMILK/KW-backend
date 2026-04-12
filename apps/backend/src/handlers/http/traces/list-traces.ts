import { TraceListParamsSchema } from '@flows/contracts';

import { traceRepo } from '../../../repositories/trace-repository';
import { getPathParam, getQueryParam, withMiddleware } from '../../../utils/middleware';
import { badRequest, ok } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * GET /runs/{runId}/traces?limit=100&cursor=
 *
 * Returns all trace records for the given run, ordered by occurredAt ascending.
 * Supports cursor pagination.
 */
const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const runId = getPathParam(event, 'runId');
    const paramsParsed = TraceListParamsSchema.safeParse({ runId });
    if (!paramsParsed.success) return badRequest('runId is required');

    const limit = Number(getQueryParam(event, 'limit') || '100');
    const cursor = getQueryParam(event, 'cursor');

    const result = await traceRepo.listByRun(paramsParsed.data.runId, limit, cursor);

    return ok({
        items: result.items,
        nextCursor: result.nextCursor,
    });
};

export const main = withMiddleware(handler);
