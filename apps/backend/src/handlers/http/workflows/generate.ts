import { z } from 'zod';

import { proposalRepo } from '../../../repositories/proposal-repository';
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
    // #18: reject empty/missing path params before DB lookups
    const workflowId = getPathParam(event, 'workflowId');
    if (!workflowId) return badRequest('workflowId path parameter is required');

    const body = getBody<Record<string, unknown>>(event) ?? {};

    const parsed = GenerateRequestSchema.safeParse(body);
    if (!parsed.success) {
        return badRequest(`Invalid request: ${parsed.error.errors.map(e => e.message).join(', ')}`);
    }

    const { approvalId, layoutType } = parsed.data;

    // PRE-CHECK: verify workflowId matches proposal's flowId BEFORE mutating state.
    // Without this, approve() would mutate the proposal and flow before we reject.
    const proposal = await proposalRepo.get(approvalId);
    if (!proposal) return notFound(`Approval ${approvalId} not found`);
    if (proposal.flowId !== workflowId) {
        // #17: do NOT leak the real flowId of the approval
        return conflict('Approval does not belong to this workflow');
    }

    // Safe to mutate: approve proposal and apply layout
    const result = await proposalService.approve(approvalId, undefined, layoutType);

    if (!result.ok) {
        if (result.status === 404) return notFound(result.error);
        if (result.status === 409) return conflict(result.error);
        return badRequest(result.error);
    }

    const { flow } = result.data;

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
