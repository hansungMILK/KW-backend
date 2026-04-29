import { BLOCK_CATALOG } from './_catalog';
import { withMiddleware } from '../../../utils/middleware';
import { ok } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * GET /blocks/0/list?cores=1&limit=-1
 * Caller: libs/flows/src/api/blocks.ts → listBlocks()
 *
 * Returns: { list: BlockViewWithFrontend[] } — legacy shape preserved.
 * Catalog is shared with the spec endpoints (GET /blocks, GET /blocks/{blockType}).
 */
const handler = async (_event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    return ok({ list: BLOCK_CATALOG });
};

export const main = withMiddleware(handler);
