import { flowRepo } from '../../../repositories/flow-repository';
import { getQueryParam, withMiddleware } from '../../../utils/middleware';
import { ok } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * GET /flows?status=&ownerId=&limit=20&cursor=
 *
 * Product API — list flows with optional filters + cursor pagination.
 */
const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const limitStr = getQueryParam(event, 'limit');
    const status = getQueryParam(event, 'status');
    const ownerId = getQueryParam(event, 'ownerId');
    const cursor = getQueryParam(event, 'cursor');
    const limit = limitStr ? Math.min(Math.max(parseInt(limitStr, 10) || 20, 1), 100) : 20;

    let flows = await flowRepo.scan();

    if (status) flows = flows.filter(f => f.state === status);
    if (ownerId) flows = flows.filter(f => f.ownerId === ownerId);

    // Sort by updatedAt descending
    flows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    // Apply cursor: skip until we find the cursor ID, then take from next
    if (cursor) {
        const idx = flows.findIndex(f => f.id === cursor);
        if (idx >= 0) flows = flows.slice(idx + 1);
    }

    // Take limit + 1 to determine if there's a next page
    const page = flows.slice(0, limit + 1);
    const hasMore = page.length > limit;
    const items = hasMore ? page.slice(0, limit) : page;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return ok({
        items: items.map(f => ({
            flowId: f.id,
            title: f.name ?? 'Untitled Flow',
            status: f.state ?? 'DRAFT',
            updatedAt: f.updatedAt,
        })),
        nextCursor,
    });
};

export const main = withMiddleware(handler);
