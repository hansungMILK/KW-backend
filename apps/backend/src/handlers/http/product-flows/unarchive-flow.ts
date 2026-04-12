import { ProductFlowUnarchiveParamsSchema } from '@flows/contracts';

import { flowRepo } from '../../../repositories/flow-repository';
import { getPathParam, withMiddleware } from '../../../utils/middleware';
import { badRequest, conflict, notFound, ok } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * POST /flows/{flowId}/unarchive
 *
 * Product API — transition ARCHIVED → READY.
 */
const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const flowId = getPathParam(event, 'flowId');
    const parsed = ProductFlowUnarchiveParamsSchema.safeParse({ flowId });
    if (!parsed.success) return badRequest('flowId is required');

    const flow = await flowRepo.get(parsed.data.flowId);
    if (!flow) return notFound(`Flow ${flowId} not found`, 'FLOW_NOT_FOUND');

    if (flow.state !== 'ARCHIVED') return conflict(`Flow is not ARCHIVED (current: ${flow.state})`);

    const updated = await flowRepo.updateState(flow.id, 'READY');

    return ok({
        flowId: flow.id,
        status: 'READY',
        updatedAt: updated!.updatedAt,
    });
};

export const main = withMiddleware(handler);
