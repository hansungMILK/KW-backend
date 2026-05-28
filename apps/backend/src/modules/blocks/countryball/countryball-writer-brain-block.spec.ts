import { beforeEach, describe, expect, it, vi } from 'vitest';

import { COUNTRYBALL_WRITER_BRAIN_SYSTEM_PROMPT, countryballWriterBrainBlock } from './countryball-writer-brain-block';
import { openaiAdapter } from '../../../adapters/ai/openai-adapter';

vi.mock('../../../config/env', () => ({
    env: {
        orchestratorMode: 'openai',
        openaiModel: 'gpt-test',
        openaiContentMaxTokens: 4096,
    },
}));

vi.mock('../../../adapters/ai/openai-adapter', () => ({
    openaiAdapter: {
        chatJson: vi.fn(),
    },
}));

describe('countryballWriterBrainBlock', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('expands only the selected angle into a binding scene-flow contract', async () => {
        expect(COUNTRYBALL_WRITER_BRAIN_SYSTEM_PROMPT).toContain('selected angle');
        expect(COUNTRYBALL_WRITER_BRAIN_SYSTEM_PROMPT).toContain('Characters must experience the topic');
        expect(COUNTRYBALL_WRITER_BRAIN_SYSTEM_PROMPT).toContain('mustNotSayLikeLecture');

        vi.mocked(openaiAdapter.chatJson).mockResolvedValueOnce({
            content: JSON.stringify({
                selectedAngleId: 'angle_3',
                writerBrain: {
                    coreObservation: '외국볼에게 한국 새벽배송 상자는 기적처럼 보인다.',
                    outsiderLens: ['새벽 상자를 신성한 물건으로 오해한다.'],
                    selectedMechanisms: ['ritualization', 'comparison_shock'],
                    bestStoryAngle: '배송 상자를 신앙처럼 과장한다.',
                    informationUseRule: '물류 설명은 금지하고 상자, 시간, 식탁으로만 보여준다.',
                },
                storyBrief: {
                    setting: '한국 집 앞 복도와 아침 식탁',
                    characterEngine: {
                        한국: '아무렇지 않은 주인공',
                        미국: '상자를 기적으로 오해하는 리액션 담당',
                    },
                    sceneFlow: [
                        {
                            beat: 1,
                            function: 'setup',
                            scene: '미국볼이 배송 지연 알림을 본다.',
                            characterAction: '미국볼이 달력을 찢는다.',
                            dialogueIntent: '자기 나라 배송이 느리다고 한탄한다.',
                            visualGag: '달력 위에 거미줄',
                            factUsed: '배송 지연 대비',
                            avoid: '물류 인프라 설명',
                        },
                        {
                            beat: 2,
                            function: 'payoff',
                            scene: '한국 집 앞 새벽배송 상자를 본다.',
                            characterAction: '미국볼이 상자 앞에 무릎 꿇는다.',
                            dialogueIntent: '상자를 기적처럼 받아들인다.',
                            visualGag: '상자에서 빛이 난다.',
                            factUsed: '문앞 새벽배송',
                            avoid: '자동화 설명',
                        },
                    ],
                },
                informationControl: {
                    canSayDirectly: ['새벽배송', '문앞 도착'],
                    showVisually: ['상자', '새벽 4시', '아침 식탁'],
                    backgroundOnly: ['물류센터', '자동화', '전국망'],
                    mustNotSayLikeLecture: ['인프라', '자동화', '투자', '전국망'],
                },
                scriptRules: {
                    dialogueLength: '한 대사는 1-2문장 이내',
                    pacing: '첫 2초 안에 상황이 터져야 함',
                    humorRule: '설명보다 리액션과 장면으로 웃긴다',
                    endingRule: '짧은 밈 대사로 끝낸다',
                },
                recommendedSceneCount: 6,
            }),
            model: 'gpt-test',
            inputTokens: 1,
            outputTokens: 1,
            latencyMs: 1,
        });

        const result = await countryballWriterBrainBlock.execute(
            {
                requestTopic: '한국 새벽배송 컨트리볼 쇼츠',
                angleOptions: [
                    { id: 'angle_1', title: '새벽 문앞 괴담', oneLinePitch: '문앞 소리 오해' },
                    { id: 'angle_3', title: '배송 상자 신앙', oneLinePitch: '상자를 숭배' },
                ],
                recommendedChoice: { id: 'angle_1', reason: '추천' },
            },
            { selectedAngleId: 'angle_3', userAdjustment: '더 현실적으로' }
        );

        const request = vi.mocked(openaiAdapter.chatJson).mock.calls[0]?.[0];
        expect(request?.userMessage).toContain('SELECTED ANGLE');
        expect(request?.userMessage).toContain('angle_3');
        expect(request?.userMessage).toContain('더 현실적으로');
        expect(request?.userMessage).not.toContain('angle_1", "title": "새벽 문앞 괴담"');
        expect(result.output).toMatchObject({
            mode: 'countryball-writer-brain',
            presetId: 'countryball-shorts',
            selectedAngleId: 'angle_3',
            informationControl: expect.objectContaining({
                mustNotSayLikeLecture: expect.arrayContaining(['인프라', '자동화']),
            }),
        });
    });
});
