import { beforeEach, describe, expect, it, vi } from 'vitest';

import { contentBlock } from './content-block';
import { openaiAdapter } from '../../adapters/ai/openai-adapter';

vi.mock('../../config/env', () => ({
    env: {
        orchestratorMode: 'openai',
        openaiModel: 'gpt-test',
    },
}));

vi.mock('../../adapters/ai/openai-adapter', () => ({
    openaiAdapter: {
        chatJson: vi.fn(async () => ({
            content: JSON.stringify({ text: '링크의 핵심은 KTX 예매 수요와 공급 병목입니다.' }),
            model: 'gpt-test',
            inputTokens: 1,
            outputTokens: 1,
            latencyMs: 1,
        })),
    },
}));

describe('contentBlock', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('supports generic text explanation mode without forcing a Shorts scene contract', async () => {
        const result = await contentBlock.execute(
            {
                keywords: ['KTX', '예매'],
                articles: [{ id: 'source-1', title: 'KTX 기사', url: 'https://example.com', source: 'Example' }],
            },
            { mode: 'explain' }
        );

        expect(openaiAdapter.chatJson).toHaveBeenCalledTimes(1);
        const request = vi.mocked(openaiAdapter.chatJson).mock.calls[0]?.[0];
        expect(request?.systemPrompt).not.toContain('YouTube Shorts');
        expect(request?.systemPrompt).not.toContain('10–15 scene');
        expect(result.output).toMatchObject({
            text: '링크의 핵심은 KTX 예매 수요와 공급 병목입니다.',
            content: '링크의 핵심은 KTX 예매 수요와 공급 병목입니다.',
            value: '링크의 핵심은 KTX 예매 수요와 공급 병목입니다.',
            mode: 'text',
        });
        expect(result.output['scenes']).toBeUndefined();
    });

    it('passes primary URL full text to the script writer when available', async () => {
        vi.mocked(openaiAdapter.chatJson).mockResolvedValueOnce({
            content: JSON.stringify({
                title: '마누스 특가',
                hook: '마누스 특가가 떴습니다',
                script: {
                    hook: '마누스 특가가 떴습니다',
                    angle: '원문 특가 정보를 정리',
                    cta: '자동결제를 확인하세요',
                },
                scenes: Array.from({ length: 10 }, (_, index) => ({
                    sceneNumber: index + 1,
                    imageSlot: `[Image #${index + 1}]`,
                    storyBeat: index === 0 ? 'hook' : 'setup',
                    topTitle: '마누스 특가',
                    caption: '특가 확인',
                    narration: '마누스 특가 조건을 원문 기준으로 확인합니다.',
                    imagePrompt: 'comic style AI subscription scene, no readable text',
                    visualText: '특가 확인',
                    visual: { topTitle: '마누스 특가', mainCaption: '특가 확인' },
                    claimType: 'fact',
                    sourceRefs: ['source-1'],
                    durationSec: 5,
                })),
                cta: '자동결제를 확인하세요',
                totalDurationSec: 50,
            }),
            model: 'gpt-test',
            inputTokens: 1,
            outputTokens: 1,
            latencyMs: 1,
        });

        await contentBlock.execute({
            collectionMode: 'url',
            primaryUrl: 'https://tikongs.tistory.com/1463',
            keywords: ['마누스 AI'],
            articles: [
                {
                    id: 'source-1',
                    title: '마누스 특가 안내',
                    url: 'https://tikongs.tistory.com/1463',
                    source: '콩쓰의 화끈한 생각',
                    sourceType: 'blog',
                    primarySource: true,
                    sourcePriority: 1,
                    summary: '마누스 Pro 특가 안내',
                    fullText:
                        '기존 월 65,000원 수준의 Pro 요금제를 96% 할인된 연 32,000원에 구독했습니다. 마누스는 실행형 AI입니다.',
                    keyClaims: ['기존 월 65,000원', '96% 할인', '연 32,000원', '실행형 AI'],
                },
            ],
        });

        const request = vi.mocked(openaiAdapter.chatJson).mock.calls[0]?.[0];
        expect(request?.systemPrompt).toContain('PRIMARY SOURCE');
        expect(request?.userMessage).toContain('PRIMARY SOURCE');
        expect(request?.userMessage).toContain('96% 할인된 연 32,000원');
        expect(request?.userMessage).toContain('primarySource=true');
    });

    it('passes multiple primary URL full texts to the script writer in source priority order', async () => {
        vi.mocked(openaiAdapter.chatJson).mockResolvedValueOnce({
            content: JSON.stringify({
                title: '우로보로스',
                hook: '국산 하네스가 떴습니다',
                script: { hook: '국산 하네스가 떴습니다', angle: '두 원문을 연결해 설명', cta: '원문을 확인하세요' },
                scenes: Array.from({ length: 10 }, (_, index) => ({
                    sceneNumber: index + 1,
                    imageSlot: `[Image #${index + 1}]`,
                    storyBeat: index === 0 ? 'hook' : 'setup',
                    topTitle: '우로보로스',
                    caption: '핵심 정리',
                    narration: '국산 하네스 엔지니어링과 우로보로스를 원문 기준으로 봅니다.',
                    imagePrompt: 'comic style engineering workflow, no readable text',
                    visualText: '핵심 정리',
                    visual: { topTitle: '우로보로스', mainCaption: '핵심 정리' },
                    claimType: 'fact',
                    sourceRefs: ['source-1', 'source-2'],
                    durationSec: 5,
                })),
                cta: '원문을 확인하세요',
                totalDurationSec: 50,
            }),
            model: 'gpt-test',
            inputTokens: 1,
            outputTokens: 1,
            latencyMs: 1,
        });

        await contentBlock.execute({
            collectionMode: 'url',
            primaryUrl: 'https://myip.co.kr/board/read.php?id=2070',
            keywords: ['우로보로스'],
            articles: [
                {
                    id: 'source-1',
                    title: '국산 하네스 엔지니어링',
                    url: 'https://myip.co.kr/board/read.php?id=2070',
                    source: 'myip.co.kr',
                    primarySource: true,
                    sourcePriority: 1,
                    fullText: '국산 하네스 엔지니어링 사례와 우로보로스 프로젝트 배경을 설명합니다.',
                    keyClaims: ['국산 하네스 엔지니어링', '우로보로스 프로젝트'],
                },
                {
                    id: 'source-2',
                    title: 'Hacker News Korea 반응',
                    url: 'https://news.hada.io/topic?id=27344',
                    source: 'news.hada.io',
                    primarySource: true,
                    sourcePriority: 2,
                    fullText: '우로보로스에 대한 개발자 커뮤니티 반응과 기술 맥락을 정리합니다.',
                    keyClaims: ['개발자 커뮤니티 반응', '기술 맥락'],
                },
            ],
        });

        const request = vi.mocked(openaiAdapter.chatJson).mock.calls[0]?.[0];
        expect(request?.userMessage).toContain('PRIMARY SOURCES');
        expect(request?.userMessage).toContain('sourcePriority=1');
        expect(request?.userMessage).toContain('국산 하네스 엔지니어링 사례');
        expect(request?.userMessage).toContain('sourcePriority=2');
        expect(request?.userMessage).toContain('개발자 커뮤니티 반응');
    });
});
