import { flowRepo } from '../../../repositories/flow-repository';
import { getPathParam, withMiddleware } from '../../../utils/middleware';
import { badRequest, created, notFound } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * POST /flows/{flowId}/duplicate  (audit #8, F-19)
 * Creates a new flow as DRAFT with the same nodes/edges. 201.
 */
const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const flowId = getPathParam(event, 'flowId');
    if (!flowId) return badRequest('Missing flowId');

    const copy = await flowRepo.duplicate(flowId);
    if (!copy) return notFound(`Flow ${flowId} not found`);

    return created({
        flowId: copy.id,
        title: copy.name ?? '',
        description: copy.description,
        status: copy.state,
        createdAt: copy.createdAt,
        updatedAt: copy.updatedAt,
    });
};

export const main = withMiddleware(handler);
