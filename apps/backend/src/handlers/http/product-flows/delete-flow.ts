import { ProductFlowDeleteParamsSchema } from '@flows/contracts';

import { flowRepo } from '../../../repositories/flow-repository';
import { messageRepo } from '../../../repositories/message-repository';
import { proposalRepo } from '../../../repositories/proposal-repository';
import { getPathParam, withMiddleware } from '../../../utils/middleware';
import { badRequest, notFound, ok } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * DELETE /flows/{flowId}
 *
 * Product API — delete flow + messages + proposals.
 * Runs/traces/assets are preserved.
 */
const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const flowId = getPathParam(event, 'flowId');
    const parsed = ProductFlowDeleteParamsSchema.safeParse({ flowId });
    if (!parsed.success) return badRequest('flowId is required');

    const deleted = await flowRepo.delete(parsed.data.flowId);
    if (!deleted) return notFound(`Flow ${flowId} not found`, 'FLOW_NOT_FOUND');

    // Cascade delete messages and proposals
    await messageRepo.deleteByFlow(parsed.data.flowId);
    await proposalRepo.deleteByFlow(parsed.data.flowId);

    return ok({
        deleted: true,
        flowId: parsed.data.flowId,
    });
};

export const main = withMiddleware(handler);
