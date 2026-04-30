import { flowRepo } from '../../../repositories/flow-repository';
import { getPathParam, withMiddleware } from '../../../utils/middleware';
import { badRequest, notFound, ok } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * DELETE /flows/{flowId}  (audit #7, F-18)
 * Cascade: Messages + Proposals are deleted; Runs + Assets are preserved.
 */
const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const flowId = getPathParam(event, 'flowId');
    if (!flowId) return badRequest('Missing flowId');

    const result = await flowRepo.deleteWithCascade(flowId);
    if (!result.deleted) return notFound(`Flow ${flowId} not found`);

    return ok({
        deleted: true,
        messagesDeleted: result.messagesDeleted,
        proposalsDeleted: result.proposalsDeleted,
    });
};

export const main = withMiddleware(handler);
