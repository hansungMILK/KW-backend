import { flowRepo } from '../../../repositories/flow-repository';
import { getPathParam, withMiddleware } from '../../../utils/middleware';
import { badRequest, conflict, notFound, ok } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * POST /flows/{flowId}/unarchive  (audit #10, F-35)
 * ARCHIVED → READY. 409 if not in ARCHIVED.
 */
const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const flowId = getPathParam(event, 'flowId');
    if (!flowId) return badRequest('Missing flowId');

    const result = await flowRepo.unarchive(flowId);
    if (!result.ok) {
        if (result.code === 'NOT_FOUND') return notFound(`Flow ${flowId} not found`);
        return conflict(
            `Flow ${flowId} cannot be unarchived from state ${result.current} (must be ARCHIVED)`,
            'INVALID_STATE_TRANSITION'
        );
    }

    return ok({
        flowId: result.flow.id,
        title: result.flow.name ?? '',
        description: result.flow.description,
        status: result.flow.state,
        createdAt: result.flow.createdAt,
        updatedAt: result.flow.updatedAt,
    });
};

export const main = withMiddleware(handler);
