import { runService } from '../../../services/run-service';
import { getBody, getPathParam, withMiddleware } from '../../../utils/middleware';
import { accepted, badRequest, notFound, unprocessableJson } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * POST /flows/{flowId}/nodes/{nodeId}/runs
 *
 * Product API F-11 — execute a single block independently.
 * Compat POST /nodes/{id}/run is preserved separately.
 */
const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const flowId = getPathParam(event, 'flowId');
    const nodeId = getPathParam(event, 'nodeId');
    if (!flowId || !nodeId) return badRequest('flowId and nodeId are required');

    const body = getBody<Record<string, unknown>>(event) ?? {};
    const triggerSource = (body.triggerSource as string) ?? 'MANUAL';

    const result = await runService.createSingleNodeRun(flowId, nodeId, triggerSource);

    if (!result.ok) {
        if (result.status === 404) return notFound(result.error);
        if (result.status === 422) {
            const missingProviders = (result as { missingProviders?: string[] }).missingProviders ?? [];
            return unprocessableJson({
                error: 'MISSING_API_KEYS',
                message: `Required API keys not configured: ${missingProviders.join(', ')}`,
                missingProviders,
            });
        }
        return badRequest(result.error);
    }

    const { run } = result;
    return accepted({
        runId: run.runId,
        flowId: run.flowId,
        runType: run.runType,
        targetNodeId: nodeId,
        status: run.status,
        createdAt: run.createdAt,
    });
};

export const main = withMiddleware(handler);
