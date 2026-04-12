import { ProductFlowArchiveParamsSchema } from '@flows/contracts';

import { flowRepo } from '../../../repositories/flow-repository';
import { getPathParam, withMiddleware } from '../../../utils/middleware';
import { badRequest, conflict, notFound, ok } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * POST /flows/{flowId}/archive
 *
 * Product API — transition READY → ARCHIVED.
 */
const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const flowId = getPathParam(event, 'flowId');
    const parsed = ProductFlowArchiveParamsSchema.safeParse({ flowId });
    if (!parsed.success) return badRequest('flowId is required');

    const flow = await flowRepo.get(parsed.data.flowId);
    if (!flow) return notFound(`Flow ${flowId} not found`, 'FLOW_NOT_FOUND');

    if (flow.state === 'ARCHIVED') return conflict('Flow is already ARCHIVED');
    if (flow.state !== 'READY')
        {return conflict(`Cannot archive flow in ${flow.state} state. Only READY flows can be archived`);}

    const updated = await flowRepo.updateState(flow.id, 'ARCHIVED');

    return ok({
        flowId: flow.id,
        status: 'ARCHIVED',
        updatedAt: updated!.updatedAt,
    });
};

export const main = withMiddleware(handler);
