import { FlowListQuerySchema } from '@flows/contracts';

import { flowRepo } from '../../../repositories/flow-repository';
import { withMiddleware } from '../../../utils/middleware';
import { badRequest, ok } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * GET /flows?limit=&cursor=&status=  (spec, audit F-03)
 * Returns: { items: FlowSummary[], nextCursor?: string }
 */
const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const parsed = FlowListQuerySchema.safeParse(event.queryStringParameters ?? {});
    if (!parsed.success) return badRequest(`Invalid query: ${parsed.error.message}`);

    const limitNum = parsed.data.limit !== undefined ? parseInt(parsed.data.limit, 10) : undefined;
    if (parsed.data.limit !== undefined && (Number.isNaN(limitNum) || (limitNum ?? 0) < 1)) {
        return badRequest('Invalid limit');
    }

    const { items, nextCursor } = await flowRepo.list({
        limit: limitNum,
        cursor: parsed.data.cursor,
        status: parsed.data.status,
    });

    return ok({
        items: items.map(f => ({
            flowId: f.id,
            title: f.name,
            description: f.description,
            status: f.state,
            createdAt: f.createdAt,
            updatedAt: f.updatedAt,
        })),
        nextCursor,
    });
};

export const main = withMiddleware(handler);
