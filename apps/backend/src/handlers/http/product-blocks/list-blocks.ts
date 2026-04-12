import { formatBlockForApi, getBlocksByScenario } from './block-catalog';
import { getQueryParam, withMiddleware } from '../../../utils/middleware';
import { ok } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * GET /blocks?scenario=admission-shorts&category=media
 *
 * Product API — returns the block catalog in product format.
 * - scenario: filters blocks by scenario tag. Default: 'admission-shorts'.
 *   Blocks can belong to multiple scenarios.
 * - category: case-insensitive filter within the scenario.
 */
const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const scenario = getQueryParam(event, 'scenario') ?? 'admission-shorts';
    const category = getQueryParam(event, 'category');

    let blocks = getBlocksByScenario(scenario);

    if (category) {
        const lower = category.toLowerCase();
        blocks = blocks.filter(b => b.category.toLowerCase() === lower);
    }

    return ok({
        items: blocks.map(formatBlockForApi),
    });
};

export const main = withMiddleware(handler);
