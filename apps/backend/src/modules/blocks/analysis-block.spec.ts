import { beforeEach, describe, expect, it, vi } from 'vitest';

import { analysisBlock } from './analysis-block';
import { openaiAdapter } from '../../adapters/ai/openai-adapter';

vi.mock('../../config/env', () => ({
    env: {
        orchestratorMode: 'openai',
    },
}));

vi.mock('../../adapters/ai/openai-adapter', () => ({
    openaiAdapter: {
        chatJson: vi.fn(async () => ({
            content: JSON.stringify({ suggestedIssues: [] }),
        })),
    },
}));

describe('analysisBlock', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('passes claim type and source refs to the AI review prompt', async () => {
        const normalizedScenes = Array.from({ length: 10 }, (_, index) => ({
            sceneNumber: index + 1,
            caption: `장면 ${index + 1}`,
            narration: `검증 가능한 나레이션 문장입니다 ${index + 1}`,
            imagePrompt: 'A simple Korean explainer shorts scene.',
            visual: {
                topTitle: 'KTX 표가 없는 이유',
                mainCaption: `장면 ${index + 1}`,
            },
            claimType: 'fact',
            sourceRefs: ['source-1'],
            durationSec: 5,
        }));

        await analysisBlock.execute({
            normalizedScenes,
            metadata: {
                title: 'KTX 표가 없는 이유',
                presetId: 'general-shorts',
            },
        });

        expect(openaiAdapter.chatJson).toHaveBeenCalledTimes(1);
        const call = vi.mocked(openaiAdapter.chatJson).mock.calls[0]?.[0];
        expect(call?.userMessage).toContain('claimType=fact');
        expect(call?.userMessage).toContain('sourceRefs=source-1');
        expect(call?.userMessage).toContain('출처 연결이 있는 것으로 간주');
    });

    it('keeps style-only quality issues non-blocking so media generation can continue', async () => {
        const normalizedScenes = Array.from({ length: 12 }, (_, index) => ({
            sceneNumber: index + 1,
            caption: `핵심 장면 ${index + 1}`,
            narration: `검증 가능한 설명형 나레이션 문장입니다 ${index + 1}`,
            imagePrompt: 'A simple Korean explainer shorts scene.',
            visual: {
                topTitle: '1234567890123456789',
                mainCaption: `핵심 장면 ${index + 1}`,
            },
            claimType: 'context',
            sourceRefs: ['source-1'],
            durationSec: 5,
        }));

        const result = await analysisBlock.execute({
            normalizedScenes,
            metadata: {
                title: '세레브라스 IPO',
                presetId: 'general-shorts',
            },
        });

        expect(result.output['approved']).toBe(true);
        expect(result.output['qualityScore']).toBeLessThan(60);
        expect(JSON.stringify(result.output['issues'])).toContain('상단 제목이 너무 깁니다');
    });

    it('auto-remediates source-backed factual wording cautions instead of failing the workflow', async () => {
        vi.mocked(openaiAdapter.chatJson).mockResolvedValueOnce({
            content: JSON.stringify({
                suggestedIssues: [
                    {
                        severity: 'high',
                        sceneNumber: 3,
                        message:
                            "2025년 계약 연장과 계약 만료 시점은 최신 공식 발표 기준이 맞는지 시점 확인이 필요합니다. 단정형 대신 '공식 발표에 따르면'처럼 유지하는 것이 안전합니다.",
                    },
                    {
                        severity: 'high',
                        sceneNumber: 6,
                        message: '최신 사실관계는 출처가 있어도 영상 시점 기준의 정확성을 재확인해야 합니다.',
                    },
                ],
            }),
        });

        const normalizedScenes = Array.from({ length: 12 }, (_, index) => ({
            sceneNumber: index + 1,
            caption: `장면 ${index + 1}`,
            narration:
                index === 2
                    ? '2025년 계약 연장으로 계약은 2026년까지 이어집니다.'
                    : index === 5
                      ? '2025년 유로파리그 우승의 주장으로 다시 주목받았습니다.'
                      : `검증 가능한 설명형 나레이션 문장입니다 ${index + 1}`,
            imagePrompt: 'A simple Korean explainer shorts scene.',
            visual: {
                topTitle: '토트넘 강등 위기',
                mainCaption: `장면 ${index + 1}`,
            },
            claimType: 'fact',
            sourceRefs: ['source-1'],
            durationSec: 5,
        }));

        const result = await analysisBlock.execute({
            normalizedScenes,
            metadata: {
                title: '토트넘 강등 위기',
                presetId: 'general-shorts',
            },
        });

        expect(result.output['approved']).toBe(true);
        expect(JSON.stringify(result.output['issues'])).toContain('자동 완화');
        expect(JSON.stringify(result.output['autoRemediations'])).toContain('sceneNumber');

        const repairedScenes = result.output['normalizedScenes'] as Array<{ sceneNumber: number; narration: string }>;
        expect(repairedScenes.find(scene => scene.sceneNumber === 3)?.narration).toContain('공식 발표 기준으로');
        expect(repairedScenes.find(scene => scene.sceneNumber === 6)?.narration).toContain('공식 발표 기준으로');
    });

    it('does not block source-backed news controversy topics only because they contain the word scam', async () => {
        const normalizedScenes = Array.from({ length: 12 }, (_, index) => ({
            sceneNumber: index + 1,
            caption: `논란 장면 ${index + 1}`,
            narration:
                index === 0
                    ? '보도에 따르면 모수 와인 사기 논란은 결제와 제공 방식에 대한 의혹에서 시작됐습니다.'
                    : `출처 기반으로 논란의 배경을 설명하는 나레이션입니다 ${index + 1}`,
            imagePrompt: 'A source-backed Korean news explainer scene.',
            visual: {
                topTitle: '모수 와인 논란',
                mainCaption: `논란 장면 ${index + 1}`,
            },
            claimType: 'fact',
            sourceRefs: ['source-1'],
            durationSec: 5,
        }));

        const result = await analysisBlock.execute({
            normalizedScenes,
            metadata: {
                title: '모수 와인 사기논란',
                presetId: 'general-shorts',
            },
        });

        expect(result.output['approved']).toBe(true);
        expect(JSON.stringify(result.output['issues'])).not.toContain('금지 키워드 "사기"');
    });

    it('does not treat fictional creative simulation combat wording as real-world violence', async () => {
        const normalizedScenes = Array.from({ length: 12 }, (_, index) => ({
            sceneNumber: index + 1,
            caption: index === 0 ? '가상 대치' : `공방 ${index + 1}`,
            narration:
                index === 0
                    ? '가상 시뮬레이션에서 두 캐릭터의 폭력적인 첫 충돌이 시작됩니다.'
                    : `가상 전투의 ${index + 1}번째 공방이 이어집니다.`,
            imagePrompt:
                index === 0
                    ? 'A fictional stylized character battle simulation opening beat with explosive energy'
                    : `A fictional character duel simulation beat ${index + 1}`,
            visual: {
                topTitle: '가상 대결',
                mainCaption: index === 0 ? '가상 대치' : `공방 ${index + 1}`,
            },
            claimType: 'hypothetical',
            sourceRefs: [],
            durationSec: 5,
        }));

        const result = await analysisBlock.execute({
            normalizedScenes,
            metadata: {
                title: '가상 대결',
                presetId: 'general-shorts',
                requestSpec: {
                    userRequest: '두 캐릭터가 맞붙는 가상 상황을 쇼츠로 구성해줘',
                    contentIntent: 'shorts',
                    outputKind: 'video',
                    contentMode: 'creative-simulation',
                    focusTerms: ['캐릭터'],
                    exactSubjectRequired: true,
                },
            },
        });

        expect(result.output['approved']).toBe(true);
        expect(JSON.stringify(result.output['issues'])).not.toContain('금지 키워드 "폭력"');
    });

    it('rejects countryball scripts that insult an entire nationality or ethnicity', async () => {
        const normalizedScenes = Array.from({ length: 12 }, (_, index) => ({
            sceneNumber: index + 1,
            caption: `상황극 ${index + 1}`,
            narration:
                index === 2
                    ? '일본인은 전부 열등하다는 식으로 장면을 몰아갑니다.'
                    : `국가볼 캐릭터들이 사용자가 요청한 상황을 재연합니다 ${index + 1}`,
            imagePrompt: 'Korea countryball and Japan countryball reenact a tense cultural situation.',
            visual: {
                topTitle: '도공 상황극',
                mainCaption: `상황극 ${index + 1}`,
            },
            claimType: 'opinion',
            sourceRefs: [],
            durationSec: 5,
        }));

        const result = await analysisBlock.execute({
            normalizedScenes,
            metadata: {
                title: '도공 상황극',
                presetId: 'countryball-shorts',
                requestTopic: '컨트리볼 쇼츠로 조선 도공 상황극 만들어줘',
                outputContract: {
                    contentProfileId: 'shorts.countryball.v1',
                    narrativeMode: 'countryball-situation-reenactment',
                    exactSubjectRequired: false,
                },
            },
        });

        expect(result.output['approved']).toBe(false);
        expect(JSON.stringify(result.output['issues'])).toContain('국가/민족 전체를 비하');
    });

    it('allows user-requested fictional countryball reenactments without source refs', async () => {
        const normalizedScenes = Array.from({ length: 12 }, (_, index) => ({
            sceneNumber: index + 1,
            caption: `가상 협상 ${index + 1}`,
            narration: `한국볼과 일본볼이 가상의 협상 상황을 상황극으로 재연합니다 ${index + 1}`,
            imagePrompt: 'Korea countryball and Japan countryball reenact a fictional negotiation scene.',
            visual: {
                topTitle: '가상 협상극',
                mainCaption: `가상 협상 ${index + 1}`,
            },
            claimType: 'hypothetical',
            sourceRefs: [],
            dramatizedAction: `한국볼이 협상 서류를 내밀고 일본볼이 당황하는 장면 ${index + 1}`,
            dialogueLines: [{ speaker: 'KR', text: '조건부터 보자.', emotion: 'focused' }],
            durationSec: 5,
        }));

        const result = await analysisBlock.execute({
            normalizedScenes,
            metadata: {
                title: '가상 협상극',
                presetId: 'countryball-shorts',
                requestTopic: '컨트리볼 쇼츠로 가상 협상 상황극 만들어줘',
                outputContract: {
                    contentProfileId: 'shorts.countryball.v1',
                    narrativeMode: 'countryball-situation-reenactment',
                    requestBasis: 'user-requested',
                    exactSubjectRequired: false,
                },
            },
        });

        expect(result.output['approved']).toBe(true);
        expect(JSON.stringify(result.output['issues'])).not.toContain('sourceRefs가 없습니다');
    });

    it('does not block countryball skits with source-attribution wording cautions', async () => {
        vi.mocked(openaiAdapter.chatJson).mockResolvedValueOnce({
            content: JSON.stringify({
                suggestedIssues: [
                    {
                        severity: 'high',
                        sceneNumber: 4,
                        message:
                            "사실 진술처럼 보이는 문장은 '공식 지표에 따르면' 또는 '보도에 따르면'처럼 출처를 드러내는 표현으로 완화하는 것이 좋습니다.",
                    },
                ],
            }),
        });

        const normalizedScenes = Array.from({ length: 12 }, (_, index) => ({
            sceneNumber: index + 1,
            caption: index === 0 ? '밤길 비교' : `상황극 ${index + 1}`,
            narration:
                index === 0
                    ? '한국볼은 새벽 세시에 이어폰을 끼고 배달앱을 켭니다.'
                    : `한국볼과 외국볼이 밤거리 상황을 짧게 재연합니다 ${index + 1}`,
            imagePrompt: 'Korea countryball calmly walking at night with a smartphone while France ball looks nervous.',
            visual: {
                topTitle: '밤거리 상황극',
                mainCaption: index === 0 ? '밤길 비교' : `상황극 ${index + 1}`,
            },
            claimType: 'fact',
            sourceRefs: [],
            dramatizedAction:
                index === 0
                    ? '프랑스볼이 어두운 골목에서 떨고, 한국볼은 새벽 3시에 이어폰을 끼고 한강을 걷는다.'
                    : `한국볼이 스마트폰으로 배달을 누르고 외국볼이 주변을 두리번거리는 장면 ${index + 1}`,
            dialogueLines: [
                { speaker: '프랑스볼', text: '이 시간에 나간다고?', emotion: 'nervous' },
                { speaker: '한국볼', text: '치킨 오고 있어.', emotion: 'smug' },
            ],
            durationSec: 5,
        }));

        const result = await analysisBlock.execute({
            normalizedScenes,
            metadata: {
                title: '밤거리 상황극',
                presetId: 'countryball-shorts',
                requestTopic: '한국 밤거리 치안 컨트리볼 쇼츠 만들어줘',
                outputContract: {
                    contentProfileId: 'shorts.countryball.v1',
                    narrativeMode: 'countryball-situation-reenactment',
                    requestBasis: 'user-requested',
                    requiredCoverageTerms: ['한국', '밤거리', '치한', '컨트리볼'],
                    exactSubjectRequired: false,
                },
            },
        });

        expect(result.output['approved']).toBe(true);
        expect(JSON.stringify(result.output['issues'])).not.toContain('공식 지표');
        expect(JSON.stringify(result.output['autoRemediations'] ?? [])).not.toContain('공식 발표 기준으로');
    });

    it('rejects countryball scripts that only explain instead of staging character skit beats', async () => {
        const normalizedScenes = Array.from({ length: 12 }, (_, index) => ({
            sceneNumber: index + 1,
            caption: `설명 ${index + 1}`,
            narration: `새벽배송과 밤거리 안전의 균형을 설명하는 문장입니다 ${index + 1}`,
            imagePrompt: 'A generic countryball explainer image.',
            visual: {
                topTitle: '밤거리 상황극',
                mainCaption: `설명 ${index + 1}`,
            },
            claimType: 'opinion',
            sourceRefs: [],
            dramatizedAction: `컨트리볼 상황극을 재연하는 설명 장면 ${index + 1}입니다.`,
            dialogueLines: [],
            durationSec: 5,
        }));

        const result = await analysisBlock.execute({
            normalizedScenes,
            metadata: {
                title: '밤거리 상황극',
                presetId: 'countryball-shorts',
                requestTopic: '한국 밤거리 치한 컨트리볼 쇼츠 만들어줘',
                outputContract: {
                    contentProfileId: 'shorts.countryball.v1',
                    narrativeMode: 'countryball-situation-reenactment',
                    requestBasis: 'user-requested',
                    exactSubjectRequired: false,
                },
            },
        });

        expect(result.output['approved']).toBe(false);
        expect(JSON.stringify(result.output['issues'])).toContain('상황을 행동으로 보여주는');
        expect(JSON.stringify(result.output['issues'])).toContain('국가볼 캐릭터 대사');
    });

    it('rejects countryball scenes whose dialogue is not structured by speaker', async () => {
        const normalizedScenes = Array.from({ length: 12 }, (_, index) => ({
            sceneNumber: index + 1,
            caption: `가상 협상 ${index + 1}`,
            narration: `한국볼과 일본볼이 가상의 협상 상황을 상황극으로 재연합니다 ${index + 1}`,
            imagePrompt: 'Korea countryball and Japan countryball reenact a fictional negotiation scene.',
            visual: {
                topTitle: '가상 협상극',
                mainCaption: `가상 협상 ${index + 1}`,
            },
            claimType: 'hypothetical',
            sourceRefs: [],
            dramatizedAction: `한국볼이 문서를 내밀고 일본볼이 당황하는 장면 ${index + 1}`,
            dialogueLines: index === 0 ? ['이름이 뭔데?'] : [{ speaker: 'KR', text: '이 장면은 통과해야 해.' }],
            durationSec: 5,
        }));

        const result = await analysisBlock.execute({
            normalizedScenes,
            metadata: {
                title: '가상 협상극',
                presetId: 'countryball-shorts',
                requestTopic: '컨트리볼 쇼츠로 가상 협상 상황극 만들어줘',
                outputContract: {
                    contentProfileId: 'shorts.countryball.v1',
                    narrativeMode: 'countryball-situation-reenactment',
                    requestBasis: 'user-requested',
                    exactSubjectRequired: false,
                },
            },
        });

        expect(result.output['approved']).toBe(false);
        expect(JSON.stringify(result.output['issues'])).toContain('speaker/text 구조');
    });

    it('rejects countryball scenes that use dialogue without a skit action', async () => {
        const normalizedScenes = Array.from({ length: 12 }, (_, index) => ({
            sceneNumber: index + 1,
            caption: `가상 협상 ${index + 1}`,
            narration: `한국볼과 일본볼이 대사로만 상황을 설명합니다 ${index + 1}`,
            imagePrompt: 'Korea countryball and Japan countryball stand and talk.',
            visual: {
                topTitle: '가상 협상극',
                mainCaption: `가상 협상 ${index + 1}`,
            },
            claimType: 'hypothetical',
            sourceRefs: [],
            dramatizedAction: index === 0 ? '' : `한국볼이 서류를 흔들고 일본볼이 뒷걸음질치는 장면 ${index + 1}`,
            dialogueLines: [{ speaker: 'KR', text: '말로만 설명하면 재미없지.', emotion: 'smug' }],
            durationSec: 5,
        }));

        const result = await analysisBlock.execute({
            normalizedScenes,
            metadata: {
                title: '가상 협상극',
                presetId: 'countryball-shorts',
                requestTopic: '컨트리볼 쇼츠로 가상 협상 상황극 만들어줘',
                outputContract: {
                    contentProfileId: 'shorts.countryball.v1',
                    narrativeMode: 'countryball-situation-reenactment',
                    requestBasis: 'user-requested',
                    exactSubjectRequired: false,
                },
            },
        });

        expect(result.output['approved']).toBe(false);
        expect(JSON.stringify(result.output['issues'])).toContain('dramatizedAction');
    });

    it('rejects overloaded countryball dialogue that will not fit Shorts pacing', async () => {
        const normalizedScenes = Array.from({ length: 12 }, (_, index) => ({
            sceneNumber: index + 1,
            caption: `가상 협상 ${index + 1}`,
            narration: `한국볼과 일본볼이 가상의 협상 상황을 상황극으로 재연합니다 ${index + 1}`,
            imagePrompt: 'Korea countryball and Japan countryball reenact a fictional negotiation scene.',
            visual: {
                topTitle: '가상 협상극',
                mainCaption: `가상 협상 ${index + 1}`,
            },
            claimType: 'hypothetical',
            sourceRefs: [],
            dramatizedAction: `한국볼이 서류를 내밀고 일본볼이 당황하는 장면 ${index + 1}`,
            dialogueLines:
                index === 0
                    ? [
                          { speaker: 'KR', text: '이건 우리 조건이야.' },
                          { speaker: 'JP', text: '잠깐, 너무 빠르잖아.' },
                          { speaker: 'US', text: '둘 다 조용히 해.' },
                      ]
                    : [{ speaker: 'KR', text: '짧게 치고 빠진다.' }],
            durationSec: 5,
        }));

        const result = await analysisBlock.execute({
            normalizedScenes,
            metadata: {
                title: '가상 협상극',
                presetId: 'countryball-shorts',
                requestTopic: '컨트리볼 쇼츠로 가상 협상 상황극 만들어줘',
                outputContract: {
                    contentProfileId: 'shorts.countryball.v1',
                    narrativeMode: 'countryball-situation-reenactment',
                    requestBasis: 'user-requested',
                    exactSubjectRequired: false,
                },
            },
        });

        expect(result.output['approved']).toBe(false);
        expect(JSON.stringify(result.output['issues'])).toContain('2줄 이하');
    });

    it('repairs creative simulation pacing and verdict issues once before rejecting the workflow', async () => {
        vi.mocked(openaiAdapter.chatJson)
            .mockResolvedValueOnce({
                content: JSON.stringify({
                    suggestedIssues: [
                        {
                            severity: 'high',
                            message:
                                '유사한 문장이 여러 씬에서 반복되어 템포가 느려질 수 있습니다. 핵심 근거만 남기고 압축하면 더 좋습니다.',
                        },
                        {
                            severity: 'high',
                            message:
                                "'무한이 걸립니다', '끝입니다', '훨씬 유리합니다'처럼 단정적인 표현은 대결 해석형 콘텐츠에서는 조금 더 완곡하게 다듬는 편이 좋습니다.",
                        },
                    ],
                }),
            })
            .mockResolvedValueOnce({
                content: JSON.stringify({
                    scenes: Array.from({ length: 12 }, (_, index) => ({
                        sceneNumber: index + 1,
                        caption:
                            index === 0 ? '풀전력 돌입' : index === 4 ? '닿지 않는 거리' : `전황 변화 ${index + 1}`,
                        narration:
                            index === 0
                                ? '나루토가 처음부터 쿠라마 모드로 전장을 넓히며 압박합니다.'
                                : index === 4
                                  ? '고죠 사토루 앞에서 마지막 거리가 접히지 않으며 돌진이 멈춰 보입니다.'
                                  : index === 8
                                    ? '이 가상 전개에서는 접촉을 막는 쪽이 상성상 더 유리해 보입니다.'
                                    : `두 인물의 전투 흐름이 ${index + 1}번째 장면에서 새 국면으로 바뀝니다.`,
                        imagePrompt: `A cinematic fictional battle simulation beat ${index + 1}`,
                        visual: {
                            topTitle: '나루토 VS 고죠',
                            mainCaption:
                                index === 0 ? '풀전력 돌입' : index === 4 ? '닿지 않는 거리' : `전황 변화 ${index + 1}`,
                        },
                        claimType: 'hypothetical',
                        sourceRefs: [],
                        durationSec: 5,
                    })),
                }),
            });

        const normalizedScenes = Array.from({ length: 12 }, (_, index) => ({
            sceneNumber: index + 1,
            caption: index === 0 ? '전투 시작' : `비슷한 공방 ${index + 1}`,
            narration:
                index === 0
                    ? '고죠사토루와 나루토가 맞붙으면 무한이 걸립니다.'
                    : '공격합니다. 막힙니다. 다시 공격합니다. 끝입니다.',
            imagePrompt: 'A repetitive fictional battle scene.',
            visual: {
                topTitle: '나루토 VS 고죠',
                mainCaption: index === 0 ? '전투 시작' : `비슷한 공방 ${index + 1}`,
            },
            claimType: 'hypothetical',
            sourceRefs: [],
            durationSec: 5,
        }));

        const result = await analysisBlock.execute({
            normalizedScenes,
            metadata: {
                title: '나루토 VS 고죠',
                presetId: 'general-shorts',
                requestSpec: {
                    userRequest: '고죠사토루 vs 나루토 싸우면 어떻게 되는지 쇼츠로 만들어줘',
                    contentIntent: 'shorts',
                    outputKind: 'video',
                    contentMode: 'creative-simulation',
                    focusTerms: ['고죠사토루', '나루토'],
                    exactSubjectRequired: true,
                },
            },
        });

        expect(openaiAdapter.chatJson).toHaveBeenCalledTimes(2);
        expect(result.output['approved']).toBe(true);
        expect(JSON.stringify(result.output['autoRemediations'])).toContain('rewrite-creative-simulation-scenes');
        expect(JSON.stringify(result.output['issues'])).not.toContain('유사한 문장');

        const repairedScenes = result.output['normalizedScenes'] as Array<{ narration: string }>;
        expect(repairedScenes[4]?.narration).toContain('고죠 사토루');
        expect(repairedScenes[8]?.narration).toContain('유리해 보입니다');
    });

    it('approves complete longform Gate A artifacts and keeps paid execution blocked', async () => {
        const result = await analysisBlock.execute(
            {
                gate: 'A',
                mode: 'longform-gate-a',
                outline: [{ title: '도입', summary: '문제 제기' }],
                fullScriptDraft: 'AI 에이전트의 미래를 설명하는 긴 대본 초안입니다.',
                scenePlan: [{ sceneNumber: 1, title: '도입', durationSec: 40 }],
                estimatedDurationSec: 240,
                estimatedCost: { currency: 'USD', total: 0.18 },
                rendererRoute: 'hyperframes',
                qaChecklist: ['출처 확인'],
                mediaExecutionAllowed: false,
            },
            { mode: 'longform-gate-a' }
        );

        expect(openaiAdapter.chatJson).not.toHaveBeenCalled();
        expect(result.output).toMatchObject({
            approved: true,
            safetyScore: 100,
            qualityScore: 100,
            gate: 'A',
            mode: 'longform-gate-a',
            mediaExecutionAllowed: false,
            rendererRoute: 'hyperframes',
        });
    });

    it('does not treat a generic gate A marker as longform without longform mode or profile', async () => {
        const normalizedScenes = Array.from({ length: 10 }, (_, index) => ({
            sceneNumber: index + 1,
            caption: `장면 ${index + 1}`,
            narration: `일반 콘텐츠 검수 장면입니다 ${index + 1}`,
            imagePrompt: 'A generic review scene.',
            visual: {
                topTitle: '일반 검수',
                mainCaption: `장면 ${index + 1}`,
            },
            claimType: 'opinion',
            sourceRefs: [],
            durationSec: 5,
        }));

        const result = await analysisBlock.execute({ normalizedScenes }, { gate: 'A' });

        expect(openaiAdapter.chatJson).toHaveBeenCalledTimes(1);
        expect(result.output).toHaveProperty('normalizedScenes');
        expect(result.output['mode']).toBeUndefined();
    });

    it('blocks generic shorts scripts that do not cover the exact requested subject', async () => {
        const normalizedScenes = Array.from({ length: 12 }, (_, index) => ({
            sceneNumber: index + 1,
            caption:
                index === 0 ? '왜 아직도 레전드?' : index === 1 ? '무한도전은 실험 예능' : `일반 장면 ${index + 1}`,
            narration:
                index === 0
                    ? '이 편, 왜 아직도 레전드야?'
                    : index === 1
                      ? '무한도전은 매번 형식을 바꾸는 실험형 예능이었어.'
                      : `무한도전의 일반적인 매력을 설명하는 장면입니다 ${index + 1}`,
            imagePrompt: 'A generic Korean variety show explainer scene.',
            visual: {
                topTitle: '무한도전 YES or NO',
                mainCaption: index === 1 ? '무한도전은 실험 예능' : `일반 장면 ${index + 1}`,
            },
            claimType: index === 1 ? 'fact' : 'opinion',
            sourceRefs: index === 1 ? ['source-1'] : [],
            durationSec: 5,
        }));

        const result = await analysisBlock.execute({
            normalizedScenes,
            metadata: {
                requestTopic: '쇼츠생성해줘. 무한도전 yes or no 편 설명',
                outputContract: {
                    requestTopic: '쇼츠생성해줘. 무한도전 yes or no 편 설명',
                    outputKind: 'video',
                    requiredCoverageTerms: ['무한도전', 'yes', 'no'],
                    exactSubjectRequired: true,
                },
                title: '무한도전 YES or NO',
                presetId: 'general-shorts',
            },
        });

        expect(result.output['approved']).toBe(false);
        expect(JSON.stringify(result.output['issues'])).toContain('요청한 핵심 주제');
        expect(JSON.stringify(result.output['issues'])).toContain('yes');
    });
});
