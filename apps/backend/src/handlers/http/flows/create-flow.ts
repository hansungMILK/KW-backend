import { FlowCreateRequestSchema } from '@flows/contracts';

import { flowRepo } from '../../../repositories/flow-repository';
import { getBody, withMiddleware } from '../../../utils/middleware';
import { badRequest, created } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * POST /flows  (spec, audit F-02)
 * Body: { title (required), description?, scenario? }
 * 201 → FlowSummary, status: DRAFT
 */
const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const body = getBody(event);
    const parsed = FlowCreateRequestSchema.safeParse(body);
    if (!parsed.success) return badRequest(`Invalid body: ${parsed.error.message}`);

    const flow = await flowRepo.create(parsed.data);

    return created({
        flowId: flow.id,
        title: flow.name,
        description: flow.description,
        status: flow.state,
        channelId: flow.id,
        createdAt: flow.createdAt,
        updatedAt: flow.updatedAt,
    });
};

export const main = withMiddleware(handler);
