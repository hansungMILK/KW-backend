// Adversarial verification of the PREVIEW routing fix (RC2).
//
// RC2 fix: blog outputs are routed to the blog renderer by their explicit
// `mode` discriminant BEFORE any sections-shape -> longform check, so an
// intermediate blog payload that happens to carry a `sections` array is no
// longer hijacked by the longform renderer. The exported `selectPreviewVariant`
// is a pure mirror of FriendlyOutputPreview's dispatch order; this suite asserts
// the mirror's contract directly.

import { describe, expect, it, vi } from 'vitest';

import { selectPreviewVariant } from './NodeBlock';

// Importing NodeBlock.tsx executes the whole module graph; these two mocks are
// required just to load it under vitest (mirrors NodeBlock.spec.tsx preamble).
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@flows/flows', async importOriginal => {
    const actual = (await importOriginal()) as Record<string, unknown>;
    return {
        ...actual,
        useBlockRegistry: () => ({}),
        useS3Image: (src: string) => ({ src, isLoading: false, error: null }),
    };
});

describe('selectPreviewVariant — PREVIEW routing (RC2)', () => {
    // Every blog mode the task names. Each fixture carries a `sections` array —
    // that array is the exact shape that, pre-RC2, hijacked the payload into the
    // longform renderer. A blog fixture WITHOUT `sections` would silently fail to
    // exercise the regression, so the array is load-bearing here.
    const blogModes = [
        'blog-outline',
        'blog-draft',
        'blog-image-plan',
        'blog-images',
        'blog-seo',
        'blog-assemble',
        'blog-export',
    ] as const;

    it.each(blogModes)('routes blog mode %s (WITH a sections array) to the blog variant, not longform', mode => {
        const fixture = {
            mode,
            sections: [
                { heading: '섹션 1', narration: '본문 1' },
                { heading: '섹션 2', narration: '본문 2' },
            ],
        };
        const variant = selectPreviewVariant(fixture);
        expect(variant).toBe('blog');
        // Adversarial: assert it specifically did NOT fall to longform.
        expect(variant).not.toBe('longform');
    });

    it('routes an explicit longform-gate-a record to longform', () => {
        expect(selectPreviewVariant({ mode: 'longform-gate-a' })).toBe('longform');
    });

    it('routes a longform payload (fullScriptDraft + sections, NO blog mode) to longform (REGRESSION must hold)', () => {
        // Combined fixture per the task: a longform-shaped record carrying BOTH a
        // fullScriptDraft and a sections array but no blog `mode`. RC2 must not
        // over-correct and steal genuine longform payloads into the blog path.
        const fixture = {
            fullScriptDraft: '인트로\n\n본문\n\n결론',
            sections: [
                { title: '섹션 1', narration: '...' },
                { title: '섹션 2', narration: '...' },
            ],
        };
        const variant = selectPreviewVariant(fixture);
        expect(variant).toBe('longform');
        expect(variant).not.toBe('blog');
    });

    it('routes a video record to video', () => {
        expect(selectPreviewVariant({ video: { url: 'https://example.test/clip.mp4' } })).toBe('video');
    });

    it('routes an images record to images', () => {
        expect(selectPreviewVariant({ images: [{ url: 'https://example.test/a.png' }] })).toBe('images');
    });
});
