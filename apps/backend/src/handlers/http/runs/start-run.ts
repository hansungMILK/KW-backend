import { RunCreateParamsSchema, RunCreateRequestSchema } from '@flows/contracts';

import { PAID_OPENAI_DISABLED } from '../../../adapters/ai/paid-openai-guard';
import { runService } from '../../../services/run-service';
import { getBody, getPathParam, withMiddleware } from '../../../utils/middleware';
import { accepted, badRequest, conflict, notFound, unprocessableJson } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * POST /flows/{flowId}/runs
 *
 * Body: { triggerSource?, executionMode?, scope?, notifyWebhook? }
 * Returns 202 Accepted: { runId, flowId, status, runType, createdAt }
 */
const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const flowId = getPathParam(event, 'flowId');
    const paramsParsed = RunCreateParamsSchema.safeParse({ flowId });
    if (!paramsParsed.success) return badRequest('flowId is required');

    const body = getBody<Record<string, unknown>>(event) ?? {};
    const bodyParsed = RunCreateRequestSchema.safeParse(body);
    if (!bodyParsed.success) return badRequest('Invalid run request body');

    const { triggerSource, executionMode, scope, notifyWebhook } = bodyParsed.data;

    const result = await runService.createRun(paramsParsed.data.flowId, triggerSource, {
        executionMode,
        scope,
        notifyWebhook,
    });

    if (!result.ok) {
        if (result.status === 404) return notFound(result.error);
        if (result.status === 409) return conflict(result.error);
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
                const cost = result as { estimatedCostUsd?: number; maxCostUsd?: number };
                return unprocessableJson({
                    error: 'RUN_COST_LIMIT_EXCEEDED',
                    message: `Estimated run cost $${(cost.estimatedCostUsd ?? 0).toFixed(2)} exceeds the per-run cap $${(cost.maxCostUsd ?? 0).toFixed(2)}.`,
                    estimatedCostUsd: cost.estimatedCostUsd,
                    maxCostUsd: cost.maxCostUsd,
                });
            }
            if (result.error === 'LONGFORM_HTML_RENDER_COST_LIMIT_EXCEEDED') {
                const cost = result as { estimatedCostUsd?: number; maxCostUsd?: number };
                return unprocessableJson({
                    error: 'LONGFORM_HTML_RENDER_COST_LIMIT_EXCEEDED',
                    message: `Estimated longform HTML/HyperFrames generation cost $${(cost.estimatedCostUsd ?? 0).toFixed(2)} exceeds the per-attempt cap $${(cost.maxCostUsd ?? 0).toFixed(2)}.`,
                    estimatedCostUsd: cost.estimatedCostUsd,
                    maxCostUsd: cost.maxCostUsd,
                });
            }
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
        status: run.status,
        runType: run.runType,
        createdAt: run.createdAt,
    });
};

export const main = withMiddleware(handler);
