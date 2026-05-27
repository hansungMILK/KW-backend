import { beforeEach, describe, expect, it, vi } from 'vitest';

import { countryballBriefBlock } from './countryball-brief-block';
import { openaiAdapter } from '../../adapters/ai/openai-adapter';

vi.mock('../../config/env', () => ({
    env: {
        orchestratorMode: 'openai',
        openaiModel: 'gpt-test',
        openaiContentMaxTokens: 4096,
    },
}));

vi.mock('../../adapters/ai/openai-adapter', () => ({
    openaiAdapter: {
        chatJson: vi.fn(async () => ({
            content: JSON.stringify({
                targetCountry: '한국',
                storyGenre: '역사 다큐 / 감동',
                targetFeature: '리비아 대수로 공사',
                mainConflict: '다른 국가볼들이 사막에 물을 끌 수 없다고 포기한다',
                skitPremise: '리비아공이 목마른 사막에서 울고, 한국공이 굴착기와 송수관으로 물을 터뜨리는 상황극',
                setting: '리비아 사막 공사 현장',
                comicMechanism: '강대국공들이 포기하고 철수한 뒤 한국공이 묵묵히 밀어붙여 감동 반전을 만든다',
                emotionalArc: '절망 -> 포기 -> 한국공 등장 -> 물기둥 -> 감격',
                payoff: '물기둥 앞에서 리비아공이 울고 한국공이 조용히 웃는다',
                recommendedSceneCount: 6,
                scriptVariables: {
                    targetCountry: '한국공',
                    targetFeature: '리비아 대수로 공사',
                    comparisonCountries: ['리비아공', '미국공'],
                    mainConflict: '강대국이 포기한 사막 물 공급을 한국공이 해낸다',
                    storyGenre: '역사 다큐 / 감동',
                    BGM_Track_A: '메마른 바람',
                    BGM_Track_B: '웅장한 오케스트라',
                    visualTheme: '도전 / 감동',
                },
                storyFlow: [
                    '리비아볼이 사막에서 말라간다',
                    '강대국볼들이 손사래치며 철수한다',
                    '한국볼이 굴착기와 송수관을 들고 등장한다',
                    '물이 터지자 리비아볼과 외국볼들이 눈물 흘린다',
                ],
                cast: [
                    { country: '한국', role: '불가능한 공사를 밀어붙이는 주인공', voiceRole: 'main_confident' },
                    { country: '리비아', role: '물을 기다리는 의뢰자', voiceRole: 'main_tired' },
                    { country: '미국', role: '포기하고 철수하는 강대국', voiceRole: 'rival_smug' },
                ],
                visualTheme: '도전 / 감동',
                soundMapping: {
                    opening: '메마른 바람',
                    turn: '굴착기 엔진',
                    payoff: '웅장한 오케스트라',
                },
                endingPayoff: '한국볼이 물기둥 앞에서 조용히 웃고 리비아볼이 울먹인다',
                speechFlavorPlan: {
                    default: 'readable Korean',
                    countryNotes: [{ country: '미국', flavor: '거만하지만 짧은 교포 말투' }],
                },
                voiceRolePlan: {
                    main: 'main_confident',
                    rival: 'rival_smug',
                    panic: 'panic_high',
                },
                thumbnailTexts: ['사막에 강을 만든 한국', '외국공들이 포기한 공사'],
            }),
            model: 'gpt-test',
            inputTokens: 1,
            outputTokens: 1,
            latencyMs: 1,
        })),
    },
}));

