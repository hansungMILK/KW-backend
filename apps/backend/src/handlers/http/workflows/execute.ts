import { z } from 'zod';

import { runRepo } from '../../../repositories/run-repository';
import { runService } from '../../../services/run-service';
import { getBody, getPathParam, getQueryParam, withMiddleware } from '../../../utils/middleware';
import { accepted, badRequest, notFound, ok, unprocessableJson } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * POST /workflows/{workflowId}/execute  — Start execution
 * GET  /workflows/{workflowId}/execute?executionId=...  — Poll status
 *
 * #6 워크플로우 실행 및 실시간 모니터링
 * Wraps existing run-service: workflowId → flowId, executionId → runId.
 */

const ExecuteRequestSchema = z.object({
    executionMode: z.enum(['full', 'step']).optional(),
    notifyWebhook: z.string().url().optional(),
});

const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const workflowId = getPathParam(event, 'workflowId') ?? '';
    const method = event.httpMethod ?? 'POST';

    // GET: poll execution status
    if (method === 'GET') {
        const executionId = getQueryParam(event, 'executionId');
        if (!executionId) return badRequest('executionId query parameter is required');

        const run = await runRepo.getRun(executionId);
        if (!run) return notFound(`Execution ${executionId} not found`);

        const runNodes = await runRepo.listRunNodes(executionId);
        const completedCount = runNodes.filter(
            n => n.status === 'COMPLETED' || n.status === 'FAILED' || n.status === 'CANCELLED'
        ).length;
        const totalCount = runNodes.length || 1;
        const overallProgress = Math.round((completedCount / totalCount) * 100);
        const currentRunningNode = runNodes.find(n => n.status === 'RUNNING')?.nodeId ?? null;

        return ok({
            executionStatus: {
                executionId,
                overallProgress,
                currentRunningNode,
                nodeStatuses: runNodes.map(n => ({
                    nodeId: n.nodeId,
                    status: n.status,
                    startTime: n.startedAt ?? null,
                    endTime: n.completedAt ?? null,
                    progress: n.status === 'COMPLETED' ? 100 : n.status === 'RUNNING' ? 50 : 0,
                    outputSummary: n.outputPayload
                        ? typeof n.outputPayload === 'object'
                            ? JSON.stringify(n.outputPayload).slice(0, 100)
                            : String(n.outputPayload).slice(0, 100)
                        : null,
                })),
                isTerminated: run.status === 'COMPLETED' || run.status === 'FAILED' || run.status === 'CANCELLED',
            },
        });
    }

    // POST: start execution
    const body = getBody<Record<string, unknown>>(event) ?? {};
    const parsed = ExecuteRequestSchema.safeParse(body);
    if (!parsed.success) {
        return badRequest(`Invalid request: ${parsed.error.errors.map(e => e.message).join(', ')}`);
    }

    const result = await runService.createRun(workflowId, 'MANUAL', {
        executionMode: parsed.data.executionMode,
        notifyWebhook: parsed.data.notifyWebhook,
    });

    if (!result.ok) {
        if (result.status === 404) return notFound(result.error);
        if (result.status === 422 && 'missingProviders' in result) {
            return unprocessableJson({
                error: 'MISSING_API_KEYS',
                message: result.error,
                missingProviders: (result as Record<string, unknown>).missingProviders,
            });
        }
        return badRequest(result.error);
    }

    const run = result.run;

    return accepted({
        executionStatus: {
            executionId: run.runId,
            overallProgress: 0,
            currentRunningNode: null,
            nodeStatuses: [],
            isTerminated: false,
        },
    });
};

export const main = withMiddleware(handler);
