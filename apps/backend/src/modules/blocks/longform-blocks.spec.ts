import { describe, expect, it, vi } from 'vitest';

import {
    longformBriefBlock,
    longformReviewBlock,
    longformSceneJsonBlock,
    longformScriptBlock,
    longformSourceBlock,
    longformSrtAlignBlock,
    longformStoryboardBlock,
    longformTtsBlock,
} from './longform-blocks';

vi.mock('../../adapters/ai/tts-adapter', () => ({
    ttsAdapter: {
        synthesize: vi.fn(async () => ({
            audioBuffer: Buffer.from('mock-longform-tts'),
            contentType: 'audio/mpeg',
            estimatedDurationSec: 2,
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

describe('longform blocks', () => {
    it('normalizes source research without leaking raw XML or HTML dumps', async () => {
        const result = await longformSourceBlock.execute(sourceInput, { userRequest: '롱폼 만들어줘' });

        expect(result.output.primarySources).toHaveLength(1);
        expect(result.output.sourceDigest).toEqual(
            expect.arrayContaining([expect.stringContaining('AI 칩 기업이 나스닥 상장을 추진')])
        );
        expect(JSON.stringify(result.output)).not.toContain('<html>');
    });

    it('builds a longform brief with duration and evidence plan', async () => {
        const source = (await longformSourceBlock.execute(sourceInput)).output;
        const result = await longformBriefBlock.execute(source, { targetDurationSec: 300 });

        expect(result.output.viewerPromise).toContain('핵심');
        expect(result.output.structure).toBe('explainer');
        expect(result.output.estimatedDurationSec).toBe(300);
        expect(result.output.evidencePlan).toHaveLength(1);
    });

    it('creates script sections and source map from the brief', async () => {
        const source = (await longformSourceBlock.execute(sourceInput)).output;
        const brief = (await longformBriefBlock.execute(source, { targetDurationSec: 300 })).output;
        const result = await longformScriptBlock.execute(brief);

        expect(result.output.fullScriptDraft).toContain('AI 칩');
        expect(result.output.sections).toHaveLength(5);
        expect(result.output.sourceMap).toEqual(
            expect.arrayContaining([expect.objectContaining({ sourceIds: ['source-1'] })])
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

    it('turns a saved longform review draft into an approved Gate A artifact', async () => {
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

    it('adapts an approved longform script into ElevenLabs TTS input without dropping the artifact', async () => {
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

        expect(result.output.alignmentMethod).toBe('elevenlabs-tts-duration-aligned');
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
        ).rejects.toThrow('longform-srt-align requires subtitle cues from ElevenLabs TTS output');
    });
});
