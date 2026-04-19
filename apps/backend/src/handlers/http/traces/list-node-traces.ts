import { z } from 'zod';

import { traceRepo } from '../../../repositories/trace-repository';
import { getPathParam, getQueryParam, withMiddleware } from '../../../utils/middleware';
import { badRequest, ok } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const ParamsSchema = z.object({
    runId: z.string().min(1),
    nodeId: z.string().min(1),
});

const QuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().optional(),
});

/**
 * GET /runs/{runId}/nodes/{nodeId}/traces
 *
 * Per-node execution traces (F-21). Queries the sparse GSI on TracesTable
 * keyed by runNodeKey = `${runId}#${nodeId}`.
 */
const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const paramsParsed = ParamsSchema.safeParse({
        runId: getPathParam(event, 'runId'),
        nodeId: getPathParam(event, 'nodeId'),
    });
    if (!paramsParsed.success) return badRequest('runId and nodeId are required');

    const queryParsed = QuerySchema.safeParse({
        limit: getQueryParam(event, 'limit'),
        cursor: getQueryParam(event, 'cursor'),
    });
    if (!queryParsed.success) return badRequest('Invalid query parameters');

    const { runId, nodeId } = paramsParsed.data;
    const { limit, cursor } = queryParsed.data;

    const result = await traceRepo.listByRunNode(runId, nodeId, limit, cursor);

    return ok({ items: result.items, nextCursor: result.nextCursor });
};

export const main = withMiddleware(handler);
