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

    it('honors the requested shorts scene count instead of the legacy 10-15 range', async () => {
        vi.mocked(openaiAdapter.chatJson).mockResolvedValueOnce({
            content: JSON.stringify({
                title: '8장 쇼츠',
                hook: '8장으로 갑니다',
                script: {
                    hook: '8장으로 갑니다',
                    angle: '사용자가 선택한 장면 수를 따른다',
                    cta: '선택한 장수로 끝냅니다',
                },
                style: { format: 'vertical-shorts', aspectRatio: '9:16', sceneCount: 8 },
                scenes: Array.from({ length: 8 }, (_, index) => ({
                    sceneNumber: index + 1,
                    imageSlot: `[Image #${index + 1}]`,
                    storyBeat: index === 0 ? 'hook' : 'setup',
                    topTitle: '8장 쇼츠',
                    caption: `장면 ${index + 1}`,
                    narration: `사용자가 고른 여덟 장 쇼츠의 ${index + 1}번째 장면입니다.`,
                    imagePrompt: `shorts scene ${index + 1}`,
                    visualText: `장면 ${index + 1}`,
                    visual: { topTitle: '8장 쇼츠', mainCaption: `장면 ${index + 1}` },
                    claimType: 'fact',
                    sourceRefs: ['source-1'],
                    durationSec: 5,
                })),
                cta: '선택한 장수로 끝냅니다',
                totalDurationSec: 40,
                sources: [{ id: 'source-1', title: '원문', url: 'https://example.com', source: 'Example' }],
            }),
            model: 'gpt-test',
            inputTokens: 1,
            outputTokens: 1,
            latencyMs: 1,
        });

        const result = await contentBlock.execute(
            {
                format: 'shorts',
                keywords: ['테스트'],
                articles: [{ id: 'source-1', title: '원문', url: 'https://example.com', source: 'Example' }],
            },
            { scenes: 8 }
        );

        const request = vi.mocked(openaiAdapter.chatJson).mock.calls[0]?.[0];
        expect(request?.systemPrompt).toContain('exactly 8 scenes');
        expect(request?.systemPrompt).not.toContain('10–15 scene');
        expect((result.output['scenes'] as unknown[]).length).toBe(8);
        expect(result.output['style']).toMatchObject({ sceneCount: 8 });
    });

    it('plans a single image as an image prompt artifact without Shorts script instructions', async () => {
        vi.mocked(openaiAdapter.chatJson).mockResolvedValueOnce({
            content: JSON.stringify({
                title: '바나나 댄스',
                hook: '춤추는 바나나',
                script: {
                    hook: '춤추는 바나나',
                    angle: '단일 이미지 프롬프트',
                    cta: '',
                },
                style: { format: 'single-image', aspectRatio: '9:16', sceneCount: 1 },
                scenes: [
                    {
                        sceneNumber: 1,
                        imageSlot: '[Image #1]',
                        storyBeat: 'single-image',
                        topTitle: '바나나 댄스',
                        caption: '춤추는 바나나',
                        narration: '바나나가 무대 위에서 춤추는 장면입니다.',
                        imagePrompt:
                            'A cheerful banana dancing under colorful stage lights, playful studio backdrop, dynamic pose, polished 3D character illustration',
                        visualText: '춤추는 바나나',
                        visual: { topTitle: '바나나 댄스', mainCaption: '춤추는 바나나' },
                        claimType: 'opinion',
                        sourceRefs: [],
                        durationSec: 5,
                    },
                ],
                cta: '',
                totalDurationSec: 5,
                sources: [],
            }),
            model: 'gpt-test',
            inputTokens: 1,
            outputTokens: 1,
            latencyMs: 1,
        });

        const result = await contentBlock.execute(
            {
                requestTopic: '바나나가 춤추는 이미지 생성해줘',
                requestSpec: {
                    userRequest: '바나나가 춤추는 이미지 생성해줘',
                    contentIntent: 'single-image',
                    outputKind: 'image',
                    focusTerms: ['바나나', '춤'],
                    exactSubjectRequired: true,
                },
            },
            { mode: 'single-image' }
        );

        const request = vi.mocked(openaiAdapter.chatJson).mock.calls[0]?.[0];
        expect(request?.systemPrompt).toContain('image prompt planner');
        expect(request?.systemPrompt).not.toContain('Shorts Director');
        expect(request?.systemPrompt).not.toContain('YouTube Shorts');
        expect(result.output).toMatchObject({
            mode: 'single-image',
            outputKind: 'image-prompt',
            promptPlan: {
                title: '바나나 댄스',
                imagePrompt:
                    'A cheerful banana dancing under colorful stage lights, playful studio backdrop, dynamic pose, polished 3D character illustration',
            },
            style: { format: 'single-image', sceneCount: 1 },
        });
    });

    it('normalizes nullable source URLs from AI shorts output instead of failing generic topic runs', async () => {
        vi.mocked(openaiAdapter.chatJson).mockResolvedValueOnce({
            content: JSON.stringify({
                title: '편입 정보',
                hook: '편입 준비, 뭐부터?',
                script: {
                    hook: '편입 준비, 뭐부터?',
                    angle: '편입 준비의 기본 흐름을 설명',
                    cta: '모집요강을 확인하세요',
                },
                scenes: Array.from({ length: 10 }, (_, index) => ({
                    sceneNumber: index + 1,
                    imageSlot: `[Image #${index + 1}]`,
                    storyBeat: index === 0 ? 'hook' : 'setup',
                    topTitle: '편입 정보',
                    caption: '핵심 정리',
                    narration: '편입 준비는 모집요강 확인부터 시작합니다.',
                    imagePrompt: 'student checking university transfer admission guide at desk',
                    visualText: '핵심 정리',
                    visual: { topTitle: '편입 정보', mainCaption: '핵심 정리' },
                    claimType: 'fact',
                    sourceRefs: [{ id: 'source-1', title: '일반 편입 정보', url: null }],
                    durationSec: 5,
                })),
                cta: '모집요강을 확인하세요',
                totalDurationSec: 50,
                sources: [{ id: 'source-1', title: '일반 편입 정보', url: null, source: 'AI generated context' }],
            }),
            model: 'gpt-test',
            inputTokens: 1,
            outputTokens: 1,
            latencyMs: 1,
        });

        const result = await contentBlock.execute(
            {
                format: 'shorts',
                topic: '편입정보',
                durationSec: 60,
                scenes: 8,
            },
            { contentProfileId: 'shorts.info.v1' }
        );

        expect(result.output['sources']).toEqual([
            expect.objectContaining({ id: 'source-1', title: '일반 편입 정보' }),
        ]);
        expect((result.output['sources'] as Array<Record<string, unknown>>)[0]?.['url']).toBeUndefined();
        expect((result.output['scenes'] as Array<Record<string, unknown>>)[0]?.['sourceRefs']).toEqual([
            expect.objectContaining({ id: 'source-1', title: '일반 편입 정보' }),
        ]);
    });

    it('backfills sourceRefs for sourced fact scenes when the model omits them', async () => {
        vi.mocked(openaiAdapter.chatJson).mockResolvedValueOnce({
            content: JSON.stringify({
                title: '원문 기반 쇼츠',
                hook: '핵심만 보겠습니다',
                script: {
                    hook: '핵심만 보겠습니다',
                    angle: '원문 기반 설명',
                    cta: '원문도 확인하세요',
                },
                scenes: Array.from({ length: 10 }, (_, index) => ({
                    sceneNumber: index + 1,
                    imageSlot: `[Image #${index + 1}]`,
                    storyBeat: index === 0 ? 'hook' : 'setup',
                    topTitle: '원문 기반 쇼츠',
                    caption: '핵심 정리',
                    narration: '원문에서 확인한 핵심 내용을 짧게 설명합니다.',
                    imagePrompt: 'A Korean viewer reading an article on a phone',
                    visualText: '핵심 정리',
                    visual: { topTitle: '원문 기반 쇼츠', mainCaption: '핵심 정리' },
                    claimType: 'fact',
                    sourceRefs: [],
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

        const result = await contentBlock.execute({
            articles: [{ id: 'source-1', title: '원문 기사', url: 'https://example.com', source: 'Example' }],
        });

        const firstScene = (result.output['scenes'] as Array<Record<string, unknown>>)[0];
        expect(firstScene).toMatchObject({
            claimType: 'fact',
            sourceRefs: ['source-1'],
        });
    });

    it('downgrades unsourced non-concrete fact labels instead of sending them to analysis as sourced facts', async () => {
        vi.mocked(openaiAdapter.chatJson).mockResolvedValueOnce({
            content: JSON.stringify({
                title: '생활 습관 쇼츠',
                hook: '천천히 바꿔보세요',
                script: {
                    hook: '천천히 바꿔보세요',
                    angle: '일반 생활 조언',
                    cta: '무리하지 마세요',
                },
                scenes: Array.from({ length: 10 }, (_, index) => ({
                    sceneNumber: index + 1,
                    imageSlot: `[Image #${index + 1}]`,
                    storyBeat: index === 0 ? 'hook' : 'setup',
                    topTitle: '생활 습관 쇼츠',
                    caption: '습관 조정',
                    narration: '식사와 활동 습관을 천천히 바꾸는 접근이 좋습니다.',
                    imagePrompt: 'A calm everyday lifestyle scene',
                    visualText: '습관 조정',
                    visual: { topTitle: '생활 습관 쇼츠', mainCaption: '습관 조정' },
                    claimType: 'fact',
                    sourceRefs: [],
                    durationSec: 5,
                })),
                cta: '무리하지 마세요',
                totalDurationSec: 50,
            }),
            model: 'gpt-test',
            inputTokens: 1,
            outputTokens: 1,
            latencyMs: 1,
        });

        const result = await contentBlock.execute({
            topic: '생활 습관 조언',
        });

        const firstScene = (result.output['scenes'] as Array<Record<string, unknown>>)[0];
        expect(firstScene).toMatchObject({
            claimType: 'opinion',
            sourceRefs: [],
        });
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

    it('passes the exact requested subject into shorts writing even when web search returns broad sources', async () => {
        vi.mocked(openaiAdapter.chatJson).mockResolvedValueOnce({
            content: JSON.stringify({
                title: '무한도전 YES or NO',
                hook: 'YES or NO 왜 떴지?',
                script: {
                    hook: 'YES or NO 왜 떴지?',
                    angle: '요청한 특정 편을 설명한다',
                    cta: '다음 편도 확인하세요',
                },
                scenes: Array.from({ length: 10 }, (_, index) => ({
                    sceneNumber: index + 1,
                    imageSlot: `[Image #${index + 1}]`,
                    storyBeat: index === 0 ? 'hook' : 'setup',
                    topTitle: 'YES or NO 편',
                    caption: '선택 구조',
                    narration: 'YES or NO 편의 선택 구조를 설명합니다.',
                    imagePrompt: 'variety show yes or no decision board',
                    visualText: '선택 구조',
                    visual: { topTitle: 'YES or NO 편', mainCaption: '선택 구조' },
                    claimType: 'opinion',
                    sourceRefs: [],
                    durationSec: 5,
                })),
                cta: '다음 편도 확인하세요',
                totalDurationSec: 50,
            }),
            model: 'gpt-test',
            inputTokens: 1,
            outputTokens: 1,
            latencyMs: 1,
        });

        await contentBlock.execute(
            {
                requestTopic: '쇼츠생성해줘. 무한도전 yes or no 편 설명',
                keywords: ['무한도전 yes or no', '무한도전 레전드 편'],
                articles: [
                    {
                        id: 'source-1',
                        title: "'무한도전', 웹툰 연재에 도전",
                        url: 'https://blog.mbc.co.kr/1759',
                        source: 'MBC 블로그',
                        summary:
                            "특정 'yes or no' 편 자체를 설명하진 않지만, 무한도전의 실험적 포맷을 이해하는 참고 근거입니다.",
                    },
                ],
            },
            { topic: '쇼츠생성해줘. 무한도전 yes or no 편 설명', scenes: 10 }
        );

        const request = vi.mocked(openaiAdapter.chatJson).mock.calls[0]?.[0];
        expect(request?.userMessage).toContain('REQUESTED SUBJECT');
        expect(request?.userMessage).toContain('REQUEST SPEC');
        expect(request?.userMessage).toContain('SOURCE COVERAGE');
        expect(request?.userMessage).toContain('무한도전 yes or no 편 설명');
        expect(request?.systemPrompt).toContain('Do not broaden a specific requested subject into its parent topic');
        expect(request?.systemPrompt).toContain('SourceCoverage');
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

    it('uses creative simulation rules for hypothetical battle Shorts instead of generic explainer writing', async () => {
        vi.mocked(openaiAdapter.chatJson).mockResolvedValueOnce({
            content: JSON.stringify({
                title: '나루토 VS 고죠',
                hook: '처음부터 풀전력',
                script: {
                    hook: '처음부터 풀전력',
                    angle: '가상 전투를 액션 비트로 전개',
                    cta: '다음 대결도 남겨줘',
                },
                style: { format: 'vertical-shorts', aspectRatio: '9:16', sceneCount: 10 },
                scenes: Array.from({ length: 10 }, (_, index) => ({
                    sceneNumber: index + 1,
                    imageSlot: `[Image #${index + 1}]`,
                    storyBeat: index === 0 ? 'opening-condition' : 'combat-beat',
                    topTitle: '나루토 VS 고죠',
                    caption: index === 0 ? '풀전력 시작' : `공방 ${index + 1}`,
                    narration:
                        index === 0
                            ? '나루토가 처음부터 쿠라마 모드로 전장을 밀어붙입니다.'
                            : index === 4
                              ? '하지만 마지막 거리에서 공격은 끝없이 느려집니다.'
                              : `가상 전투의 ${index + 1}번째 공방이 이어집니다.`,
                    imagePrompt:
                        index === 4
                            ? 'A high-energy fictional crossover battle beat where a glowing warrior charge stops inches before a calm sorcerer, invisible space distortion between them'
                            : `A cinematic fictional crossover battle beat ${index + 1}, two powerful fighters testing distance and timing`,
                    visualText: index === 0 ? '풀전력 시작' : `공방 ${index + 1}`,
                    visual: {
                        topTitle: '나루토 VS 고죠',
                        mainCaption: index === 0 ? '풀전력 시작' : `공방 ${index + 1}`,
                    },
                    claimType: 'hypothetical',
                    sourceRefs: [],
                    durationSec: 5,
                })),
                cta: '다음 대결도 남겨줘',
                totalDurationSec: 50,
                sources: [],
            }),
            model: 'gpt-test',
            inputTokens: 1,
            outputTokens: 1,
            latencyMs: 1,
        });

        const result = await contentBlock.execute({
            requestTopic: '나루토와 주술회전의 고죠 사토루가 싸우면 누가 이길까? 그걸 그린 쇼츠를 만들어줘',
            requestSpec: {
                userRequest: '나루토와 주술회전의 고죠 사토루가 싸우면 누가 이길까? 그걸 그린 쇼츠를 만들어줘',
                contentIntent: 'shorts',
                outputKind: 'video',
                contentMode: 'creative-simulation',
                focusTerms: ['나루토', '고죠', '사토루'],
                exactSubjectRequired: true,
            },
        });

        const request = vi.mocked(openaiAdapter.chatJson).mock.calls[0]?.[0];
        expect(request?.systemPrompt).toContain('Creative Simulation Shorts Rulepack');
        expect(request?.systemPrompt).toContain('simulation beat');
        expect(request?.systemPrompt).toContain('Image Prompt Rules');
        expect(request?.systemPrompt).toContain('Do not stop the sequence to lecture');
        expect(request?.systemPrompt).toContain('Each scene must change the fight state');
        expect(request?.systemPrompt).toContain('Avoid absolute winner wording');
        expect(request?.systemPrompt).toContain('claimType: hypothetical');
        expect(result.output).toMatchObject({
            requestSpec: expect.objectContaining({ contentMode: 'creative-simulation' }),
        });
        expect((result.output['scenes'] as Array<Record<string, unknown>>)[0]).toMatchObject({
            claimType: 'hypothetical',
            sourceRefs: [],
        });
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
        expect(request?.systemPrompt).toContain('longform planning artifacts');
        expect(request?.systemPrompt).not.toContain('Longform Gate A');
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
