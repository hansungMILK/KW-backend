import { describe, expect, it } from 'vitest';

import { buildUserPrompt } from './prompt-templates';

describe('buildUserPrompt', () => {
    it('does not inject admission-specific guidance into generic link requests', () => {
        const prompt = buildUserPrompt('이 링크 내용을 설명해줘: https://example.com/article');

        expect(prompt).not.toContain('입시');
        expect(prompt).not.toContain('학년도');
        expect(prompt).not.toContain('대입');
    });

    it('does not inject topic-specific admission guidance into admission requests', () => {
        const prompt = buildUserPrompt('입시 쇼츠 만들어줘');

        expect(prompt).toContain('사용자 요청: "입시 쇼츠 만들어줘"');
        expect(prompt).not.toContain('학년도');
        expect(prompt).not.toContain('최신 공식 자료');
    });
});
