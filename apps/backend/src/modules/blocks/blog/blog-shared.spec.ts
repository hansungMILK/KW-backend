import { describe, expect, it } from 'vitest';

import { extractStatedSubject } from './blog-shared';

// Filename contains "blog" so the repo's targeted test gate (filters by the "blog" token)
// exercises these. extractStatedSubject is the deterministic guard that wins over the nano
// decision LLM's surfaceTerms when the user explicitly marks the subject ("주제는 X").

describe('extractStatedSubject', () => {
    it('extracts the subject after 주제는, ignoring the leading command/format words', () => {
        expect(extractStatedSubject('블로그 글 생성해줘. 주제는 대한민국 월드컵 조편성 분석')).toBe(
            '대한민국 월드컵 조편성 분석'
        );
    });

    it('strips a trailing format word + command after the subject', () => {
        expect(extractStatedSubject('주제는 손흥민 이적 분석 블로그 써줘')).toBe('손흥민 이적 분석');
    });

    it('returns null when there is no subject marker (image request)', () => {
        expect(extractStatedSubject('63빌딩 그려줘')).toBeNull();
    });

    it('returns null when there is no subject marker (plain explainer request)', () => {
        expect(extractStatedSubject('RAG 설명하는 글')).toBeNull();
    });

    it('does not strip a format word that is part of the subject (only trailing command)', () => {
        expect(extractStatedSubject('주제는 블로그 마케팅 전략 써줘')).toBe('블로그 마케팅 전략');
    });

    it('does not eat a command prefix when 주제: is used', () => {
        expect(extractStatedSubject('주제: 생성형 AI')).toBe('생성형 AI');
    });

    it('handles a trailing period after the command', () => {
        expect(extractStatedSubject('주제는 손흥민 이적 분석 블로그 써줘.')).toBe('손흥민 이적 분석');
    });

    it('supports english markers', () => {
        expect(extractStatedSubject('write a post about: korean world cup group analysis')).toBe(
            'korean world cup group analysis'
        );
    });

    it('returns null when the subject after the marker is empty', () => {
        expect(extractStatedSubject('주제는 ')).toBeNull();
    });
});
