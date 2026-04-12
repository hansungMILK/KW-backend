import { BlockGetParamsSchema } from '@flows/contracts';

import { PRODUCT_BLOCK_MAP, formatBlockForApi } from './block-catalog';
import { getPathParam, withMiddleware } from '../../../utils/middleware';
import { badRequest, notFound, ok } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * GET /blocks/{blockType}
 *
 * Product API — returns detailed info for a single block type.
 */
const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const blockType = getPathParam(event, 'blockType');
    const parsed = BlockGetParamsSchema.safeParse({ blockType });
    if (!parsed.success) return badRequest('blockType is required');

    const block = PRODUCT_BLOCK_MAP[parsed.data.blockType];
    if (!block) return notFound(`Block type '${parsed.data.blockType}' not found`, 'BLOCK_NOT_FOUND');

    return ok(formatBlockForApi(block));
};

export const main = withMiddleware(handler);
