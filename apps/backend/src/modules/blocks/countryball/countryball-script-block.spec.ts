import { beforeEach, describe, expect, it, vi } from 'vitest';

import { COUNTRYBALL_SCRIPT_SYSTEM_PROMPT, countryballScriptBlock } from './countryball-script-block';
import { openaiAdapter } from '../../../adapters/ai/openai-adapter';

vi.mock('../../../config/env', () => ({
    env: {
        orchestratorMode: 'openai',
        openaiModel: 'gpt-test',
        openaiCountryballContentMaxTokens: 8192,
    },
}));

vi.mock('../../../adapters/ai/openai-adapter', () => ({
    openaiAdapter: {
        chatJson: vi.fn(),
    },
}));

describe('countryballScriptBlock prompt contract', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('instructs Korean countryball dialogue to use light character speech patterns', () => {
        expect(COUNTRYBALL_SCRIPT_SYSTEM_PROMPT).toContain('미국 볼');
        expect(COUNTRYBALL_SCRIPT_SYSTEM_PROMPT).toContain('외국인 교포 말투');
        expect(COUNTRYBALL_SCRIPT_SYSTEM_PROMPT).toContain('일본 볼');
        expect(COUNTRYBALL_SCRIPT_SYSTEM_PROMPT).toContain('Do not mechanically append suffixes');
        expect(COUNTRYBALL_SCRIPT_SYSTEM_PROMPT).toContain('말도 안 되므니다');
        expect(COUNTRYBALL_SCRIPT_SYSTEM_PROMPT).not.toContain('often ends short lines with ~데스');
    });

    it('requires one continuous skit from the brief spine', () => {
        expect(COUNTRYBALL_SCRIPT_SYSTEM_PROMPT).toContain('one continuous skit');
        expect(COUNTRYBALL_SCRIPT_SYSTEM_PROMPT).toContain('skitPremise');
        expect(COUNTRYBALL_SCRIPT_SYSTEM_PROMPT).toContain('comicMechanism');
        expect(COUNTRYBALL_SCRIPT_SYSTEM_PROMPT).toContain('emotionalArc');
        expect(COUNTRYBALL_SCRIPT_SYSTEM_PROMPT).toContain('payoff');
        expect(COUNTRYBALL_SCRIPT_SYSTEM_PROMPT).not.toContain('"recommendedSceneCount": 9');
        expect(COUNTRYBALL_SCRIPT_SYSTEM_PROMPT).not.toContain('AI_DECIDES_OR_REQUESTED_COUNT');
        expect(COUNTRYBALL_SCRIPT_SYSTEM_PROMPT).toContain('"recommendedSceneCount": number');
    });

    it('treats explicit user plot and AI-recommended scene count as binding', async () => {
        expect(COUNTRYBALL_SCRIPT_SYSTEM_PROMPT).toContain('explicit user plot');
        expect(COUNTRYBALL_SCRIPT_SYSTEM_PROMPT).toContain('exactly the requested scene count');

        vi.mocked(openaiAdapter.chatJson).mockResolvedValueOnce({
            content: JSON.stringify({
                title: '컨트리볼 태세전환',
                topic: '상대국이 주인공 국가볼의 핵심 특징을 무시하다가 직접 보고 태세 전환',
                recommendedSceneCount: 7,
                cast: [
                    {
                        country: '주인공',
                        role: '핵심 특징을 보여주는 국가볼',
                        defaultEmotion: 'confident',
                        voiceRole: 'main_confident',
                    },
                    {
                        country: '상대국',
                        role: '처음엔 의심하는 국가볼',
                        defaultEmotion: 'smug',
                        voiceRole: 'rival_smug',
                    },
                ],
                scenes: Array.from({ length: 7 }, (_, index) => makeScene(index + 1)),
                thumbnailTexts: ['보고 바로 태세전환'],
            }),
            model: 'gpt-test',
            inputTokens: 1,
            outputTokens: 1,
            latencyMs: 1,
        });

        const result = await countryballScriptBlock.execute({
            topic: '컨트리볼 쇼츠 만들어줘. 상대국이 처음에는 주인공 국가볼의 핵심 특징을 무시했는데 직접 보고 놀라서 태세 전환하는 플롯으로 가.',
            countryballBrief: {
                storyFlow: [
                    '상대국공이 주인공 국가볼의 제안을 무시한다',
                    '주인공 국가볼이 직접 보라고 제안한다',
                    '핵심 특징이 시각적으로 드러난다',
                    '상대국공이 눈 튀어나오며 태세 전환한다',
                ],
                cast: [
                    { country: '주인공', role: '핵심 특징 제안자', voiceRole: 'main_confident' },
                    { country: '상대국', role: '의심하는 상대역', voiceRole: 'rival_smug' },
                ],
                recommendedSceneCount: 7,
            },
        });

        expect((result.output['scenes'] as unknown[]).length).toBe(7);
        expect(vi.mocked(openaiAdapter.chatJson).mock.calls[0]?.[0].userMessage).toContain('SCENE COUNT:\n7');
        expect(result.output['metadata']).toEqual(expect.objectContaining({ recommendedSceneCount: 7 }));
    });

    it('uses the selected writer brain as the binding skit contract instead of raw source facts', async () => {
        vi.mocked(openaiAdapter.chatJson).mockResolvedValueOnce({
            content: JSON.stringify({
                title: '새벽 문앞 괴담',
                topic: '밤늦게 주문하고 아침에 도착하는 한국 새벽배송',
                recommendedSceneCount: 6,
                cast: [
                    {
                        country: '한국',
                        role: '새벽배송이 일상인 주인공',
                        defaultEmotion: 'calm',
                        voiceRole: 'main_confident',
                    },
                    {
                        country: '미국',
                        role: '새벽 문앞 소리를 침입으로 오해하는 리액션 담당',
                        defaultEmotion: 'panic',
                        voiceRole: 'panic_high',
                    },
                ],
                scenes: Array.from({ length: 6 }, (_, index) => makeScene(index + 1)),
                thumbnailTexts: ['새벽 4시 문앞 소리'],
            }),
            model: 'gpt-test',
            inputTokens: 1,
            outputTokens: 1,
            latencyMs: 1,
        });

        await countryballScriptBlock.execute({
            topic: '컨트리볼쇼츠제작. 주제: 밤늦게 주문하고 아침에 도착하는 한국 국뽕 쇼츠',
            mode: 'countryball-writer-brain',
            selectedAngleId: 'angle_1',
            writerBrain: {
                bestStoryAngle: '새벽배송을 물류 설명이 아니라 새벽 4시 문앞 괴담처럼 시작한다.',
                informationUseRule: '인프라 설명은 대사가 아니라 시간, 상자, 문앞 소리로만 보여준다.',
            },
            storyBrief: {
                setting: '한국볼의 방, 새벽 문앞 복도, 아침 식탁',
                sceneFlow: [
                    {
                        beat: 1,
                        scene: '밤 11시 30분 한국볼이 계란을 주문한다.',
                        characterAction: '미국볼이 시계를 보고 굳는다.',
                        visualGag: '미국볼 머리 위 다음 주 배송 상상 자막',
                        avoid: '물류 인프라 설명',
                    },
                ],
            },
            informationControl: {
                canSayDirectly: ['밤 주문', '새벽 도착', '신선식품'],
                showVisually: ['새벽 4시 알림', '문앞 상자', '계란'],
                backgroundOnly: ['물류센터', '전국망'],
                mustNotSayLikeLecture: ['인프라', '자동화', '투자', '전국망', '시스템'],
            },
            scriptRules: {
                humorRule: '정보보다 미국볼의 오해와 리액션이 웃겨야 함',
                endingRule: '상자 숭배 또는 계란 출근 같은 이미지로 끝낼 것',
            },
            recommendedSceneCount: 6,
            articles: [
                {
                    title: '배송 인프라 설명 기사',
                    summary: '물류 인프라, 자동화, 투자, 전국망이 핵심이라는 설명',
                },
            ],
        });

        const request = vi.mocked(openaiAdapter.chatJson).mock.calls[0]?.[0].userMessage ?? '';
        expect(request).toContain('WRITER BRAIN CONTRACT');
        expect(request).toContain('새벽 4시 문앞 괴담');
        expect(request).toContain('mustNotSayLikeLecture');
        expect(request).toContain('인프라');
        expect(request).not.toContain('OPTIONAL SOURCES');
    });

    it('rejects model output that ignores an explicit selected scene count', async () => {
        vi.mocked(openaiAdapter.chatJson).mockResolvedValueOnce({
            content: JSON.stringify({
                title: '컨트리볼 장면 수 불일치',
                topic: '사용자 선택 장면 수를 무시한 출력',
                cast: [
                    {
                        country: '주인공',
                        role: '핵심 특징을 보여주는 국가볼',
                        defaultEmotion: 'confident',
                        voiceRole: 'main_confident',
                    },
                    {
                        country: '상대국',
                        role: '처음엔 의심하는 국가볼',
                        defaultEmotion: 'smug',
                        voiceRole: 'rival_smug',
                    },
                ],
                scenes: Array.from({ length: 7 }, (_, index) => makeScene(index + 1)),
                thumbnailTexts: ['장면 수 불일치'],
            }),
            model: 'gpt-test',
            inputTokens: 1,
            outputTokens: 1,
            latencyMs: 1,
        });

        await expect(
            countryballScriptBlock.execute(
                {
                    topic: '컨트리볼 쇼츠 만들어줘. 상대국이 주인공 국가볼을 무시하다가 직접 보고 태세 전환하는 플롯.',
                    countryballBrief: {
                        storyFlow: ['무시', '테스트', '충격', '추가 주문'],
                        recommendedSceneCount: 9,
                    },
                },
                { scenes: 9 }
            )
        ).rejects.toThrow('Scene count mismatch');
    });

    it('normalizes mechanical Japanese-ball suffixes without changing topic content', async () => {
        vi.mocked(openaiAdapter.chatJson).mockResolvedValueOnce({
            content: JSON.stringify({
                title: '일본볼 말투 정리',
                topic: '새벽배송을 보고 일본볼이 놀라는 상황극',
                recommendedSceneCount: 5,
                cast: [
                    {
                        country: '한국',
                        role: '새벽배송 주인공',
                        defaultEmotion: 'confident',
                        voiceRole: 'main_confident',
                    },
                    { country: '일본', role: '놀라는 상대역', defaultEmotion: 'panic', voiceRole: 'panic_high' },
                ],
                scenes: Array.from({ length: 5 }, (_, index) => ({
                    ...makeScene(index + 1),
                    dialogueLines: [
                        { country: '일본', line: '이건 진짜 빠르네요.. 데스!', tone: 'panic', voiceRole: 'panic_high' },
                        {
                            country: '한국',
                            line: '아침에 문 앞 확인해.',
                            tone: 'confident',
                            voiceRole: 'main_confident',
                        },
                    ],
                })),
                thumbnailTexts: ['새벽배송 쇼크'],
            }),
            model: 'gpt-test',
            inputTokens: 1,
            outputTokens: 1,
            latencyMs: 1,
        });

        const result = await countryballScriptBlock.execute({
            topic: '컨트리볼 쇼츠. 일본볼이 한국 새벽배송 속도를 보고 놀라는 상황극.',
            countryballBrief: {
                skitPremise: '일본볼이 밤 주문 후 아침 배송을 보고 놀라는 상황극',
                recommendedSceneCount: 5,
            },
        });

        const scenes = result.output['scenes'] as Array<{ dialogueLines: Array<{ country: string; line: string }> }>;
        expect(scenes[0]?.dialogueLines[0]?.line).toBe('이건 진짜 빠르네요!');
    });
});

