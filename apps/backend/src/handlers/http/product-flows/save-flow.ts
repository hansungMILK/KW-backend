import { ProductFlowSaveParamsSchema, ProductFlowSaveRequestSchema } from '@flows/contracts';

import { flowRepo } from '../../../repositories/flow-repository';
import { getBody, getPathParam, withMiddleware } from '../../../utils/middleware';
import { badRequest, notFound, ok } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * PUT /flows/{flowId}
 *
 * Product API — save canvas state.
 * Reuses flowRepo.updateCanvas() which handles DRAFT→READY auto-transition.
 */
const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const flowId = getPathParam(event, 'flowId');
    const parsed = ProductFlowSaveParamsSchema.safeParse({ flowId });
    if (!parsed.success) return badRequest('flowId is required');

    const body = getBody(event);
    const bodyParsed = ProductFlowSaveRequestSchema.safeParse(body);
    if (!bodyParsed.success) return badRequest(`Invalid body: ${bodyParsed.error.message}`);

    const flow = await flowRepo.updateCanvas(parsed.data.flowId, {
        title: bodyParsed.data.title,
        description: bodyParsed.data.description,
        nodes: bodyParsed.data.nodes,
        edges: bodyParsed.data.edges,
    });

    if (!flow) return notFound(`Flow ${flowId} not found`, 'FLOW_NOT_FOUND');

    return ok({
        flowId: flow.id,
        updatedAt: flow.updatedAt,
    });
};

export const main = withMiddleware(handler);
