import { flowRepo } from '../../../repositories/flow-repository';
import { messageRepo } from '../../../repositories/message-repository';
import { getPathParam, getQueryParam, withMiddleware } from '../../../utils/middleware';
import { notFound, ok } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * GET /flows/{flowId}/chat/init
 *
 * 챗봇 세션 초기화 — 우측 하단 챗봇 아이콘 클릭 시 호출.
 * sessionId = flowId 로 단순화 (별도 세션 테이블 불필요).
 *
 * Query params:
 *   - sessionId (optional): 기존 세션 이어가기 (현재는 flowId와 동일하게 처리)
 *
 * Response:
 *   - chatStatus: 세션 정보 + 환영 메시지 + 이전 대화 내역
 */
const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const flowId = getPathParam(event, 'flowId') ?? '';
    if (!flowId) {
        return { statusCode: 400, body: JSON.stringify({ error: 'flowId is required' }) };
    }

    const flow = await flowRepo.get(flowId);
    if (!flow) return notFound(`Flow ${flowId} not found`);

    // sessionId가 전달되면 해당 세션(=flowId)을 이어가고,
    // 없으면 현재 flowId를 새 세션으로 사용
    const requestedSessionId = getQueryParam(event, 'sessionId');
    const sessionId = requestedSessionId ?? flowId;

    // 이전 대화 내역 조회 (최근 50개)
    const { items: history } = await messageRepo.listByFlow(sessionId, 50);
    const historyEnabled = history.length > 0;

    const welcomeMessage = historyEnabled
        ? `다시 오셨네요! 이전 대화를 이어서 진행합니다. 어떤 작업을 도와드릴까요?`
        : `안녕하세요! Eureka Flow 에이전트입니다. 오늘 어떤 영상 작업을 도와드릴까요?`;

    return ok({
        chatStatus: {
            sessionId,
            isActive: true,
            connectedAgent: 'Eureka-Assistant-v2',
            welcomeMessage,
            context: {
                currentCanvas: flowId,
                historyEnabled,
            },
            history: historyEnabled ? history : [],
        },
    });
};

export const main = withMiddleware(handler);
