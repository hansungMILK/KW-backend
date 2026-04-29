import { BLOCK_CATALOG, toSpecBlock } from './_catalog';
import { withMiddleware } from '../../../utils/middleware';
import { ok } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * GET /blocks  (spec)
 * Returns: { items: [{ blockType, name, description, category, inputSchema, outputSchema, estimatedCost }] }
 */
const handler = async (_event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    return ok({ items: BLOCK_CATALOG.map(toSpecBlock) });
};

export const main = withMiddleware(handler);