describe('countryballBriefBlock', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('turns countryball user intent and optional sources into a skit production brief', async () => {
        const requestSpec = {
            userRequest: '국뽕 컨트리볼쇼츠 주제 추천해서 리비아 대수로 공사로 만들어줘',
            contentIntent: 'shorts',
            outputKind: 'video',
            focusTerms: ['국뽕', '컨트리볼', '리비아 대수로'],
            exactSubjectRequired: true,
        };

        const result = await countryballBriefBlock.execute({
            requestTopic: requestSpec.userRequest,
            requestSpec,
            keywords: ['리비아 대수로', '한국 건설'],
            articles: [
                {
                    id: 'source-1',
                    title: '리비아 대수로 자료',
                    url: 'https://example.com/libya-water',
                    source: 'Example',
                    summary: '한국 건설사가 참여한 리비아 대수로 공사 요약',
                },
            ],
        });

        const request = vi.mocked(openaiAdapter.chatJson).mock.calls[0]?.[0];
        expect(request?.systemPrompt).toContain('countryball skit writer brief strategist');
        expect(request?.systemPrompt).toContain('not a generic source search');
        expect(request?.systemPrompt).toContain('storyGenre');
        expect(request?.systemPrompt).toContain('targetFeature');
        expect(request?.systemPrompt).toContain('mainConflict');
        expect(request?.systemPrompt).toContain('skitPremise');
        expect(request?.systemPrompt).toContain('comicMechanism');
        expect(request?.systemPrompt).toContain('emotionalArc');
        expect(request?.systemPrompt).toContain('speechFlavorPlan');
        expect(request?.systemPrompt).toContain('voiceRolePlan');
        expect(request?.systemPrompt).toContain('The brief must preserve explicit user plot order');
        expect(request?.systemPrompt).toContain('recommendedSceneCount');
        expect(request?.systemPrompt).toContain('scriptVariables');
        expect(request?.systemPrompt).toContain('explicit plot order');
        expect(request?.systemPrompt).toContain('storyFlow');
        expect(request?.systemPrompt).not.toContain('"recommendedSceneCount": 9');
        expect(request?.systemPrompt).not.toContain('AI_DECIDES_OR_REQUESTED_COUNT');
        expect(request?.systemPrompt).toContain('"recommendedSceneCount": number');
        expect(request?.userMessage).toContain('리비아 대수로');

        expect(result.output).toMatchObject({
            mode: 'countryball-brief',
            presetId: 'countryball-shorts',
            countryballBrief: expect.objectContaining({
                targetCountry: '한국',
                storyGenre: '역사 다큐 / 감동',
                targetFeature: '리비아 대수로 공사',
                mainConflict: expect.stringContaining('사막에 물'),
                skitPremise: expect.stringContaining('사막'),
                setting: expect.stringContaining('리비아'),
                comicMechanism: expect.stringContaining('강대국공'),
                emotionalArc: expect.stringContaining('한국공'),
                payoff: expect.stringContaining('물기둥'),
                recommendedSceneCount: 6,
                scriptVariables: expect.objectContaining({
                    BGM_Track_B: '웅장한 오케스트라',
                    visualTheme: '도전 / 감동',
                }),
                storyFlow: expect.arrayContaining([expect.stringContaining('굴착기')]),
                speechFlavorPlan: expect.objectContaining({ default: 'readable Korean' }),
                voiceRolePlan: expect.objectContaining({ main: 'main_confident' }),
                visualTheme: '도전 / 감동',
                endingPayoff: expect.stringContaining('물기둥'),
            }),
            articles: [expect.objectContaining({ id: 'source-1' })],
            requestSpec,
        });

        const brief = result.output['countryballBrief'] as { recommendedSceneCount: number; storyFlow: string[] };
        expect(brief.storyFlow).toHaveLength(brief.recommendedSceneCount);
    });

    it('keeps generic topics actable without falling back to a fixed shock plot or fixed scene count', async () => {
        vi.mocked(openaiAdapter.chatJson).mockResolvedValueOnce({
            content: JSON.stringify({
                targetCountry: '한국',
                storyGenre: '일상 코미디 / 국뽕',
                targetFeature: '밤늦게 주문하고 아침에 도착하는 새벽배송',
                mainConflict: '외국공들은 밤 주문이 며칠 걸린다고 생각하지만 한국공은 몇 시간 뒤 문 앞 배송을 보여준다',
                skitPremise:
                    '미국공과 일본공이 밤 11시에 주문하면 망했다고 걱정하는데, 한국공이 자고 일어나 문 앞 택배를 보여주는 상황극',
                setting: '밤 11시 아파트 복도와 다음 날 아침 현관 앞',
                comicMechanism: '외국공들의 불안한 계산과 한국공의 너무 당연한 반응이 대비된다',
                emotionalArc: '불신 -> 걱정 -> 잠깐 자고 옴 -> 현관 앞 충격 -> 한국공의 덤덤한 마무리',
                payoff: '한국공이 문 앞 박스를 가리키며 "아침밥보다 먼저 왔네"라고 말한다',
                recommendedSceneCount: 8,
                storyFlow: [
                    '밤 11시, 외국공들이 배송 앱 시간을 보고 얼어붙는다',
                    '미국공이 내일은 무리라고 계산기를 두드린다',
                    '일본공이 택배가 길을 잃는 상상을 한다',
                    '한국공이 아무렇지 않게 주문 버튼을 누른다',
                    '새벽 복도에서 배송 박스가 조용히 쌓인다',
                    '아침 현관 앞에서 외국공들이 박스를 보고 굳는다',
                    '한국공이 박스를 열며 태연하게 아침을 준비한다',
                    '외국공들이 한국 배송 시스템을 보고 말문이 막힌다',
                ],
                cast: [
                    { country: '한국', role: '새벽배송을 당연하게 쓰는 주인공', voiceRole: 'main_confident' },
                    { country: '미국', role: '배송 속도를 믿지 못하는 비교군', voiceRole: 'rival_smug' },
                    { country: '일본', role: '과하게 걱정하는 리액션 담당', voiceRole: 'panic_high' },
                ],
                visualTheme: '일상 속 속도감 / 문화 충격',
                soundMapping: { opening: '밤 골목 ambience', turn: '앱 주문 효과음', payoff: '아침 문 앞 띵동' },
                endingPayoff: '한국공이 문 앞 택배를 태연하게 들어 올린다',
                speechFlavorPlan: {
                    default: 'readable Korean',
                    countryNotes: [
                        { country: '미국', flavor: '가벼운 교포 말투' },
                        { country: '일본', flavor: '짧은 감탄형만 자연스럽게' },
                    ],
                },
                voiceRolePlan: { main: 'main_confident', rival: 'rival_smug', panic: 'panic_high' },
                thumbnailTexts: ['밤에 시켰는데 아침 도착', '외국공 멘붕한 한국 배송'],
            }),
            model: 'gpt-test',
            inputTokens: 1,
            outputTokens: 1,
            latencyMs: 1,
        });

        const result = await countryballBriefBlock.execute({
            requestTopic: '컨트리볼쇼츠제작. 주제: 밤늦게 주문하고 아침에 도착하는 한국 국뽕 쇼츠',
        });

        const brief = result.output['countryballBrief'] as {
            recommendedSceneCount: number;
            skitPremise: string;
            comicMechanism: string;
            storyFlow: string[];
        };
        expect(brief.recommendedSceneCount).toBe(8);
        expect(brief.skitPremise).toContain('상황극');
        expect(brief.comicMechanism).toContain('대비');
        expect(brief.storyFlow).toHaveLength(8);
        expect(brief.storyFlow.join(' ')).toContain('아침 현관');
    });
});
