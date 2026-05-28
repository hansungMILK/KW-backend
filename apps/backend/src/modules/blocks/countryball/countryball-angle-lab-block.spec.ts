import { beforeEach, describe, expect, it, vi } from 'vitest';

import { COUNTRYBALL_ANGLE_LAB_SYSTEM_PROMPT, countryballAngleLabBlock } from './countryball-angle-lab-block';
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

describe('countryballAngleLabBlock', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('asks the writer AI for three distinct selectable skit angles before script generation', async () => {
        expect(COUNTRYBALL_ANGLE_LAB_SYSTEM_PROMPT).toContain('three distinct story angles');
        expect(COUNTRYBALL_ANGLE_LAB_SYSTEM_PROMPT).toContain('Do not write the script');
        expect(COUNTRYBALL_ANGLE_LAB_SYSTEM_PROMPT).toContain('Characters must experience the topic');
        expect(COUNTRYBALL_ANGLE_LAB_SYSTEM_PROMPT).toContain('ordinary_as_absurd');
        expect(COUNTRYBALL_ANGLE_LAB_SYSTEM_PROMPT).toContain('misread_as_crime');
        expect(COUNTRYBALL_ANGLE_LAB_SYSTEM_PROMPT).toContain('receipt_reveal');

        vi.mocked(openaiAdapter.chatJson).mockResolvedValueOnce({
            content: JSON.stringify(makeAngleLabOutput()),
            model: 'gpt-test',
            inputTokens: 1,
            outputTokens: 1,
            latencyMs: 1,
        });

        const result = await countryballAngleLabBlock.execute({
            requestTopic: '컨트리볼쇼츠제작. 주제: 밤늦게 주문하고 아침에 도착하는 한국 국뽕 쇼츠',
            countryballBrief: {
                targetCountry: '한국',
                targetFeature: '새벽배송',
                mainConflict: '외국볼이 새벽 문앞 배송을 수상하게 오해한다',
                sourceFacts: ['밤에 주문한 신선식품이 새벽이나 아침에 도착한다'],
            },
        });

        const request = vi.mocked(openaiAdapter.chatJson).mock.calls[0]?.[0];
        expect(request?.userMessage).toContain('새벽배송');
        expect(request?.userMessage).toContain('COUNTRYBALL BRIEF');
        expect(result.output).toMatchObject({
            mode: 'countryball-angle-lab',
            presetId: 'countryball-shorts',
            angleOptions: [
                expect.objectContaining({ id: 'angle_1', title: '새벽 문앞 괴담' }),
                expect.objectContaining({ id: 'angle_2', title: '계란이 출근보다 빠르다' }),
                expect.objectContaining({ id: 'angle_3', title: '배송 상자 신앙' }),
            ],
            recommendedChoice: expect.objectContaining({ id: 'angle_1' }),
        });
    });

    it('rejects angle options that are not genuinely different', async () => {
        vi.mocked(openaiAdapter.chatJson).mockResolvedValueOnce({
            content: JSON.stringify({
                ...makeAngleLabOutput(),
                angleOptions: [
                    { ...makeAngleLabOutput().angleOptions[0], id: 'angle_1', title: '새벽배송에 놀람' },
                    { ...makeAngleLabOutput().angleOptions[0], id: 'angle_2', title: '당일배송에 놀람' },
                    { ...makeAngleLabOutput().angleOptions[0], id: 'angle_3', title: '익일배송에 놀람' },
                ],
            }),
            model: 'gpt-test',
            inputTokens: 1,
            outputTokens: 1,
            latencyMs: 1,
        });

        await expect(
            countryballAngleLabBlock.execute({
                requestTopic: '컨트리볼 새벽배송 쇼츠',
                countryballBrief: { targetFeature: '새벽배송' },
            })
        ).rejects.toThrow(/distinct story angles/);
    });
});

