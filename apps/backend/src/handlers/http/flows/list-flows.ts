import { flowRepo } from '../../../repositories/flow-repository';
import { withMiddleware } from '../../../utils/middleware';
import { ok } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * GET /flows
 *
 * 저장된 워크플로우 목록을 반환합니다 (pagination 지원).
 */
const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const limitParams = parseInt(event.queryStringParameters?.limit || '50', 10);
    const limit = isNaN(limitParams) ? 50 : Math.min(limitParams, 100);
    const nextToken = event.queryStringParameters?.nextToken;
    const ownerId = event.queryStringParameters?.ownerId;

    const result = await flowRepo.list({ limit, nextToken, ownerId });

    // 요약 정보 형식으로 매핑
    const summary = result.items.map(f => ({
        id: f.id,
        name: f.name || 'Untitled Flow',
        description: f.description,
        state: f.state,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
    }));

    return ok({
        flows: summary,
        nextToken: result.nextToken,
    });
};

export const main = withMiddleware(handler);
