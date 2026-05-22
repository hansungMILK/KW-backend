import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    longformBriefBlock,
    longformMotionComposeBlock,
    longformQaBlock,
    longformReviewBlock,
    longformSceneJsonBlock,
    longformScriptBlock,
    longformSourceBlock,
    longformSrtAlignBlock,
    longformStoryboardBlock,
    longformTtsBlock,
} from './longform-blocks';
import { openaiAdapter } from '../../adapters/ai/openai-adapter';

vi.mock('../../adapters/ai/openai-adapter', () => ({
    openaiAdapter: {
        chatJson: vi.fn(),
        webSearchJson: vi.fn(),
    },
}));

vi.mock('../../adapters/ai/tts-adapter', () => ({
    ttsAdapter: {
        synthesize: vi.fn(async () => ({
            audioBuffer: Buffer.from('mock-longform-tts'),
            contentType: 'audio/mpeg',
            estimatedDurationSec: 2,
            provider: 'elevenlabs',
            model: 'eleven_flash_v2_5',
            voiceId: 'pNInz6obpgDQGcFmaJgB',
        })),
    },
}));

vi.mock('../../adapters/aws/s3', () => ({
    getPublicUrl: (key: string) => `http://localhost:8800/_local-assets/${key}`,
    putObject: vi.fn(async () => undefined),
}));

const sourceInput = {
    collectionMode: 'url',
    primaryUrl: 'https://example.com/article',
    keywords: ['AI 칩', '상장', '세레브라스'],
    articles: [
        {
            id: 'source-1',
            title: '세계 최대 AI 칩 기업 상장 추진',
            url: 'https://example.com/article',
            source: 'Example News',
            publishedAt: '2026-05-13',
            sourceType: 'news',
            confidence: 0.9,
            summary: 'AI 칩 기업이 나스닥 상장을 추진하며 시장의 관심을 받고 있다.',
            fullText:
                '<html><body>AI 칩 기업이 나스닥 상장을 추진한다. 투자자들은 성장성과 수익성을 함께 보고 있다.</body></html>',
            primarySource: true,
            sourcePriority: 1,
        },
    ],
};

function openaiResponse(content: Record<string, unknown>) {
    return {
        content: JSON.stringify(content),
        model: 'gpt-test',
        inputTokens: 100,
        outputTokens: 200,
        latencyMs: 1,
    };
}