function makeScene(sceneNumber: number) {
    return {
        sceneId: `scene-${String(sceneNumber).padStart(2, '0')}`,
        sceneNumber,
        timeRange: `${(sceneNumber - 1) * 4}-${sceneNumber * 4}s`,
        scenePurpose: `사용자 플롯 장면 ${sceneNumber}`,
        location: '주제에 맞는 상황극 장소',
        visualTone: 'comedy',
        screenAction: `주인공 국가볼과 상대국공이 사용자가 요청한 플롯을 행동으로 보여준다 ${sceneNumber}`,
        dialogueLines: [
            { country: '상대국', line: '그게 진짜 된다고?', tone: 'smug', voiceRole: 'rival_smug' },
            { country: '주인공', line: '직접 보면 알 거야.', tone: 'confident', voiceRole: 'main_confident' },
        ],
        expressionChanges: ['상대국공 의심 눈', '주인공 국가볼 여유 눈'],
        sfx: ['impact cue'],
        editBeat: 'quick cut',
        narratorLine: null,
        captionOverlay: [
            {
                type: 'dialogue',
                text: '그게 진짜 된다고?',
                speakerCountry: '상대국',
                anchorTarget: 'speaker',
                preferredPosition: 'middle-left',
                style: 'yellowBlack',
            },
        ],
        props: ['user-requested visible prop'],
        durationSec: 4,
    };
}
