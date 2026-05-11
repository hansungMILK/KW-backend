import { AssetGetParamsSchema } from '@flows/contracts';

import { assetVisibilityService } from '../../../services/asset-visibility-service';
import { getPathParam, withMiddleware } from '../../../utils/middleware';
import { badRequest, notFound, ok } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * GET /assets/{assetId}
 *
 * Returns a single published asset, or 404 if it is missing/not visible yet.
 */
const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const assetId = getPathParam(event, 'assetId');
    const paramsParsed = AssetGetParamsSchema.safeParse({ assetId });
    if (!paramsParsed.success) return badRequest('assetId is required');

    const asset = await assetVisibilityService.getPublished(paramsParsed.data.assetId);
    if (!asset) return notFound(`Asset ${paramsParsed.data.assetId} not found`);

    return ok(asset);
};

export const main = withMiddleware(handler);
