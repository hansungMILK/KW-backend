import { flowRepo } from '../../../repositories/flow-repository';
import { getPathParam, withMiddleware } from '../../../utils/middleware';
import { badRequest, notFound, ok } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * GET /flows/{flowId}  (spec, audit F-04)
 * Returns: FlowDetail (summary + nodes/edges + latestProposalId/lastRunId).
 *
 * latestProposalId/lastRunId join is owned by 강연경/민경욱 (audit row #5 비고).
 * P1 surfaces them as null; the join lands in P2 without changing this handler's response shape.
 */
const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const flowId = getPathParam(event, 'flowId');
    if (!flowId) return badRequest('Missing flowId');

    const flow = await flowRepo.get(flowId);
    if (!flow) return notFound(`Flow ${flowId} not found`);

    return ok({
        flowId: flow.id,
        title: flow.name,
        description: flow.description,
        status: flow.state,
        channelId: flow.id,
        createdAt: flow.createdAt,
        updatedAt: flow.updatedAt,
        nodes: flow.nodes,
        edges: flow.edges,
        latestProposalId: null,
        lastRunId: null,
    });
};

export const main = withMiddleware(handler);
