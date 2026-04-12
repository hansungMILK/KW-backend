import { ProductFlowCreateRequestSchema } from '@flows/contracts';

import { flowRepo } from '../../../repositories/flow-repository';
import { getBody, withMiddleware } from '../../../utils/middleware';
import { created, unprocessable } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * POST /flows
 *
 * Product API — create a new empty flow (canvas).
 * Supports optional ownerId for user-scoped workflows.
 */
const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const body = getBody(event);
    const parsed = ProductFlowCreateRequestSchema.safeParse(body);
    if (!parsed.success) return unprocessable('title is required');

    const flow = await flowRepo.create({
        title: parsed.data.title,
        description: parsed.data.description,
        scenario: parsed.data.scenario,
        ownerId: parsed.data.ownerId,
    });

    return created({
        flowId: flow.id,
        title: flow.name,
        description: flow.description ?? null,
        status: flow.state,
        nodes: flow.nodes,
        edges: flow.edges,
        createdAt: flow.createdAt,
        updatedAt: flow.updatedAt,
    });
};

export const main = withMiddleware(handler);
