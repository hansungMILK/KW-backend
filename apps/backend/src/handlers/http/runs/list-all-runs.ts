import { RunListAllQuerySchema } from '@flows/contracts';

import { runRepo } from '../../../repositories/run-repository';
import { getQueryParam, withMiddleware } from '../../../utils/middleware';
import { badRequest, ok } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * GET /runs?limit=20&cursor=&flowId=&status=
 *
 * Cross-flow execution history (F-13). Includes runs whose parent flow has been
 * deleted — this is the preservation path for run history independent of flow lifecycle.
 */
const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const parsed = RunListAllQuerySchema.safeParse({
        limit: getQueryParam(event, 'limit'),
        cursor: getQueryParam(event, 'cursor'),
        flowId: getQueryParam(event, 'flowId'),
        status: getQueryParam(event, 'status'),
    });
    if (!parsed.success) return badRequest('Invalid query parameters');

    const { limit, cursor, flowId, status } = parsed.data;

    const result = await runRepo.scanAll({ flowId, status }, limit, cursor);

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
