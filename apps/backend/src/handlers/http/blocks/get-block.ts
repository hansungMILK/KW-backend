import { blockCatalogService } from '../../../services/block-catalog-service';
import { withMiddleware } from '../../../utils/middleware';
import { getPathParam } from '../../../utils/middleware';
import { badRequest, notFound, ok } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * GET /blocks/{type}
 * Returns the latest BlockDefinitionModel for the given block type.
 */
const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const type = getPathParam(event, 'type');
    if (!type) return badRequest('type is required');

    const def = await blockCatalogService.getByType(type);
    if (!def) return notFound(`Block type "${type}" not found`);

    return ok(def);
};

export const main = withMiddleware(handler);
