import { BLOCK_CATALOG } from './list-blocks';
import { withMiddleware } from '../../../utils/middleware';
import { ok } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * GET /blocks/categories
 *
 * 시스템에 정의된 모든 블록의 고유 카테고리 목록을 반환합니다.
 */
const handler = async (_event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    // BLOCK_CATALOG에서 고유한 카테고리 추출
    const categories = Array.from(new Set(BLOCK_CATALOG.map(b => b.category).filter((c): c is string => !!c)));

    return ok({
        categories,
    });
};

export const main = withMiddleware(handler);
