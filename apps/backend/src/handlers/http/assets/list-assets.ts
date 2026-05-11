import { AssetListParamsSchema } from '@flows/contracts';

import { assetVisibilityService } from '../../../services/asset-visibility-service';
import { getPathParam, withMiddleware } from '../../../utils/middleware';
import { badRequest, ok } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * GET /runs/{runId}/assets
 *
 * Returns published asset records for completed producer nodes only.
 */
const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const runId = getPathParam(event, 'runId');
    const paramsParsed = AssetListParamsSchema.safeParse({ runId });
    if (!paramsParsed.success) return badRequest('runId is required');

    const items = await assetVisibilityService.listPublishedByRun(paramsParsed.data.runId);

    return ok({ items });
};

export const main = withMiddleware(handler);
