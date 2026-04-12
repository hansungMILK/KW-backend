import { ProductFlowGetParamsSchema } from '@flows/contracts';

import { flowRepo } from '../../../repositories/flow-repository';
import { proposalRepo } from '../../../repositories/proposal-repository';
import { runRepo } from '../../../repositories/run-repository';
import { getPathParam, withMiddleware } from '../../../utils/middleware';
import { badRequest, notFound, ok } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * GET /flows/{flowId}
 *
 * Product API — get full flow detail with nodes/edges.
 * Reuses flowRepo.get() (same as compat load-flow).
 */
const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const flowId = getPathParam(event, 'flowId');
    const parsed = ProductFlowGetParamsSchema.safeParse({ flowId });
    if (!parsed.success) return badRequest('flowId is required');

    const flow = await flowRepo.get(parsed.data.flowId);
    if (!flow) return notFound(`Flow ${flowId} not found`, 'FLOW_NOT_FOUND');

    // Get latest proposal and run for enrichment
    const proposals = await proposalRepo.listByFlow(flow.id);
    const latestProposal = proposals.length > 0 ? proposals[proposals.length - 1] : null;

    const runsResult = await runRepo.listByFlow(flow.id, 1);
    const lastRun = runsResult.items.length > 0 ? runsResult.items[0] : null;

    return ok({
        flowId: flow.id,
        title: flow.name ?? 'Untitled Flow',
        description: flow.description ?? null,
        status: flow.state ?? 'DRAFT',
        latestProposalId: latestProposal?.proposalId ?? null,
        nodes: flow.nodes,
        edges: flow.edges,
        lastRunId: lastRun?.runId ?? null,
        createdAt: flow.createdAt,
        updatedAt: flow.updatedAt,
    });
};

export const main = withMiddleware(handler);
