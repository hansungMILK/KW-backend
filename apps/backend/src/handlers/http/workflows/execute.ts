import { z } from 'zod';

import { isDag, isSafeWebhookUrl } from './_validators';
import { flowRepo } from '../../../repositories/flow-repository';
import { runRepo } from '../../../repositories/run-repository';
import { runService } from '../../../services/run-service';
import { getBody, getPathParam, getQueryParam, withMiddleware } from '../../../utils/middleware';
import { accepted, badRequest, conflict, notFound, ok, unprocessable, unprocessableJson } from '../../../utils/response';


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

const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);
const ACTIVE_STATUSES = new Set(['QUEUED', 'RUNNING']);

const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    // #18: reject empty/missing path params before DB lookups
    const workflowId = getPathParam(event, 'workflowId');
    if (!workflowId) return badRequest('workflowId path parameter is required');

    const method = event.httpMethod ?? 'POST';

    // ── GET: poll execution status ──────────────────────────────────────────
    if (method === 'GET') {
        const executionId = getQueryParam(event, 'executionId');
        if (!executionId) return badRequest('executionId query parameter is required');

        const run = await runRepo.getRun(executionId);
        if (!run) return notFound(`Execution ${executionId} not found`);

        // #11: verify workflowId matches run.flowId (do NOT leak other workflows' runs)
        if (run.flowId !== workflowId) {
            return notFound(`Execution ${executionId} not found`);
        }

        const runNodes = await runRepo.listRunNodes(executionId);
        const completedCount = runNodes.filter(n => TERMINAL_STATUSES.has(n.status) || n.status === 'SKIPPED').length;
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
                isTerminated: TERMINAL_STATUSES.has(run.status),
            },
        });
    }

    // ── POST: start execution ───────────────────────────────────────────────
    const body = getBody<Record<string, unknown>>(event) ?? {};
    const parsed = ExecuteRequestSchema.safeParse(body);
    if (!parsed.success) {
        return badRequest(`Invalid request: ${parsed.error.errors.map(e => e.message).join(', ')}`);
    }

    // #14: executionMode 'step' is accepted by schema but not implemented — reject explicitly
    if (parsed.data.executionMode === 'step') {
        return unprocessableJson({
            error: 'UNSUPPORTED_EXECUTION_MODE',
            message: 'executionMode "step" is not yet supported. Only "full" is available.',
        });
    }

    // #8: SSRF guard on notifyWebhook
    if (parsed.data.notifyWebhook) {
        const check = isSafeWebhookUrl(parsed.data.notifyWebhook);
        if (!check.ok) {
            return unprocessable(`notifyWebhook rejected: ${check.reason}`);
        }
    }

    // #10: reject cyclic DAGs before creating a run (execution-engine would mark COMPLETED wrongly)
    const flow = await flowRepo.get(workflowId);
    if (!flow) return notFound(`Workflow ${workflowId} not found`);
    const nodes = (flow.nodes as Array<{ id: string }>) ?? [];
    const edges = (flow.edges as Array<{ source: string; target: string }>) ?? [];
    if (!isDag(nodes, edges)) {
        return unprocessableJson({
            error: 'CYCLIC_WORKFLOW',
            message: 'Workflow contains a cycle. Remove cyclic edges before executing.',
        });
    }

    // #9: active run guard — prevent cost bomb by refusing concurrent executions.
    // Paginate until exhausted so older active runs aren't missed.
    // NOTE: still race-prone without DB-level conditional write; global atomic
    // guarantee is tracked as a follow-up (transaction/state-machine refactor).
    let cursor: string | undefined = undefined;
    let activeRun: { runId: string; status: string } | undefined;
    do {
        const page = await runRepo.listByFlow(workflowId, 100, cursor);
        activeRun = page.items.find(r => ACTIVE_STATUSES.has(r.status));
        if (activeRun) break;
        cursor = page.nextCursor ?? undefined;
    } while (cursor);
    if (activeRun) {
        return conflict(
            `Workflow already has an active execution (runId=${activeRun.runId}, status=${activeRun.status})`
        );
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
