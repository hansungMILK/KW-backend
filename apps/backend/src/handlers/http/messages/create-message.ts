import { MessageCreateParamsSchema, MessageCreateRequestSchema } from '@flows/contracts';

import { getOrchestrator } from '../../../modules/orchestrator';
import { flowRepo } from '../../../repositories/flow-repository';
import { messageRepo } from '../../../repositories/message-repository';
import { proposalRepo } from '../../../repositories/proposal-repository';
import { wsService } from '../../../services/websocket-service';
import { generateNumericId } from '../../../utils/id-generator';
import { getBody, getPathParam, withMiddleware } from '../../../utils/middleware';
import { badRequest, created, notFound } from '../../../utils/response';

import type { Message, Proposal } from '@flows/contracts';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const WORKFLOW_INTENT_PATTERN =
    /(만들|제작|생성|설계|자동화|실행|쇼츠|영상|비디오|워크플로|플로우|블록|노드|workflow|flow|make|create|generate|build|run|shorts|video)/i;

/**
 * POST /flows/{flowId}/messages
 *
 * 1. Save USER message
 * 2. Call orchestrator (mock) → generate proposal
 * 3. Save proposal
 * 4. Save ASSISTANT message
 * 5. Return { message, proposal, assistantMessage }
 */
const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const flowId = getPathParam(event, 'flowId');
    const paramsParsed = MessageCreateParamsSchema.safeParse({ flowId });
    if (!paramsParsed.success) return badRequest('flowId is required');

    const body = getBody(event);
    const bodyParsed = MessageCreateRequestSchema.safeParse(body);
    if (!bodyParsed.success) return badRequest('content is required');

    const currentContext = bodyParsed.data.currentContext;

    // Verify flow exists
    const flow = await flowRepo.get(paramsParsed.data.flowId);
    if (!flow) return notFound(`Flow ${flowId} not found`);

    const now = new Date().toISOString();
    const fid = paramsParsed.data.flowId;

    // 1. Save USER message
    const userMessage: Message = {
        messageId: generateNumericId(),
        flowId: fid,
        role: 'USER',
        messageType: 'TEXT',
        content: bodyParsed.data.content,
        createdAt: now,
    };
    await messageRepo.put(userMessage);

    if (!WORKFLOW_INTENT_PATTERN.test(bodyParsed.data.content)) {
        const assistantMessage: Message = {
            messageId: generateNumericId(),
            flowId: fid,
            role: 'ASSISTANT',
            messageType: 'TEXT',
            content: '안녕하세요. 어떤 워크플로우나 쇼츠를 만들고 싶은지 말해주시면 필요한 블록을 제안하겠습니다.',
            createdAt: now,
        };
        await messageRepo.put(assistantMessage);

        return created({
            message: userMessage,
            assistantMessage,
        });
    }

    // 2. Generate proposal (mock/openai/claude based on ORCHESTRATOR_MODE env)
    const orchestrator = await getOrchestrator();
    const result = await orchestrator.generateProposal(fid, bodyParsed.data.content, currentContext);

    if (!result.approvalRequired || result.proposedNodes.length === 0) {
        const assistantMessage: Message = {
            messageId: generateNumericId(),
            flowId: fid,
            role: 'ASSISTANT',
            messageType: 'TEXT',
            content: result.assistantMessage,
            createdAt: now,
        };
        await messageRepo.put(assistantMessage);

        return created({
            message: userMessage,
            assistantMessage,
        });
    }

    // 3. Save proposal
    const proposalId = generateNumericId();
    const proposal: Proposal = {
        proposalId,
        flowId: fid,
        sourceMessageId: userMessage.messageId,
        status: 'PENDING',
        proposedNodes: result.proposedNodes,
        proposedEdges: result.proposedEdges,
        estimatedCost: result.estimatedCost,
        approvalRequired: result.approvalRequired,
        createdAt: now,
        updatedAt: now,
    };
    await proposalRepo.put(proposal);

    // 3-1. Broadcast proposal.created via WebSocket (non-blocking)
    void wsService.broadcastToFlow(fid, {
        type: 'proposal.created',
        id: proposalId,
        proposalId,
        flowId: fid,
        status: 'PENDING',
        blocks: result.proposedNodes.map(node => ({
            type: node.blockType,
            label: node.name,
        })),
        estimatedCost: proposal.estimatedCost?.total,
        description: result.assistantMessage,
        approvalRequired: proposal.approvalRequired,
        timestamp: Date.now(),
    });

    // 4. Save ASSISTANT message
    const assistantMessage: Message = {
        messageId: generateNumericId(),
        flowId: fid,
        role: 'ASSISTANT',
        messageType: 'PROPOSAL',
        content: result.assistantMessage,
        proposalId,
        createdAt: now,
    };
    await messageRepo.put(assistantMessage);

    // 5. Return
    return created({
        message: userMessage,
        proposal: {
            proposalId: proposal.proposalId,
            flowId: proposal.flowId,
            status: proposal.status,
            estimatedCost: proposal.estimatedCost,
            proposedNodes: proposal.proposedNodes,
            proposedEdges: proposal.proposedEdges,
            approvalRequired: proposal.approvalRequired,
            createdAt: proposal.createdAt,
        },
        assistantMessage,
    });
};

export const main = withMiddleware(handler);