describe('longform blocks', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.unstubAllGlobals();
        vi.mocked(openaiAdapter.chatJson).mockImplementation(async request => {
            const systemPrompt = request.systemPrompt;
            if (systemPrompt.includes('longform source researcher')) {
                return openaiResponse({
                    sourceDigest: ['AI 칩 기업이 나스닥 상장을 추진하고 투자자들이 성장성과 수익성을 함께 본다.'],
                    factualSpine: {
                        what: 'AI 칩 기업의 나스닥 상장 추진',
                        whyItMatters: 'AI 인프라 투자 흐름을 보여준다.',
                        caveats: ['수익성은 추가 확인이 필요하다.'],
                    },
                    keywords: ['AI 칩', '상장', '세레브라스'],
                    confidence: 0.91,
                });
            }
            if (systemPrompt.includes('longform angle strategist')) {
                return openaiResponse({
                    titleCandidates: ['AI 칩 상장, 왜 중요한가', '세레브라스 상장 핵심 정리'],
                    viewerPromise: 'AI 칩 상장 이슈의 핵심과 본질을 이해할 수 있다.',
                    targetViewer: 'AI 인프라와 시장 흐름을 알고 싶은 시청자',
                    angle: '기술력보다 상장 이후 지속 가능한 사업성이 핵심이다.',
                    structure: 'explainer',
                    evidencePlan: [{ sourceId: 'source-1', useAt: 'context', visualUse: 'source-proof' }],
                });
            }
            if (systemPrompt.includes('longform visual storyboard director')) {
                return openaiResponse({
                    visualChapters: Array.from({ length: 5 }, (_, index) => ({
                        chapterId: `chapter-${index + 1}`,
                        sectionId: `section-${index + 1}`,
                        headline: index === 0 ? '상장 추진' : `챕터 ${index + 1}`,
                        visualArchetype: index === 0 ? 'source-proof' : 'comparison',
                        viewerPurpose: '뉴스의 출처와 핵심을 확인시킨다.',
                        objects: [
                            {
                                id: `section-${index + 1}-headline`,
                                type: 'headline',
                                text: index === 0 ? '상장 추진' : `챕터 ${index + 1}`,
                            },
                        ],
                        motionPlan: '기사 카드가 확대되고 핵심 문장에 밑줄이 그어진다.',
                    })),
                });
            }
            if (systemPrompt.includes('longform motion graphics director')) {
                return openaiResponse({
                    motionStyle: 'premium Korean explainer motion graphics',
                    sceneDirectives: [
                        {
                            sceneId: 'scene-1',
                            targetIds: ['section-1-headline'],
                            cueTypes: ['source-card-zoom', 'underline', 'camera-push'],
                            pacing: 'steady',
                            description: '헤드라인 카드 확대와 밑줄 강조',
                        },
                    ],
                    compositionNotes: ['자막과 내레이션의 타이밍을 기준으로 모션을 맞춘다.'],
                });
            }
            return openaiResponse({
                sourceDigest: ['세계 최대 AI 칩 기업의 나스닥 상장 추진과 투자자 반응을 정리한다.'],
                outline: [
                    { title: '오프닝', summary: '왜 지금 이 이슈가 중요한지 짚는다.' },
                    { title: '배경', summary: '기업과 시장 상황을 설명한다.' },
                    { title: '핵심', summary: '투자자가 보는 성장성과 수익성 논점을 설명한다.' },
                    { title: '리스크', summary: '아직 확인해야 할 조건을 분리한다.' },
                    { title: '정리', summary: '시청자가 가져갈 관점을 제시한다.' },
                ],
                fullScriptDraft:
                    '세계 최대 AI 칩 기업의 상장 추진은 단순한 기업 뉴스가 아닙니다.\n\n투자자들은 성장성과 수익성을 함께 보고 있습니다.\n\n그래서 이 이슈는 기술력보다 사업 모델의 지속 가능성이 핵심입니다.',
                scenePlan: [
                    { sceneNumber: 1, title: '상장 추진', visualPlan: '기사 원문과 기업 로고 카드', durationSec: 40 },
                    { sceneNumber: 2, title: '투자 포인트', visualPlan: '성장성 vs 수익성 비교', durationSec: 40 },
                    { sceneNumber: 3, title: '정리', visualPlan: '핵심 메시지 카드', durationSec: 40 },
                ],
                estimatedDurationSec: 300,
                estimatedCost: { currency: 'USD', total: 0.2, notes: ['Planning only'] },
                rendererRoute: 'hyperframes',
                qaChecklist: ['출처 확인', '대본 검수', '씬 승인'],
            });
        });
        vi.mocked(openaiAdapter.webSearchJson).mockResolvedValue({
            content: JSON.stringify({
                keywords: ['fallback'],
                articles: [
                    {
                        title: '보조 검색 결과',
                        url: 'https://news.example.com/fallback',
                        source: 'Example News',
                        publishedAt: null,
                        sourceType: 'news',
                        confidence: 0.7,
                        summary: '원문을 직접 읽지 못한 보조 검색 결과입니다.',
                    },
                ],
                trendScore: 50,
            }),
            model: 'gpt-search-test',
            inputTokens: 10,
            outputTokens: 20,
            latencyMs: 1,
        });
    });

    it('normalizes source research without leaking raw XML or HTML dumps', async () => {
        const result = await longformSourceBlock.execute(sourceInput, { userRequest: '롱폼 만들어줘' });

        expect(result.output.primarySources).toHaveLength(1);
        expect(result.output.sourceDigest).toEqual(
            expect.arrayContaining([expect.stringContaining('투자자들이 성장성과 수익성')])
        );
        expect(JSON.stringify(result.output)).not.toContain('<html>');
        expect(openaiAdapter.chatJson).toHaveBeenCalledWith(
            expect.objectContaining({
                systemPrompt: expect.stringContaining('longform source researcher'),
                userMessage: expect.stringContaining('AI 칩 기업이 나스닥 상장을 추진한다'),
            })
        );
    });

    it('collects primary URL text when the user request contains a URL but upstream articles are absent', async () => {
        const fetchMock = vi.fn(async () => {
            const html = `
                <html>
                  <head>
                    <meta property="og:title" content="우로보로스 설명">
                    <meta property="og:site_name" content="Example Blog">
                  </head>
                  <body>
                    <article>
                      <p>우로보로스는 꼬리를 문 뱀의 이미지로 순환 구조를 설명할 때 자주 쓰입니다.</p>
                      <p>하네스 엔지니어링 맥락에서는 반복되는 제작과 검증 과정을 이해하는 비유로 볼 수 있습니다.</p>
                    </article>
                  </body>
                </html>`;
            return new Response(html, {
                status: 200,
                headers: { 'content-type': 'text/html; charset=utf-8' },
            });
        });
        vi.stubGlobal('fetch', fetchMock);

        const result = await longformSourceBlock.execute(undefined, {
            userRequest: '롱폼 만들어줘. 이 링크 설명해줘 https://example.com/ouroboros',
        });

        expect(fetchMock).toHaveBeenCalledWith('https://example.com/ouroboros', expect.any(Object));
        expect(result.output.primarySources).toEqual([
            expect.objectContaining({
                title: '우로보로스 설명',
                url: 'https://example.com/ouroboros',
                primarySource: true,
            }),
        ]);
        expect(JSON.stringify(result.output)).toContain('우로보로스');
        expect(JSON.stringify(result.output)).not.toContain('<article>');
    });

    it('fails URL-based longform collection instead of silently writing from fallback search when the primary URL is unreadable', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('not found', { status: 404 }))
        );

        await expect(
            longformSourceBlock.execute(undefined, {
                userRequest: '롱폼 만들어줘. 이 링크 설명해줘 https://example.com/missing',
            })
        ).rejects.toThrow(/requires readable primary URL text/i);
    });

    it('builds a longform brief with duration and evidence plan', async () => {
        const source = (await longformSourceBlock.execute(sourceInput)).output;
        const result = await longformBriefBlock.execute(source, { targetDurationSec: 300 });

        expect(result.output.viewerPromise).toContain('핵심');
        expect(result.output.structure).toBe('explainer');
        expect(result.output.estimatedDurationSec).toBe(300);
        expect(result.output.evidencePlan).toHaveLength(1);
        expect(openaiAdapter.chatJson).toHaveBeenCalledWith(
            expect.objectContaining({
                systemPrompt: expect.stringContaining('longform angle strategist'),
                userMessage: expect.stringContaining('AI 칩'),
            })
        );
    });

    it('creates script sections and source map from the brief', async () => {
        const source = (await longformSourceBlock.execute(sourceInput)).output;
        const brief = (await longformBriefBlock.execute(source, { targetDurationSec: 300 })).output;
        const result = await longformScriptBlock.execute(brief);

        expect(result.output.fullScriptDraft).toContain('AI 칩');
        expect(result.output.fullScriptDraft).toContain('투자자들은 성장성과 수익성');
        expect(result.output.sections).toHaveLength(5);
        expect(result.output.sourceMap).toEqual(
            expect.arrayContaining([expect.objectContaining({ sourceIds: ['source-1'] })])
        );
        expect(openaiAdapter.chatJson).toHaveBeenCalledWith(
            expect.objectContaining({
                userMessage: expect.stringContaining('투자자들은 성장성과 수익성'),
            })
        );
    });

    it('turns script sections into visual chapters rather than one scene per subtitle cue', async () => {
        const source = (await longformSourceBlock.execute(sourceInput)).output;
        const brief = (await longformBriefBlock.execute(source, { targetDurationSec: 300 })).output;
        const script = (await longformScriptBlock.execute(brief)).output;
        const result = await longformStoryboardBlock.execute(script);

        expect(result.output.visualChapters).toHaveLength(5);
        expect(result.output.visualChapters[0]).toEqual(
            expect.objectContaining({
                visualArchetype: expect.stringMatching(/source-proof|timeline|comparison|chapter-board/),
                objects: expect.any(Array),
            })
        );
        expect(openaiAdapter.chatJson).toHaveBeenCalledWith(
            expect.objectContaining({
                systemPrompt: expect.stringContaining('longform visual storyboard director'),
                userMessage: expect.stringContaining('투자자들은 성장성과 수익성'),
            })
        );
    });

    it('falls back to section-based storyboard chapters when the AI storyboard JSON is truncated', async () => {
        vi.mocked(openaiAdapter.chatJson).mockResolvedValueOnce({
            content:
                '{"visualChapters":[{"chapterId":"chapter-1","sectionId":"section-1","headline":"상장 추진","visualArchetype":"source-proof","objects":[{"id":"section-1-headline","type":"headline","text":"상장 추진"}]}',
            model: 'gpt-test',
            inputTokens: 100,
            outputTokens: 200,
            latencyMs: 1,
        });

        const result = await longformStoryboardBlock.execute({
            fullScriptDraft:
                '세계 최대 AI 칩 기업의 상장 추진은 단순한 기업 뉴스가 아닙니다.\n\n투자자들은 성장성과 수익성을 함께 보고 있습니다.',
            sections: [
                {
                    sectionId: 'section-1',
                    title: '상장 추진',
                    narration: '세계 최대 AI 칩 기업의 상장 추진은 단순한 기업 뉴스가 아닙니다.',
                },
                {
                    sectionId: 'section-2',
                    title: '투자 포인트',
                    narration: '투자자들은 성장성과 수익성을 함께 보고 있습니다.',
                },
            ],
            sourceMap: [{ sectionId: 'section-1', sourceIds: ['source-1'] }],
        });

        expect(result.output.visualChapters).toHaveLength(2);
        expect(result.output.visualChapters[0]).toEqual(
            expect.objectContaining({
                sectionId: 'section-1',
                headline: '상장 추진',
                objects: expect.arrayContaining([expect.objectContaining({ id: 'section-1-headline' })]),
            })
        );
        expect(result.output.aiStoryboard).toEqual(
            expect.objectContaining({
                recovered: true,
                recoveryReason: expect.stringContaining('longform visual storyboard director'),
            })
        );
    });

    it('builds a HyperFrames scene JSON contract with per-cue activity', async () => {
        const source = (await longformSourceBlock.execute(sourceInput)).output;
        const brief = (await longformBriefBlock.execute(source, { targetDurationSec: 300 })).output;
        const script = (await longformScriptBlock.execute(brief)).output;
        const storyboard = (await longformStoryboardBlock.execute(script)).output;
        const result = await longformSceneJsonBlock.execute(storyboard);

        expect(result.output.renderer).toBe('hyperframes');
        expect(result.output.resolution).toBe('2560x1440');
        expect(result.output.scenes[0].perCueActivity.length).toBeGreaterThan(0);
        expect(result.output.scenes[0]).toEqual(
            expect.objectContaining({
                visualType: 'source-proof',
                visualData: expect.objectContaining({
                    title: '상장 추진',
                    claims: expect.any(Array),
                }),
                subtitleDraft: expect.any(String),
                onScreenTextPlan: expect.any(Array),
            })
        );
        expect(JSON.stringify(result.output.scenes)).not.toContain('chapter-board');
    });

    it('converts storyboard chapter-board fallbacks into meaningful visual contracts', async () => {
        const result = await longformSceneJsonBlock.execute({
            visualChapters: [
                {
                    chapterId: 'chapter-1',
                    sectionId: 'section-1',
                    headline: '탈출 사건 핵심',
                    visualArchetype: 'chapter-board',
                    viewerPurpose: '사건 흐름을 단계별로 보여준다.',
                    objects: [
                        { id: 'section-1-headline', type: 'headline', text: '탈출 사건 핵심' },
                        { id: 'section-1-step-1', type: 'caption', text: '대전 오월드에서 탈출' },
                        { id: 'section-1-step-2', type: 'caption', text: '수색이 길어지며 관심이 커짐' },
                    ],
                },
            ],
        });

        expect(result.output.scenes[0]).toEqual(
            expect.objectContaining({
                layout: 'fact-card',
                visualType: 'fact-card',
                visualData: expect.objectContaining({
                    body: expect.stringContaining('대전 오월드'),
                }),
            })
        );
        expect(JSON.stringify(result.output.scenes)).not.toContain('chapter-board');
    });

    it('targets real scene object ids when composing longform motion cues', async () => {
        const source = (await longformSourceBlock.execute(sourceInput)).output;
        const brief = (await longformBriefBlock.execute(source, { targetDurationSec: 300 })).output;
        const script = (await longformScriptBlock.execute(brief)).output;
        const storyboard = (await longformStoryboardBlock.execute(script)).output;
        const sceneContract = (await longformSceneJsonBlock.execute(storyboard)).output;
        const result = await longformMotionComposeBlock.execute({
            ...sceneContract,
            subtitleCues: [{ sceneNumber: 1, text: '첫 자막입니다.', startSec: 0, endSec: 2 }],
        });

        const firstSceneObjectIds = sceneContract.scenes[0].objects.map((object: { id: string }) => object.id);
        expect(result.output.motionCues[0].targetIds).toEqual(
            expect.arrayContaining([expect.stringMatching(/^section-1-/)])
        );
        expect(firstSceneObjectIds).toEqual(expect.arrayContaining(result.output.motionCues[0].targetIds));
        expect(openaiAdapter.chatJson).toHaveBeenCalledWith(
            expect.objectContaining({
                systemPrompt: expect.stringContaining('longform motion graphics director'),
                userMessage: expect.stringContaining('첫 자막입니다.'),
            })
        );
        const motionRequest = vi
            .mocked(openaiAdapter.chatJson)
            .mock.calls.find(call => call[0].systemPrompt.includes('longform motion graphics director'))?.[0];
        expect(motionRequest?.userMessage).toContain('"subtitleTiming"');
        expect(motionRequest?.userMessage).not.toContain('"subtitleCues"');
    });

    it('creates a draft review artifact that blocks media execution by default', async () => {
        const result = await longformReviewBlock.execute({
            fullScriptDraft: '검수 대상 대본',
            visualChapters: [{ chapterId: 'chapter-1' }],
            scenes: [{ sceneId: 'scene-1' }],
        });

        expect(result.output.reviewStatus).toBe('draft');
        expect(result.output.mediaExecutionAllowed).toBe(false);
        expect(result.output.gate).toBe('A');
    });

    it('keeps a saved longform review draft blocked until the user explicitly approves media execution', async () => {
        const reviewedOutput = {
            fullScriptDraft: '사용자가 확인한 최종 롱폼 대본입니다.',
            visualChapters: [{ chapterId: 'chapter-1', headline: '핵심 장면' }],
            scenes: [{ sceneId: 'scene-1', headline: '핵심 장면' }],
        };

        const result = await longformReviewBlock.execute(
            {
                fullScriptDraft: '초안',
                visualChapters: [{ chapterId: 'chapter-0' }],
            },
            {
                reviewedOutput: JSON.stringify(reviewedOutput),
            }
        );

        expect(result.output.reviewStatus).toBe('draft');
        expect(result.output.mediaExecutionAllowed).toBe(false);
        expect(result.output.gateBApproved).toBe(false);
        expect(result.output.approvedGateAArtifact).toBeUndefined();
    });

    it('does not let upstream payload flags approve longform paid execution without review config approval', async () => {
        const result = await longformReviewBlock.execute({
            fullScriptDraft: '입력 payload에만 승인 플래그가 있는 대본입니다.',
            scenePlan: [{ sceneNumber: 1, title: '입력 장면' }],
            reviewStatus: 'approved',
            mediaExecutionAllowed: true,
            gateBApproved: true,
        });

        expect(result.output.reviewStatus).toBe('draft');
        expect(result.output.mediaExecutionAllowed).toBe(false);
        expect(result.output.gateBApproved).toBe(false);
        expect(result.output.approvedGateAArtifact).toBeUndefined();
    });

    it('lets an explicitly approved script carry a Gate A artifact into the review node', async () => {
        const script = await longformScriptBlock.execute(
            {
                mode: 'longform-gate-a',
                topic: '테스트 롱폼',
                primarySources: [{ id: 'source-1', title: '원문', summary: '핵심 요약' }],
                sections: [{ sectionId: 'section-1', title: '핵심', narration: '승인된 대본입니다.' }],
            },
            {
                reviewStatus: 'approved',
                approvedArtifactId: 'script-approved-artifact',
            }
        );

        expect(script.output.reviewStatus).toBe('approved');
        expect(script.output.mediaExecutionAllowed).toBe(true);
        expect(script.output.gateBApproved).toBe(true);
        expect(script.output.approvedGateAArtifact).toEqual(
            expect.objectContaining({
                mode: 'longform-gate-a',
                reviewStatus: 'approved',
                approvedArtifactId: 'script-approved-artifact',
            })
        );

        const review = await longformReviewBlock.execute(script.output);

        expect(review.output.reviewStatus).toBe('approved');
        expect(review.output.mediaExecutionAllowed).toBe(true);
        expect(review.output.gateBApproved).toBe(true);
        expect(review.output.approvedGateAArtifact).toEqual(
            expect.objectContaining({
                approvedArtifactId: 'script-approved-artifact',
            })
        );
    });

    it('turns an explicitly approved longform review draft into a Gate A artifact', async () => {
        const reviewedOutput = {
            fullScriptDraft: '사용자가 확인한 최종 롱폼 대본입니다.',
            visualChapters: [{ chapterId: 'chapter-1', headline: '핵심 장면' }],
            scenes: [{ sceneId: 'scene-1', headline: '핵심 장면' }],
        };

        const result = await longformReviewBlock.execute(
            {
                fullScriptDraft: '초안',
                visualChapters: [{ chapterId: 'chapter-0' }],
            },
            {
                reviewedOutput: JSON.stringify(reviewedOutput),
                reviewStatus: 'approved',
            }
        );

        expect(result.output.reviewStatus).toBe('approved');
        expect(result.output.mediaExecutionAllowed).toBe(true);
        expect(result.output.gateBApproved).toBe(true);
        expect(result.output.approvedGateAArtifact).toEqual(
            expect.objectContaining({
                mode: 'longform-gate-a',
                reviewStatus: 'approved',
                fullScriptDraft: '사용자가 확인한 최종 롱폼 대본입니다.',
                scenePlan: [expect.objectContaining({ title: '핵심 장면' })],
            })
        );
    });

    it('adapts an approved longform script into TTS input without dropping the artifact', async () => {
        const result = await longformTtsBlock.execute({
            mode: 'longform-gate-a',
            reviewStatus: 'approved',
            mediaExecutionAllowed: true,
            approvedGateAArtifact: {
                gate: 'A',
                mode: 'longform-gate-a',
                reviewStatus: 'approved',
                fullScriptDraft: '첫 문단입니다.\n\n두 번째 문단입니다.',
                scenePlan: [{ sceneNumber: 1, title: '첫 장면' }],
            },
            sections: [
                { sectionId: 'section-1', narration: '첫 문단입니다.' },
                { sectionId: 'section-2', narration: '두 번째 문단입니다.' },
            ],
        });

        expect(result.output.approvedGateAArtifact).toEqual(expect.objectContaining({ reviewStatus: 'approved' }));
        expect(result.output.audio).toEqual(
            expect.objectContaining({
                provider: 'elevenlabs',
                voiceId: expect.any(String),
            })
        );
        expect(result.output.normalizedScenes).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ sceneNumber: 1, narration: '첫 문단입니다.' }),
                expect.objectContaining({ sceneNumber: 2, narration: '두 번째 문단입니다.' }),
            ])
        );
    });

    it('uses approved longform narration instead of stale scene headlines for TTS', async () => {
        const result = await longformTtsBlock.execute({
            mode: 'longform-gate-a',
            reviewStatus: 'approved',
            mediaExecutionAllowed: true,
            approvedGateAArtifact: {
                gate: 'A',
                mode: 'longform-gate-a',
                reviewStatus: 'approved',
                fullScriptDraft: '승인된 첫 문단입니다.\n\n승인된 두 번째 문단입니다.',
                sections: [
                    { sectionId: 'section-1', narration: '승인된 첫 문단입니다.' },
                    { sectionId: 'section-2', narration: '승인된 두 번째 문단입니다.' },
                ],
                scenePlan: [{ sceneNumber: 1, title: '승인 장면' }],
            },
            scenes: [
                { sceneNumber: 1, headline: '오래된 장면 제목' },
                { sceneNumber: 2, headline: '읽으면 안 되는 헤드라인' },
            ],
        });

        expect(result.output.normalizedScenes).toEqual([
            expect.objectContaining({ sceneNumber: 1, narration: '승인된 첫 문단입니다.' }),
            expect.objectContaining({ sceneNumber: 2, narration: '승인된 두 번째 문단입니다.' }),
        ]);
        expect(JSON.stringify(result.output.normalizedScenes)).not.toContain('오래된 장면 제목');
        expect(JSON.stringify(result.output.normalizedScenes)).not.toContain('읽으면 안 되는 헤드라인');
    });

    it('preserves TTS subtitle cue timing instead of inventing fixed-duration cues', async () => {
        const result = await longformSrtAlignBlock.execute({
            audio: { durationSec: 9.5, provider: 'elevenlabs' },
            subtitleCues: [
                {
                    sceneNumber: 1,
                    text: '첫 문장입니다.',
                    role: 'scene',
                    startSec: 0,
                    endSec: 2.35,
                },
                {
                    sceneNumber: 2,
                    text: '두 번째 문장입니다.',
                    role: 'scene',
                    startSec: 2.35,
                    endSec: 9.5,
                },
            ],
        });

        expect(result.output.alignmentMethod).toBe('tts-duration-aligned');
        expect(result.output.subtitleCues).toEqual([
            expect.objectContaining({
                sceneNumber: 1,
                text: '첫 문장입니다.',
                startSec: 0,
                endSec: 2.35,
            }),
            expect.objectContaining({
                sceneNumber: 2,
                text: '두 번째 문장입니다.',
                startSec: 2.35,
                endSec: 9.5,
            }),
        ]);
    });

    it('fails SRT alignment when TTS did not produce timed subtitle cues', async () => {
        await expect(
            longformSrtAlignBlock.execute({
                transcriptText: '타이밍 없는 텍스트만 있으면 렌더 싱크를 보장할 수 없습니다.',
            })
        ).rejects.toThrow('longform-srt-align requires subtitle cues from TTS output');
    });

    it('fails longform QA when ffprobe metadata is missing audio even if a 2K preview URL exists', async () => {
        const result = await longformQaBlock.execute({
            video: {
                width: 2560,
                height: 1440,
                previewUrl: 'http://localhost:8800/_local-assets/video.mp4',
            },
            qa: {
                hasVideo: true,
                hasAudio: false,
                width: 2560,
                height: 1440,
                durationSec: 120,
            },
        });

        expect(result.output.qaReport).toEqual(
            expect.objectContaining({
                passed: false,
                checks: expect.objectContaining({
                    audioStream: false,
                    videoStream: true,
                    resolution2k: true,
                }),
            })
        );
    });

    it('fails longform QA when render contract did not prove subtitles, visuals, and motion', async () => {
        const result = await longformQaBlock.execute({
            video: {
                width: 2560,
                height: 1440,
                previewUrl: 'http://localhost:8800/_local-assets/video.mp4',
            },
            qa: {
                hasVideo: true,
                hasAudio: true,
                width: 2560,
                height: 1440,
                durationSec: 120,
            },
            longformProductionQa: {
                ttsProvider: 'elevenlabs',
                voiceId: 'pNInz6obpgDQGcFmaJgB',
                subtitleCueCount: 0,
                motionCueCount: 0,
                visualSceneCount: 1,
                visualDataSceneCount: 0,
                placeholderFree: false,
            },
        });

        expect(result.output.qaReport).toEqual(
            expect.objectContaining({
                passed: false,
                checks: expect.objectContaining({
                    subtitleLayer: false,
                    motionCues: false,
                    visualDensity: false,
                    placeholderFree: false,
                }),
            })
        );
    });
});
