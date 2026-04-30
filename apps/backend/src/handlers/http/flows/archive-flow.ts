import { flowRepo } from '../../../repositories/flow-repository';
import { getPathParam, withMiddleware } from '../../../utils/middleware';
import { badRequest, conflict, notFound, ok } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * POST /flows/{flowId}/archive  (audit #9, F-31)
 * READY → ARCHIVED. 409 if not in READY (DRAFT must reach READY first;
 * ARCHIVED is already archived).
 */
const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const flowId = getPathParam(event, 'flowId');
    if (!flowId) return badRequest('Missing flowId');

    const result = await flowRepo.archive(flowId);
    if (!result.ok) {
        if (result.code === 'NOT_FOUND') return notFound(`Flow ${flowId} not found`);
        if (result.current === 'ARCHIVED') {
            return conflict(`Flow ${flowId} is already archived`, 'ALREADY_ARCHIVED');
        }
        return conflict(
            `Flow ${flowId} cannot be archived from state ${result.current} (must be READY)`,
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
