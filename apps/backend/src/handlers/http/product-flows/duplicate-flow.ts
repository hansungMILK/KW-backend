import { ProductFlowDuplicateParamsSchema, ProductFlowDuplicateRequestSchema } from '@flows/contracts';

import { flowRepo } from '../../../repositories/flow-repository';
import { generateNumericId } from '../../../utils/id-generator';
import { getBody, getPathParam, withMiddleware } from '../../../utils/middleware';
import { badRequest, created, notFound } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * POST /flows/{flowId}/duplicate
 *
 * Product API — duplicate a flow (copies nodes/edges, resets to DRAFT).
 * Messages/proposals are NOT copied.
 */
const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const flowId = getPathParam(event, 'flowId');
    const parsed = ProductFlowDuplicateParamsSchema.safeParse({ flowId });
    if (!parsed.success) return badRequest('flowId is required');

    const source = await flowRepo.get(parsed.data.flowId);
    if (!source) return notFound(`Flow ${flowId} not found`, 'FLOW_NOT_FOUND');

    const body = getBody(event);
    const bodyParsed = ProductFlowDuplicateRequestSchema.safeParse(body ?? {});
    const newTitle =
        bodyParsed.success && bodyParsed.data.title
            ? bodyParsed.data.title
            : `${source.name ?? 'Untitled Flow'} (복사본)`;

    const now = new Date().toISOString();
    const newFlow = {
        id: generateNumericId(),
        name: newTitle,
        state: 'DRAFT',
        stereo: source.stereo,
        description: source.description,
        scenario: source.scenario,
        nodes: JSON.parse(JSON.stringify(source.nodes)), // deep copy
        edges: JSON.parse(JSON.stringify(source.edges)),
        channelId: generateNumericId(),
        createdAt: now,
        updatedAt: now,
    };
    await flowRepo.put(newFlow);

    return created({
        flowId: newFlow.id,
        sourceFlowId: source.id,
        title: newFlow.name,
    });
};

export const main = withMiddleware(handler);
