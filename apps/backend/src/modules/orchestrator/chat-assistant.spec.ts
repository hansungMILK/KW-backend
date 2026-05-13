import { beforeEach, describe, expect, it, vi } from 'vitest';

import { classifyMessageIntent } from './chat-assistant';
import { openaiAdapter } from '../../adapters/ai/openai-adapter';

import type { Message } from '@flows/contracts';

vi.mock('../../config/env', () => ({
    env: {
        orchestratorMode: 'openai',
        openaiOrchestratorModel: 'gpt-test',
        openaiModel: 'gpt-test',
    },
}));

vi.mock('../../adapters/ai/openai-adapter', () => ({
    openaiAdapter: {
        chatJson: vi.fn(),
        chatText: vi.fn(),
    },
}));

const history: Message[] = [];

describe('classifyMessageIntent', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('routes URL-based longform explanation requests to workflow proposals without asking chat to answer', async () => {
        const intent = await classifyMessageIntent(
            '롱폼만들어줘. 주제는 이 링크 설명해주기 . https://knightk.tistory.com/946',
            history
        );

        expect(intent).toEqual({
            action: 'proposal',
            reason: 'URL 원문 수집 기반 워크플로우 요청',
        });
        expect(openaiAdapter.chatJson).not.toHaveBeenCalled();
    });

    it('routes direct URL explanation requests to workflow proposals', async () => {
        const intent = await classifyMessageIntent('이 링크 내용 설명해줘 https://example.com/article', history);

        expect(intent.action).toBe('proposal');
        expect(openaiAdapter.chatJson).not.toHaveBeenCalled();
    });

    it('routes longform creation requests to workflow proposals even without a URL', async () => {
        const intent = await classifyMessageIntent('AI 에이전트 미래에 대한 롱폼 제작해줘', history);

        expect(intent).toEqual({
            action: 'proposal',
            reason: '롱폼 제작 워크플로우 요청',
        });
        expect(openaiAdapter.chatJson).not.toHaveBeenCalled();
    });

    it('keeps greetings and capability questions in chat', async () => {
        await expect(classifyMessageIntent('ㅎㅇ', history)).resolves.toEqual({
            action: 'chat',
            reason: '워크플로우 생성/실행 의도가 명시되지 않음',
        });
        await expect(classifyMessageIntent('뭐 할 수 있어?', history)).resolves.toEqual({
            action: 'chat',
            reason: '워크플로우 생성/실행 의도가 명시되지 않음',
        });
        expect(openaiAdapter.chatJson).not.toHaveBeenCalled();
    });
});
