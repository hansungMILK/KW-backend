import { z } from 'zod';

import { proposalService } from '../../../services/proposal-service';
import { getBody, getPathParam, withMiddleware } from '../../../utils/middleware';
import { badRequest, conflict, notFound, ok } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * POST /workflows/{workflowId}/generate
 *
 * #5 워크플로우 자동 생성 및 UI 반영
 * Wraps existing proposal-approve logic: approvalId → proposalId mapping.
 * Generates nodes/edges and applies layout for canvas rendering.
 */

const GenerateRequestSchema = z.object({
    approvalId: z.string().min(1),
    layoutType: z.enum(['horizontal', 'vertical', 'grid']).optional(),
});

const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const workflowId = getPathParam(event, 'workflowId') ?? '';
    const body = getBody<Record<string, unknown>>(event) ?? {};

    const parsed = GenerateRequestSchema.safeParse(body);
    if (!parsed.success) {
        return badRequest(`Invalid request: ${parsed.error.errors.map(e => e.message).join(', ')}`);
    }

    const { approvalId, layoutType } = parsed.data;

    // approvalId maps to proposalId
    const result = await proposalService.approve(approvalId, undefined, layoutType);

    if (!result.ok) {
        if (result.status === 404) return notFound(result.error);
        if (result.status === 409) return conflict(result.error);
        return badRequest(result.error);
    }

    const { flow } = result.data;

    // Verify workflowId matches proposal's flowId
    if (flow.id !== workflowId) {
        return conflict(`Workflow ${workflowId} does not match proposal's flow ${flow.id}`);
    }

    return ok({
        generationResult: {
            workflowId: flow.id,
            nodes: flow.nodes,
            edges: flow.edges,
            status: 'ready_to_execute',
            message: `워크플로우 배치가 완료되었습니다. ${(flow.nodes as unknown[]).length}개 노드를 클릭하여 세부 설정을 변경할 수 있습니다.`,
        },
    });
};

export const main = withMiddleware(handler);
