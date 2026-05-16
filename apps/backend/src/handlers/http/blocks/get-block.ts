import { toSpecBlockDetail } from './_catalog';
import { DEFAULT_WORKFLOW_PACK_REGISTRY } from '../../../modules/workflow-packs';
import { getPathParam, withMiddleware } from '../../../utils/middleware';
import { badRequest, notFound, ok } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * GET /blocks/{blockType}  (spec)
 * 404 BLOCK_NOT_FOUND if not in catalog.
 * Returns summary fields + configFields.
 */
const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const blockType = getPathParam(event, 'blockType');
    if (!blockType) return badRequest('Missing blockType');

    const block = DEFAULT_WORKFLOW_PACK_REGISTRY.getBlock(blockType)?.http;
    if (!block) return notFound(`Block ${blockType} not found`, 'BLOCK_NOT_FOUND');

    return ok(toSpecBlockDetail(block));
};

export const main = withMiddleware(handler);
