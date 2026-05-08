import { z } from 'zod';

import { PAID_OPENAI_DISABLED } from '../../../adapters/ai/paid-openai-guard';
import { runService } from '../../../services/run-service';
import { getBody, getPathParam, withMiddleware } from '../../../utils/middleware';
import { accepted, badRequest, notFound, unprocessableJson } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const ParamsSchema = z.object({
    flowId: z.string().min(1),
    nodeId: z.string().min(1),
});

const RequestSchema = z
    .object({
        triggerSource: z.string().default('MANUAL'),
    })
    .partial()
    .passthrough();

/**
 * POST /flows/{flowId}/nodes/{nodeId}/runs
 *
 * Spec path for single-node execution (F-11). Internally delegates to
 * runService.createSingleNodeRun which produces a Run of runType=SINGLE_NODE
 * and enqueues an EXECUTE_RUN message against that one-node run so normal run
 * status transitions (RUNNING → COMPLETED/FAILED) still apply. Returns 202
 * Accepted.
 *
 * This is now the only supported single-node execution route after P3 legacy
 * /nodes/* handler removal. The frontend compatibility layer calls this path.
 */
const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const paramsParsed = ParamsSchema.safeParse({
        flowId: getPathParam(event, 'flowId'),
        nodeId: getPathParam(event, 'nodeId'),
    });
    if (!paramsParsed.success) return badRequest('flowId and nodeId are required');

    const body = getBody<Record<string, unknown>>(event) ?? {};
    const bodyParsed = RequestSchema.safeParse(body);
    if (!bodyParsed.success) return badRequest('Invalid single-node run request body');

    const triggerSource = bodyParsed.data.triggerSource ?? 'MANUAL';

    const { flowId, nodeId } = paramsParsed.data;

    const result = await runService.createSingleNodeRun(flowId, nodeId, triggerSource);

    if (!result.ok) {
        if (result.status === 404) return notFound(result.error);
        if (result.status === 422) {
            if (result.error === PAID_OPENAI_DISABLED) {
                return unprocessableJson({
                    error: PAID_OPENAI_DISABLED,
                    message:
                        'Paid OpenAI calls are disabled. Set ALLOW_PAID_OPENAI=1 only when you intentionally want to spend API credits.',
                    missingProviders: [],
                });
            }
            if (result.error === 'RUN_COST_LIMIT_EXCEEDED') {
                return unprocessableJson({
                    error: 'RUN_COST_LIMIT_EXCEEDED',
                    message: `Estimated run cost $${(result.estimatedCostUsd ?? 0).toFixed(2)} exceeds the per-run cap $${(result.maxCostUsd ?? 0).toFixed(2)}.`,
                    estimatedCostUsd: result.estimatedCostUsd,
                    maxCostUsd: result.maxCostUsd,
                });
            }
            const missingProviders = result.missingProviders ?? [];
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
        status: run.status,
        runType: run.runType,
        targetNodeId: run.targetNodeId,
        createdAt: run.createdAt,
    });
};

export const main = withMiddleware(handler);
