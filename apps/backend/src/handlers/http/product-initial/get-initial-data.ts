import { flowRepo } from '../../../repositories/flow-repository';
import { getQueryParam, withMiddleware } from '../../../utils/middleware';
import { badRequest, ok } from '../../../utils/response';
import { PRODUCT_BLOCK_CATALOG, formatBlockForApi } from '../product-blocks/block-catalog';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * GET /initial-data?ownerId=<required>&category=&limit=20
 *
 * Product API — single entry point returning:
 *   { initialData: { availableBlocks, userWorkflows } }
 *
 * - ownerId is REQUIRED — prevents accidentally leaking other users' data
 * - availableBlocks: filtered by category (optional, case-insensitive)
 * - userWorkflows: filtered by ownerId + limit
 */
const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const ownerId = getQueryParam(event, 'ownerId');
    if (!ownerId) return badRequest('ownerId query parameter is required');

    const category = getQueryParam(event, 'category');
    const limitStr = getQueryParam(event, 'limit');
    const limit = limitStr ? Math.min(Math.max(parseInt(limitStr, 10) || 20, 1), 100) : 20;

    // 1. Block catalog with optional category filter (case-insensitive)
    let blocks = PRODUCT_BLOCK_CATALOG;
    if (category) {
        const lower = category.toLowerCase();
        blocks = blocks.filter(b => b.category.toLowerCase() === lower);
    }
    const availableBlocks = blocks.map(formatBlockForApi);

    // 2. User workflows — always filtered by ownerId
    let flows = await flowRepo.scan();
    flows = flows.filter(f => f.ownerId === ownerId);
    flows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const userWorkflows = flows.slice(0, limit).map(f => ({
        flowId: f.id,
        title: f.name ?? 'Untitled Flow',
        status: f.state ?? 'DRAFT',
        updatedAt: f.updatedAt,
    }));

    return ok({
        initialData: {
            availableBlocks,
            userWorkflows,
        },
    });
};

export const main = withMiddleware(handler);
