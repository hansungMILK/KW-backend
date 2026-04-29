import { FlowPutRequestSchema } from '@flows/contracts';

import { flowRepo } from '../../../repositories/flow-repository';
import { getBody, getPathParam, withMiddleware } from '../../../utils/middleware';
import { badRequest, notFound, ok } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * PUT /flows/{flowId}  (spec, audit F-05) — unified canvas save.
 * Body: { title?, description?, nodes, edges }
 *
 * Replaces the legacy save / upsert / meta-update trio. Auto status transition
 * (DRAFT → READY when nodes.length >= 1) is handled by flowRepo.updateCanvas.
 */
const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const flowId = getPathParam(event, 'flowId');
    if (!flowId) return badRequest('Missing flowId');

    const body = getBody(event);
    const parsed = FlowPutRequestSchema.safeParse(body);
    if (!parsed.success) return badRequest(`Invalid body: ${parsed.error.message}`);

    const flow = await flowRepo.updateCanvas(flowId, parsed.data);
    if (!flow) return notFound(`Flow ${flowId} not found`);

    return ok({
        flowId: flow.id,
        title: flow.name,
        description: flow.description,
        status: flow.state,
        createdAt: flow.createdAt,
        updatedAt: flow.updatedAt,
        nodes: flow.nodes,
        edges: flow.edges,
        latestProposalId: null,
        lastRunId: null,
    });
};

export const main = withMiddleware(handler);
