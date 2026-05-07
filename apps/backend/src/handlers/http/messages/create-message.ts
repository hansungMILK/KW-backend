import { MessageCreateParamsSchema, MessageCreateRequestSchema } from '@flows/contracts';

import { PAID_OPENAI_DISABLED, isPaidOpenAIAllowed } from '../../../adapters/ai/paid-openai-guard';
import { env } from '../../../config/env';
import { getOrchestrator } from '../../../modules/orchestrator';
import { classifyMessageIntent, generateChatReply } from '../../../modules/orchestrator/chat-assistant';
import { flowRepo } from '../../../repositories/flow-repository';
import { messageRepo } from '../../../repositories/message-repository';
import { proposalRepo } from '../../../repositories/proposal-repository';
import { settingsService } from '../../../services/settings-service';
import { wsService } from '../../../services/websocket-service';
import { generateNumericId } from '../../../utils/id-generator';
import { getBody, getPathParam, withMiddleware } from '../../../utils/middleware';
import { badGateway, badRequest, created, notFound, unprocessableJson } from '../../../utils/response';

import type { ApiKeyProvider, Message, Proposal } from '@flows/contracts';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const ORCHESTRATOR_PROVIDER_BY_MODE: Record<string, ApiKeyProvider | undefined> = {
    openai: 'openai',
    claude: 'anthropic',
};

const ensureOrchestratorProviderKey = async (): Promise<APIGatewayProxyResult | null> => {
    const provider = ORCHESTRATOR_PROVIDER_BY_MODE[env.orchestratorMode];
    if (!provider) return null;

    if (provider === 'openai' && !isPaidOpenAIAllowed()) {
        return unprocessableJson({
            error: PAID_OPENAI_DISABLED,
            message:
                'Paid OpenAI calls are disabled. Set ALLOW_PAID_OPENAI=1 only when you intentionally want to spend API credits.',
        });
    }

    const apiKey = await settingsService.getKeyForProviderAsync(provider);
    if (apiKey) return null;

    return unprocessableJson({
        error: 'MISSING_API_KEYS',
        message: `Required API keys not configured: ${provider}`,
        missingProviders: [provider],
    });
};

/**
 * POST /flows/{flowId}/messages
 *
 * 1. Save USER message
 * 2. Route via AI intent classifier
 * 3. For chat: save ASSISTANT text message
 * 4. For workflow: call orchestrator → generate proposal
 * 5. Return { message, proposal?, assistantMessage }
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

    const missingKeyResponse = await ensureOrchestratorProviderKey();
    if (missingKeyResponse) return missingKeyResponse;

    const now = new Date().toISOString();
    const fid = paramsParsed.data.flowId;
    const { items: previousMessages } = await messageRepo.listByFlow(fid, 12);

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

    const intent = await classifyMessageIntent(bodyParsed.data.content, previousMessages, currentContext);

    if (intent.action === 'chat') {
        const assistantText = await generateChatReply(
            bodyParsed.data.content,
            [...previousMessages, userMessage],
            currentContext
        );
        const assistantMessage: Message = {
            messageId: generateNumericId(),
            flowId: fid,
            role: 'ASSISTANT',
            messageType: 'TEXT',
            content: assistantText,
            metadata: {
                intent,
            },
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
        return badGateway(result.assistantMessage, 'AI_PROVIDER_ERROR');
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
