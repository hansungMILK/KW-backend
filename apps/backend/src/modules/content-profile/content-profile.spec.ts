import { describe, expect, it } from 'vitest';

import {
    ContentProfileIdSchema,
    ProposalApproveRequestSchema,
    ReviewModeSchema,
    ScriptToneIdSchema,
    ScriptToneIntensitySchema,
} from '@flows/contracts';

import {
    CONTENT_PROFILE_OPTIONS,
    REVIEW_MODE_OPTIONS,
    SCRIPT_TONE_INTENSITY_OPTIONS,
    SCRIPT_TONE_OPTIONS,
    buildContentProfilePreferences,
    normalizeReviewMode,
    normalizeScriptToneId,
} from './content-profile';

describe('content profile preferences', () => {
    it('defaults a Shorts video request to the informative tone and direct-run review mode', () => {
        const prefs = buildContentProfilePreferences({
            userMessage: '쇼츠 만들어줘. 주제는 최신 AI 뉴스',
            outputType: 'video',
            hasMediaVideo: true,
        });

        expect(prefs.contentProfileId).toBe('shorts.info.v1');
        expect(prefs.scriptToneId).toBe('informative-reframe');
        expect(prefs.reviewMode).toBe('direct-run');
        expect(prefs.toneOptions.map(option => option.id)).toContain('news-anchor');
        expect(prefs.reviewModeOptions.map(option => option.id)).toEqual(['direct-run', 'script-first']);
    });

    it('honors explicit user tone language without hardcoding a topic', () => {
        expect(normalizeScriptToneId('뉴스앵커형으로 말해줘')).toBe('news-anchor');
        expect(normalizeScriptToneId('mz 말투로 해줘')).toBe('mz-viral');
        expect(normalizeScriptToneId('대화형 이야기처럼')).toBe('story-dialogue');
    });

    it('normalizes invalid review mode to direct-run', () => {
        expect(normalizeReviewMode('bad-value')).toBe('direct-run');
    });

    it('keeps option ids aligned with the shared proposal contract schemas', () => {
        expect(SCRIPT_TONE_OPTIONS.map(option => option.id).sort()).toEqual([...ScriptToneIdSchema.options].sort());
        expect(SCRIPT_TONE_INTENSITY_OPTIONS.map(option => option.id).sort()).toEqual(
            [...ScriptToneIntensitySchema.options].sort()
        );
        expect(REVIEW_MODE_OPTIONS.map(option => option.id).sort()).toEqual([...ReviewModeSchema.options].sort());
        expect(CONTENT_PROFILE_OPTIONS.map(option => option.id).sort()).toEqual(
            [...ContentProfileIdSchema.options].sort()
        );
    });

    it('accepts content profile fields in proposal approval requests', () => {
        const parsed = ProposalApproveRequestSchema.safeParse({
            scriptToneId: 'news-anchor',
            scriptToneIntensity: 'high',
            contentProfileId: 'shorts.info.v1',
            reviewMode: 'script-first',
        });

        expect(parsed.success).toBe(true);
    });
});