function makeAngleLabOutput() {
    return {
        angleOptions: [
            {
                id: 'angle_1',
                title: '새벽 문앞 괴담',
                oneLinePitch: '외국볼이 새벽 4시 문앞 배송 소리를 침입 사건으로 오해한다.',
                coreObservation: '한국에서는 밤 주문 후 아침 문앞 도착이 일상처럼 느껴진다.',
                selectedMechanisms: [
                    {
                        id: 'ordinary_as_absurd',
                        reason: '한국의 평범한 일상을 외국볼에게 이상한 사건처럼 보이게 한다.',
                    },
                    { id: 'misread_as_crime', reason: '새벽 문밖 소리를 도둑이나 비밀요원으로 오해하게 만든다.' },
                ],
                storyShape: {
                    opening: '밤 11시 30분, 한국볼이 샐러드와 계란을 주문한다.',
                    middleEscalation: '새벽 4시 문밖에서 스윽 소리가 난다.',
                    peakMoment: '외국볼이 이불을 방패처럼 들고 도둑을 외친다.',
                    endingPayoff: '외국볼이 배송 상자를 신성한 물건처럼 받든다.',
                },
                scenePreview: [
                    { beat: 1, scene: '한국볼이 침대에서 주문한다.', whyItWorks: '밤 주문이 바로 보인다.' },
                    { beat: 2, scene: '새벽 복도에서 상자 소리가 난다.', whyItWorks: '오해가 생긴다.' },
                    { beat: 3, scene: '한국볼이 하품하며 상자를 들고 온다.', whyItWorks: '반전이 보인다.' },
                ],
                characterUse: {
                    mainCountry: '한국',
                    comparisonCountry: '미국',
                    thirdCharacter: '일본',
                },
                informationStrategy: {
                    directInfo: ['밤 주문', '새벽 도착', '신선식품'],
                    visualInfo: ['문앞 상자', '새벽 시간', '아침 식탁'],
                    hiddenBackgroundInfo: ['물류센터', '자동화', '전국망'],
                },
                thumbnailPotential: '새벽 4시에 누가 왔어?!',
                strength: '첫 장면과 오해가 강하다.',
                risk: '범죄 오해가 과하면 주제에서 샐 수 있다.',
                bestFor: '문화충격 코미디',
                score: { comedy: 9, clarity: 9, visuality: 9, freshness: 8, evidenceFit: 8 },
            },
            {
                id: 'angle_2',
                title: '계란이 출근보다 빠르다',
                oneLinePitch: '외국볼보다 한국의 계란 배송이 더 빨리 하루를 시작한다.',
                coreObservation: '새벽배송 속도는 사람의 하루 시작보다 빨라 보일 수 있다.',
                selectedMechanisms: [{ id: 'speed_pressure', reason: '속도 비교가 바로 웃긴다.' }],
                storyShape: {
                    opening: '외국볼이 늦잠에서 깬다.',
                    middleEscalation: '한국볼은 이미 새벽배송 계란으로 아침을 먹는다.',
                    peakMoment: '외국볼이 계란이 자기보다 먼저 출근했다고 외친다.',
                    endingPayoff: '외국볼이 자기 인생 속도를 반성한다.',
                },
                scenePreview: [
                    { beat: 1, scene: '외국볼이 알람을 끈다.', whyItWorks: '속도 비교가 시작된다.' },
                    { beat: 2, scene: '식탁에 계란 상자가 있다.', whyItWorks: '배송 결과가 보인다.' },
                    { beat: 3, scene: '외국볼이 계란을 노려본다.', whyItWorks: '밈 대사가 가능하다.' },
                ],
                characterUse: { mainCountry: '한국', comparisonCountry: '미국', thirdCharacter: '' },
                informationStrategy: {
                    directInfo: ['새벽배송'],
                    visualInfo: ['계란 상자', '아침 식탁'],
                    hiddenBackgroundInfo: ['자동화', '투자'],
                },
                thumbnailPotential: '계란이 나보다 빨라?',
                strength: '밈 대사가 강하다.',
                risk: '근거 설명이 약해질 수 있다.',
                bestFor: '짧은 릴스',
                score: { comedy: 8, clarity: 8, visuality: 7, freshness: 9, evidenceFit: 7 },
            },
            {
                id: 'angle_3',
                title: '배송 상자 신앙',
                oneLinePitch: '외국볼이 한국 새벽배송 상자를 기적처럼 숭배한다.',
                coreObservation: '빠른 문앞배송은 외국볼에게 기적처럼 보일 수 있다.',
                selectedMechanisms: [{ id: 'ritualization', reason: '상자를 신성하게 과장하면 시각 개그가 강하다.' }],
                storyShape: {
                    opening: '외국볼이 자기 나라 배송 지연을 한탄한다.',
                    middleEscalation: '한국볼 집 앞에는 새벽마다 상자가 조용히 도착한다.',
                    peakMoment: '외국볼이 상자 앞에 촛불을 켠다.',
                    endingPayoff: '한국볼이 그거 그냥 계란이라고 한다.',
                },
                scenePreview: [
                    { beat: 1, scene: '외국볼이 배송 지연 알림을 본다.', whyItWorks: '비교가 바로 된다.' },
                    { beat: 2, scene: '한국 집 앞에 상자가 놓인다.', whyItWorks: '기적처럼 보인다.' },
                    { beat: 3, scene: '외국볼이 상자 앞에 절한다.', whyItWorks: '시각 개그가 크다.' },
                ],
                characterUse: { mainCountry: '한국', comparisonCountry: '미국', thirdCharacter: '유럽' },
                informationStrategy: {
                    directInfo: ['문앞배송'],
                    visualInfo: ['상자', '촛불', '배송 지연 알림'],
                    hiddenBackgroundInfo: ['전국망', '물류 인프라'],
                },
                thumbnailPotential: '상자가 신이야?',
                strength: '썸네일 잠재력이 높다.',
                risk: '판타지화될 수 있다.',
                bestFor: '시각 개그',
                score: { comedy: 8, clarity: 7, visuality: 10, freshness: 8, evidenceFit: 6 },
            },
        ],
        recommendedChoice: {
            id: 'angle_1',
            reason: '새벽배송의 체감 포인트인 새벽 문앞 도착을 가장 장면적으로 보여준다.',
        },
        selectionPrompt: '아래 3개 중 마음에 드는 앵글을 골라주세요.',
    };
}
