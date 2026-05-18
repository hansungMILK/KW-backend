import { describe, expect, it } from 'vitest';

import { buildOutputContract, buildRequestSpec, classifySourceCoverage, extractFocusTerms } from './request-contract';

describe('request contract helpers', () => {
    it('builds a reusable request spec for image, text, shorts, and longform intents', () => {
        expect(buildRequestSpec('주술회전 사진 하나 생성해줘')).toMatchObject({
            userRequest: '주술회전 사진 하나 생성해줘',
            outputKind: 'image',
            contentIntent: 'single-image',
            focusTerms: expect.arrayContaining(['주술회전']),
        });

        expect(buildRequestSpec('우주 고래가 도시 위를 나는 상황을 그려줘')).toMatchObject({
            outputKind: 'image',
            contentIntent: 'single-image',
            focusTerms: expect.arrayContaining(['우주', '고래', '도시']),
            understanding: {
                surfaceTerms: expect.arrayContaining(['우주 고래가 도시 위를 나는 상황을 그려줘']),
                focusEntities: expect.arrayContaining(['우주', '고래', '도시']),
                actions: expect.arrayContaining(['도시 위를 나는']),
                constraints: [],
                styleHints: [],
            },
        });
        expect(buildRequestSpec('우주 고래가 도시 위를 나는 상황을 그려줘').understanding.focusEntities).not.toEqual(
            expect.arrayContaining(['위를', '나는'])
        );

        expect(buildRequestSpec('주술회전 홍보하는 블로그 글 써줘')).toMatchObject({
            outputKind: 'text',
            contentIntent: 'blog-post',
            focusTerms: expect.arrayContaining(['주술회전']),
        });

        expect(buildRequestSpec('주술회전 회절옥절 관한 쇼츠영상 만들어줘')).toMatchObject({
            outputKind: 'video',
            contentIntent: 'shorts',
            focusTerms: expect.arrayContaining(['주술회전', '회절옥절']),
        });

        expect(buildRequestSpec('롱폼 만들어줘. 주제는 이 링크 설명하기')).toMatchObject({
            outputKind: 'video',
            contentIntent: 'longform',
        });
    });

    it('classifies source coverage without treating broad parent-topic sources as direct evidence', () => {
        const requestSpec = buildRequestSpec('쇼츠생성해줘. 무한도전 yes or no 편 설명');

        expect(
            classifySourceCoverage(
                {
                    id: 'source-1',
                    title: "'무한도전', 웹툰 연재에 도전",
                    summary:
                        "특정 'yes or no' 편 자체를 설명하진 않지만, 무한도전의 실험적 포맷을 이해하는 참고 근거입니다.",
                },
                requestSpec
            )
        ).toMatchObject({
            status: 'supporting',
            missingTerms: expect.arrayContaining(['yes', 'no']),
        });

        expect(
            classifySourceCoverage(
                {
                    id: 'source-2',
                    title: '무한도전 YES or NO 특집 정리',
                    summary: '무한도전 YES or NO 편의 선택 구조와 주요 장면을 설명합니다.',
                },
                requestSpec
            )
        ).toMatchObject({
            status: 'direct',
            matchedTerms: expect.arrayContaining(['무한도전', 'yes', 'no']),
        });
    });

    it('builds an output contract that can be used by any downstream block', () => {
        const requestSpec = buildRequestSpec('블로그에 쓸 글 생성해줘. 주제는 세레브라스 IPO');
        const contract = buildOutputContract(requestSpec, 'text');

        expect(contract).toMatchObject({
            requestTopic: '블로그에 쓸 글 생성해줘. 주제는 세레브라스 IPO',
            outputKind: 'text',
            requiredCoverageTerms: expect.arrayContaining(['세레브라스', 'ipo']),
            exactSubjectRequired: true,
        });
    });

    it('classifies varied hypothetical confrontation requests as creative simulation production mode', () => {
        const examples = [
            '나루토와 주술회전의 고죠 사토루가 싸우면 누가 이길까? 그걸 그린 쇼츠를 만들어줘',
            '만약 쿠라마 모드 나루토가 고죠를 상대한다면 결말을 쇼츠로 시뮬레이션해줘',
            '두 캐릭터가 맞붙는 가상 상황을 이야기형 쇼츠로 구성해줘',
            'A팀하고 B팀이 풀전력으로 붙는다면 승부 흐름을 릴스로 보여줘',
        ];

        for (const example of examples) {
            expect(buildRequestSpec(example)).toMatchObject({
                contentIntent: 'shorts',
                outputKind: 'video',
                contentMode: 'creative-simulation',
            });
        }
    });

    it('extracts focus terms without command words or parent workflow words', () => {
        expect(extractFocusTerms('쇼츠생성해줘. 무한도전 yes or no 편 설명')).toEqual(['무한도전', 'yes', 'no']);
    });

    it('does not treat matchup connector words as required subject coverage terms', () => {
        expect(extractFocusTerms('고죠사토루 vs 나루토 싸우면 어떻게 되는지 쇼츠로 만들어줘')).toEqual([
            '고죠사토루',
            '나루토',
        ]);
    });

    it('extracts matchup subjects from varied natural-language confrontation phrasing', () => {
        expect(
            extractFocusTerms('나루토와 주술회전의 고죠 사토루가 싸우면 누가 이길까? 그걸 그린 쇼츠를 만들어줘')
        ).toEqual(['나루토', '고죠', '사토루']);
        expect(extractFocusTerms('나루토랑 고죠 사토루 중 누가 이길지 시뮬레이션 쇼츠로 보여줘')).toEqual([
            '나루토',
            '고죠',
            '사토루',
        ]);
        expect(extractFocusTerms('만약 쿠라마 모드 나루토가 고죠를 상대한다면 결말을 쇼츠로 시뮬레이션해줘')).toEqual([
            '나루토',
            '고죠',
        ]);
    });

    it('keeps matchup entities, actions, and constraints in separate request slots', () => {
        expect(
            buildRequestSpec('만약 쿠라마 모드 나루토가 고죠를 상대한다면 결말을 쇼츠로 시뮬레이션해줘')
        ).toMatchObject({
            focusTerms: ['나루토', '고죠'],
            understanding: {
                surfaceTerms: expect.arrayContaining([
                    '만약 쿠라마 모드 나루토가 고죠를 상대한다면 결말을 쇼츠로 시뮬레이션해줘',
                ]),
                focusEntities: ['나루토', '고죠'],
                actions: expect.arrayContaining(['상대한다면']),
                constraints: expect.arrayContaining(['쿠라마 모드']),
                styleHints: [],
            },
        });
    });
});
