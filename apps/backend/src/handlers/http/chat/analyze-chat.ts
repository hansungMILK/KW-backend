import { z } from 'zod';

import { getOrchestrator } from '../../../modules/orchestrator';
import { flowRepo } from '../../../repositories/flow-repository';
import { messageRepo } from '../../../repositories/message-repository';
import { proposalRepo } from '../../../repositories/proposal-repository';
import { generateNumericId } from '../../../utils/id-generator';
import { getBody, withMiddleware } from '../../../utils/middleware';
import { badRequest, created, notFound } from '../../../utils/response';

import type { Message, Proposal } from '@flows/contracts';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * POST /chat/analyze
 *
 * 사용자의 자연어 입력을 분석하여 필요한 에이전트 블록 시퀀스를 도출합니다.
 * sessionId = flowId 로 단순화 (별도 세션 테이블 없음)
 */

const AnalyzeRequestSchema = z.object({
    sessionId: z.string().min(1),
    message: z.string().min(1),
    currentContext: z.record(z.unknown()).optional(),
});

// 블록 타입별 reason 매핑
const BLOCK_REASONS: Record<string, string> = {
    search: '최신 뉴스/트렌드 데이터 수집을 위해 검색 에이전트 필요',
    content: '수집된 데이터를 기반으로 스크립트 생성을 위해 콘텐츠 에이전트 필요',
    data: '데이터 정규화 및 구조화를 위해 데이터 처리 에이전트 필요',
    analysis: '콘텐츠 안전성 및 품질 검수를 위해 분석 에이전트 필요',
    'media-image': '씬별 이미지 생성을 위해 이미지 생성 에이전트 필요',
    'media-tts': '나레이션 음성 생성을 위해 TTS 에이전트 필요',
    'media-video': '이미지와 음성을 합성하여 영상 제작을 위해 영상 합성 에이전트 필요',
    integration: '최종 SEO 메타데이터 생성 및 배포를 위해 통합 에이전트 필요',
};

// 사용자 메시지에서 주요 키워드(entities) 추출
function extractEntities(message: string): string[] {
    const keywords = ['뉴스', '쇼츠', '영상', '입시', '키워드', '스크립트', '이미지', '음성', '유튜브', '틱톡'];
    return keywords.filter(k => message.includes(k));
}

const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const body = getBody(event);
    const parsed = AnalyzeRequestSchema.safeParse(body);
    if (!parsed.success) {
        return badRequest(`Invalid request: ${parsed.error.errors.map(e => e.message).join(', ')}`);
    }

    const { sessionId, message, currentContext } = parsed.data;

    // sessionId = flowId
    const flow = await flowRepo.get(sessionId);
    if (!flow) return notFound(`Session ${sessionId} not found`);

    const now = new Date().toISOString();
    const requestId = `req-${generateNumericId()}`;

    // 1. USER 메시지 저장
    const userMessage: Message = {
        messageId: generateNumericId(),
        flowId: sessionId,
        role: 'USER',
        messageType: 'TEXT',
        content: message,
        createdAt: now,
    };
    await messageRepo.put(userMessage);

    // 2. 오케스트레이터 호출
    const orchestrator = await getOrchestrator();
    const result = await orchestrator.generateProposal(sessionId, message, currentContext);

    // 3. Proposal 저장
    const proposalId = generateNumericId();
    const proposal: Proposal = {
        proposalId,
        flowId: sessionId,
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

    // 4. ASSISTANT 메시지 저장
    const assistantMessage: Message = {
        messageId: generateNumericId(),
        flowId: sessionId,
        role: 'ASSISTANT',
        messageType: 'PROPOSAL',
        content: result.assistantMessage,
        proposalId,
        createdAt: now,
    };
    await messageRepo.put(assistantMessage);

    // 5. proposedNodes → proposedPlan 변환
    const proposedPlan = result.proposedNodes.map((node, i) => ({
        step: i + 1,
        blockId:
            (node['blockId'] as string) ?? `blk-${node['blockType'] ?? 'unknown'}-${String(i + 1).padStart(2, '0')}`,
        reason: BLOCK_REASONS[(node['blockType'] as string) ?? ''] ?? '작업 수행을 위해 에이전트 필요',
    }));

    // 6. 스펙 형식으로 응답
    return created({
        analysisResult: {
            requestId,
            userIntent: result.assistantMessage,
            entities: extractEntities(message),
            proposedPlan,
            message: '입력하신 내용을 분석했습니다. 위와 같은 단계로 작업을 진행할까요?',
        },
    });
};

export const main = withMiddleware(handler);
