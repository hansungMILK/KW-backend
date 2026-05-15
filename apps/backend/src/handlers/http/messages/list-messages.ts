import { MessageListParamsSchema } from '@flows/contracts';

import { messageRepo } from '../../../repositories/message-repository';
import { proposalRepo } from '../../../repositories/proposal-repository';
import { getPathParam, getQueryParam, withMiddleware } from '../../../utils/middleware';
import { badRequest, ok } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * GET /flows/{flowId}/messages
 *
 * Query: limit (default 50), cursor (optional)
 * Returns: { items: Message[], nextCursor: string | null }
 */
const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const flowId = getPathParam(event, 'flowId');
    const parsed = MessageListParamsSchema.safeParse({ flowId });
    if (!parsed.success) return badRequest('flowId is required');

    const limit = Number(getQueryParam(event, 'limit') || '50');
    const result = await messageRepo.listByFlow(parsed.data.flowId, limit);
    const items = await Promise.all(
        result.items.map(async message => {
            if (!message.proposalId) return message;
            const proposal = await proposalRepo.get(message.proposalId);
            return proposal ? { ...message, proposal } : message;
        })
    );

    return ok({
        items,
        nextCursor: result.nextCursor,
    });
};

export const main = withMiddleware(handler);
