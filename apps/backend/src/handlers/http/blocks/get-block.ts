import { BLOCK_CATALOG } from './list-blocks';
import { getPathParam, withMiddleware } from '../../../utils/middleware';
import { notFound, ok } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * GET /blocks/{id}
 *
 * 특정 블록의 상세 정보를 반환합니다.
 */
const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const blockId = getPathParam(event, 'id');

    const blockDef = BLOCK_CATALOG.find(b => b.$definition.id === blockId);
    if (!blockDef) {
        return notFound(`Block ${blockId} not found`);
    }

    // 표준 규격으로 매핑
    const block = {
        id: blockDef.$definition.id,
        name: blockDef.$definition.label,
        description: blockDef.$definition.description,
        input: blockDef.$definition.inputs.reduce((acc, i) => ({ ...acc, [i.id]: i.type }), {}),
        output: blockDef.$definition.outputs.reduce((acc, o) => ({ ...acc, [o.id]: o.type }), {}),
        category: blockDef.category,
    };

    return ok({
        block,
    });
};

export const main = withMiddleware(handler);
