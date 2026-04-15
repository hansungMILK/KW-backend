import { flowRepo } from '../../../repositories/flow-repository';
import { withMiddleware } from '../../../utils/middleware';
import { ok } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * GET /flows
 *
 * 저장된 모든 워크플로우 목록을 반환합니다.
 */
const handler = async (_event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const flows = await flowRepo.scan();

    // 요약 정보 형식으로 매핑
    const summary = flows.map(f => ({
        id: f.id,
        name: f.name || 'Untitled Flow',
        description: f.description,
        state: f.state,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
    }));

    return ok({
        flows: summary,
    });
};

export const main = withMiddleware(handler);
