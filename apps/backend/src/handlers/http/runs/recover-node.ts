import { RunNodeRetryParamsSchema, RunNodeRetryRequestSchema } from '@flows/contracts';

import { runService } from '../../../services/run-service';
import { getBody, getPathParam, withMiddleware } from '../../../utils/middleware';
import { badRequest, conflict, notFound, ok, unprocessableJson } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * POST /runs/{runId}/nodes/{nodeId}/recover
 *
 * Body: { reason?: string }
 * Accepts failed analysis recovery and queues the rewrite work.
 */
const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const runId = getPathParam(event, 'runId');
    const nodeId = getPathParam(event, 'nodeId');
    const paramsParsed = RunNodeRetryParamsSchema.safeParse({ runId, nodeId });
    if (!paramsParsed.success) return badRequest('runId and nodeId are required');

    const body = getBody<Record<string, unknown>>(event) ?? {};
    const bodyParsed = RunNodeRetryRequestSchema.safeParse(body);
    const reason = bodyParsed.success ? bodyParsed.data.reason : undefined;

    const result = await runService.requestAnalysisRecovery(paramsParsed.data.runId, paramsParsed.data.nodeId, reason);

    if (!result.ok) {
        if (result.status === 404) return notFound(result.error);
        if (result.status === 409) return conflict(result.error);
        if (result.status === 422) return unprocessableJson({ error: result.error });
        return badRequest(result.error);
    }

    return ok({
        runId: paramsParsed.data.runId,
        nodeId: paramsParsed.data.nodeId,
        recoveryAccepted: true,
        repairedSourceNodeId: result.repairedSourceNodeId,
    });
};

export const main = withMiddleware(handler);
