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

    it('uses a saved reviewed script without calling the AI writer again', async () => {
        const reviewedOutput = {
            title: '검수된 대본',
            hook: '검수된 훅입니다',
            script: {
                hook: '검수된 훅입니다',
                angle: '사용자가 직접 검수한 대본을 사용',
                cta: '검수본으로 이어갑니다',
            },
            scenes: Array.from({ length: 10 }, (_, index) => ({
                sceneNumber: index + 1,
                imageSlot: `[Image #${index + 1}]`,
                storyBeat: index === 0 ? 'hook' : 'setup',
                topTitle: '검수된 대본',
                caption: `검수 자막 ${index + 1}`,
                narration: `검수된 내레이션 ${index + 1}입니다.`,
                imagePrompt: `reviewed scene ${index + 1}`,
                visualText: `검수 자막 ${index + 1}`,
                visual: { topTitle: '검수된 대본', mainCaption: `검수 자막 ${index + 1}` },
                claimType: 'fact',
                sourceRefs: ['source-1'],
                durationSec: 5,
            })),
            cta: '검수본으로 이어갑니다',
            totalDurationSec: 50,
        };

        const result = await contentBlock.execute(
            {
                articles: [{ id: 'source-1', title: '원문', url: 'https://example.com', source: 'Example' }],
            },
            { reviewedOutput: JSON.stringify(reviewedOutput) }
        );

        expect(openaiAdapter.chatJson).not.toHaveBeenCalled();
        expect(result.output).toMatchObject({
            title: '검수된 대본',
            hook: '검수된 훅입니다',
            scenes: expect.arrayContaining([expect.objectContaining({ narration: '검수된 내레이션 1입니다.' })]),
        });
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
                    imagePrompt:
                        'AI subscription checkout scene with app screen and cautious user, concise in-scene text allowed',
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
        expect(request?.systemPrompt).toContain("article's factual spine");
        expect(request?.systemPrompt).toContain('style-neutral visual content brief');
        expect(request?.systemPrompt).toContain('media-image block applies the selected visual style later');
        expect(request?.systemPrompt).not.toContain('vertical comic Shorts plan');
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
                    imagePrompt:
                        'engineering workflow scene with wiring harness and software diagram, concise in-scene text allowed',
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

    it('injects selected script tone rules into the Shorts writer prompt', async () => {
        vi.mocked(openaiAdapter.chatJson).mockResolvedValueOnce({
            content: JSON.stringify({
                title: '뉴스 톤 테스트',
                hook: '핵심만 보겠습니다',
                script: {
                    hook: '핵심만 보겠습니다',
                    angle: '뉴스앵커형 톤 테스트',
                    cta: '원문도 확인하세요',
                },
                scenes: Array.from({ length: 10 }, (_, index) => ({
                    sceneNumber: index + 1,
                    imageSlot: `[Image #${index + 1}]`,
                    storyBeat: index === 0 ? 'hook' : 'setup',
                    topTitle: '뉴스 톤 테스트',
                    caption: '핵심 정리',
                    narration: '사실 관계를 차분하게 확인합니다.',
                    imagePrompt: 'neutral newsroom evidence scene',
                    visualText: '핵심 정리',
                    visual: { topTitle: '뉴스 톤 테스트', mainCaption: '핵심 정리' },
                    claimType: 'fact',
                    sourceRefs: ['source-1'],
                    durationSec: 5,
                })),
                cta: '원문도 확인하세요',
                totalDurationSec: 50,
            }),
            model: 'gpt-test',
            inputTokens: 1,
            outputTokens: 1,
            latencyMs: 1,
        });

        await contentBlock.execute(
            {
                articles: [
                    {
                        id: 'source-1',
                        title: 'AI 뉴스',
                        url: 'https://example.com/news',
                        source: 'Example',
                    },
                ],
            },
            {
                scriptToneId: 'news-anchor',
                scriptToneIntensity: 'high',
                contentProfileId: 'shorts.info.v1',
                reviewMode: 'script-first',
            }
        );

        const request = vi.mocked(openaiAdapter.chatJson).mock.calls[0]?.[0];
        expect(request?.systemPrompt).toContain('Script Tone Rulepack: news-anchor');
        expect(request?.systemPrompt).toContain('뉴스 앵커처럼');
        expect(request?.systemPrompt).toContain('Tone intensity: high');
        expect(request?.systemPrompt).toContain('Review mode: script-first');
        expect(request?.systemPrompt).toContain('Content profile: shorts.info.v1');
    });

    it('keeps generic text mode free of paid media and script-review instructions', async () => {
        await contentBlock.execute(
            {
                keywords: ['KTX', '예매'],
                articles: [{ id: 'source-1', title: 'KTX 기사', url: 'https://example.com', source: 'Example' }],
            },
            {
                mode: 'explain',
                scriptToneId: 'calm-explainer',
                scriptToneIntensity: 'low',
                contentProfileId: 'text.explainer.v1',
                reviewMode: 'script-first',
            }
        );

        const request = vi.mocked(openaiAdapter.chatJson).mock.calls[0]?.[0];
        expect(request?.systemPrompt).toContain('Content Preference: text.explainer.v1');
        expect(request?.systemPrompt).toContain('Tone preference: calm-explainer');
        expect(request?.systemPrompt).not.toContain('paid media generation');
        expect(request?.systemPrompt).not.toContain('Script Tone Rulepack');
    });

    it('generates a longform Gate A artifact without forcing a Shorts scene contract', async () => {
        vi.mocked(openaiAdapter.chatJson).mockResolvedValueOnce({
            content: JSON.stringify({
                sourceDigest: ['AI 에이전트 시장은 업무 자동화와 실행형 워크플로우로 확장 중입니다.'],
                outline: [
                    { title: '왜 지금 AI 에이전트인가', summary: '단순 챗봇에서 실행형 도구로 이동' },
                    { title: '기존 자동화와 다른 점', summary: '계획, 실행, 검증을 연결' },
                ],
                fullScriptDraft:
                    'AI 에이전트의 미래를 이해하려면 챗봇이 아니라 실행 흐름을 봐야 합니다. 앞으로 핵심은 대화가 아니라 업무 완결성입니다.',
                scenePlan: [
                    { sceneNumber: 1, title: '문제 제기', visualPlan: '업무 도구가 쌓인 데스크', durationSec: 35 },
                    {
                        sceneNumber: 2,
                        title: '개념 설명',
                        visualPlan: '에이전트가 앱을 연결하는 다이어그램',
                        durationSec: 45,
                    },
                ],
                estimatedDurationSec: 240,
                estimatedCost: { currency: 'USD', total: 0.18, notes: ['Gate A planning only'] },
                rendererRoute: 'hyperframes',
                qaChecklist: ['출처 확인', '대본 검수', '씬 승인'],
            }),
            model: 'gpt-test',
            inputTokens: 1,
            outputTokens: 1,
            latencyMs: 1,
        });

        const result = await contentBlock.execute(
            {
                keywords: ['AI 에이전트'],
                articles: [
                    { id: 'source-1', title: 'AI 에이전트 기사', url: 'https://example.com', source: 'Example' },
                ],
            },
            {
                mode: 'longform-gate-a',
                contentProfileId: 'longform.explainer.v1',
                rendererRoute: 'hyperframes',
            }
        );

        const request = vi.mocked(openaiAdapter.chatJson).mock.calls[0]?.[0];
        expect(request?.systemPrompt).toContain('Longform Gate A');
        expect(request?.systemPrompt).not.toContain('10–15 scene');
        expect(result.output).toMatchObject({
            gate: 'A',
            mode: 'longform-gate-a',
            outline: expect.any(Array),
            fullScriptDraft: expect.stringContaining('AI 에이전트의 미래'),
            scenePlan: expect.any(Array),
            estimatedDurationSec: 240,
            estimatedCost: expect.objectContaining({ total: 0.18 }),
            rendererRoute: 'hyperframes',
            mediaExecutionAllowed: false,
        });
        expect(result.output['scenes']).toBeUndefined();
    });

    it('uses configured longform target duration instead of trusting a mismatched model estimate', async () => {
        vi.mocked(openaiAdapter.chatJson).mockResolvedValueOnce({
            content: JSON.stringify({
                sourceDigest: ['자료 요약'],
                outline: [{ title: '핵심', summary: '요약' }],
                fullScriptDraft: 'AI 에이전트의 미래를 10분 분량으로 설명하는 롱폼 대본 초안입니다.',
                scenePlan: [{ sceneNumber: 1, title: '도입', visualPlan: '업무 화면', durationSec: 35 }],
                estimatedDurationSec: 240,
                rendererRoute: 'hyperframes',
            }),
            model: 'gpt-test',
            inputTokens: 1,
            outputTokens: 1,
            latencyMs: 1,
        });

        const result = await contentBlock.execute(
            { keywords: ['AI 에이전트'] },
            {
                mode: 'longform-gate-a',
                contentProfileId: 'longform.explainer.v1',
                targetDurationSec: 600,
                maxDurationSec: 600,
            }
        );

        expect(result.output).toMatchObject({
            estimatedDurationSec: 600,
            maxDurationSec: 600,
        });
    });
});
