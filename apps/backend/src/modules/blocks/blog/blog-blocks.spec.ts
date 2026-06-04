import { describe, expect, it, vi } from 'vitest';

import { blogAssembleBlock } from './blog-assemble-block';
import { blogDraftBlock } from './blog-draft-block';
import { blogExportBlock } from './blog-export-block';
import { blogImagePlanBlock } from './blog-image-plan-block';
import { blogOutlineBlock } from './blog-outline-block';

// Block-level behavior tests for the blog v2 pipeline. Filename contains "blog" so the
// repo's targeted test gate (which filters by the "blog" token) exercises them. All blocks
// run deterministically here via mock orchestrator mode.

vi.mock('../../../config/env', async importOriginal => {
    const actual = (await importOriginal()) as { env: Record<string, unknown> };
    return {
        ...actual,
        env: {
            ...actual.env,
            orchestratorMode: 'mock',
            openaiModel: 'gpt-test',
            openaiContentMaxTokens: 2048,
        },
    };
});

describe('blog-outline block', () => {
    it('produces an outline structure with H2 sections and a pending selection status', async () => {
        const result = await blogOutlineBlock.execute({ topic: '새벽배송' }, { topic: '새벽배송' });
        const output = result.output as Record<string, unknown>;

        expect(output['mode']).toBe('blog-outline');
        expect(output['outlineSelectionStatus']).toBe('pending');
        const sections = output['sections'] as Array<Record<string, unknown>>;
        expect(sections.length).toBeGreaterThanOrEqual(8);
        expect(sections.every(section => section['level'] === 2 || section['level'] === 3)).toBe(true);
        expect(
            sections.every(section => typeof section['id'] === 'string' && (section['id'] as string).length > 0)
        ).toBe(true);
    });

    it('carries grounded facts through outline so the chain can cite them', async () => {
        const result = await blogOutlineBlock.execute(
            {
                topic: '새벽배송',
                facts: [{ key: '배송 시간', value: '새벽 7시 이전', source: 'user' }],
                articles: [{ title: 'src', url: 'http://example.com' }],
            },
            { topic: '새벽배송' }
        );
        const output = result.output as Record<string, unknown>;
        expect(output['facts']).toEqual([{ key: '배송 시간', value: '새벽 7시 이전', source: 'user' }]);
        expect((output['articles'] as unknown[]).length).toBe(1);
    });

    it('marks the outline selected when a selection snapshot is seeded into config', async () => {
        const result = await blogOutlineBlock.execute(
            { topic: '새벽배송' },
            {
                topic: '새벽배송',
                outlineSelectionStatus: 'selected',
                selectedOutline: {
                    title: '내가 고른 제목',
                    sections: [{ id: 'h2-1', level: 2, heading: '직접 고른 섹션', summary: '요약', targetWords: 150 }],
                },
            }
        );
        const output = result.output as Record<string, unknown>;

        expect(output['outlineSelectionStatus']).toBe('selected');
        expect(output['title']).toBe('내가 고른 제목');
        expect((output['sections'] as unknown[]).length).toBe(1);
    });
});

describe('blog-draft block', () => {
    it('fills body paragraphs for every outline section', async () => {
        const outline = {
            topic: '새벽배송',
            title: '새벽배송 완벽 정리',
            sections: [
                { id: 'h2-1', level: 2, heading: '새벽배송이란', summary: '개념 설명' },
                { id: 'h2-2', level: 2, heading: '장점', summary: '장점 설명' },
            ],
        };
        const result = await blogDraftBlock.execute(outline, {});
        const output = result.output as Record<string, unknown>;
        const sections = output['sections'] as Array<Record<string, unknown>>;

        expect(output['mode']).toBe('blog-draft');
        expect(sections.map(section => section['id'])).toEqual(['h2-1', 'h2-2']);
        expect(sections.every(section => (section['paragraphs'] as unknown[]).length >= 1)).toBe(true);
    });
});

describe('blog-image-plan block', () => {
    it('returns positional image-slot contracts when includeImages is on', async () => {
        const draft = {
            topic: '새벽배송',
            title: '새벽배송 완벽 정리',
            sections: [
                { id: 'h2-1', level: 2, heading: '새벽배송이란', summary: '개념', paragraphs: ['p'] },
                { id: 'h2-2', level: 2, heading: '장점', summary: '장점', paragraphs: ['p'] },
            ],
        };
        const result = await blogImagePlanBlock.execute(draft, { includeImages: true });
        const output = result.output as Record<string, unknown>;
        const slots = output['imageSlots'] as Array<Record<string, unknown>>;

        expect(output['includeImages']).toBe(true);
        // hero + one slot per H2 section.
        expect(slots.length).toBe(3);
        const hero = slots[0];
        expect(hero['placement']).toBe('afterTitle');
        expect(hero['slotId']).toBe('hero');
        const sectionSlot = slots[1];
        expect(sectionSlot['placement']).toBe('afterSectionHeading');
        expect(sectionSlot['sectionId']).toBe('h2-1');
        expect(typeof sectionSlot['promptSource']).toBe('string');
        expect(typeof sectionSlot['caption']).toBe('string');
        expect(typeof sectionSlot['alt']).toBe('string');
    });

    it('returns empty slots when includeImages is off', async () => {
        const draft = {
            topic: '새벽배송',
            title: 't',
            sections: [{ id: 'h2-1', level: 2, heading: 'h', summary: 's', paragraphs: ['p'] }],
        };
        const result = await blogImagePlanBlock.execute(draft, { includeImages: false });
        const output = result.output as Record<string, unknown>;
        expect(output['includeImages']).toBe(false);
        expect(output['imageSlots']).toEqual([]);
    });
});

describe('blog-assemble block', () => {
    it('inserts images at their placement and builds the BlogDocument + previewModel', async () => {
        const upstream = {
            topic: '새벽배송',
            title: '새벽배송 완벽 정리',
            sections: [
                { id: 'h2-1', level: 2, heading: '새벽배송이란', paragraphs: ['첫 문단입니다.'] },
                { id: 'h2-2', level: 2, heading: '장점', paragraphs: ['장점 문단입니다.'] },
            ],
            facts: [{ key: '예시', value: '근거 있음', source: 'user' }],
            seo: { title: 'SEO 제목', description: 'SEO 설명', keywords: ['새벽배송'] },
            imageSlots: [
                {
                    slotId: 'hero',
                    placement: 'afterTitle',
                    purpose: 'hero',
                    promptSource: 'hero prompt',
                    caption: '대표',
                    alt: '대표 이미지',
                    imageUrl: 'http://example.com/hero.png',
                },
                {
                    slotId: 'section-h2-1',
                    placement: 'afterSectionHeading',
                    sectionId: 'h2-1',
                    purpose: 's1',
                    promptSource: 's1 prompt',
                    caption: '섹션1',
                    alt: '섹션1 이미지',
                    imageUrl: 'http://example.com/s1.png',
                },
            ],
        };
        const result = await blogAssembleBlock.execute(upstream, {});
        const output = result.output as Record<string, unknown>;
        const document = output['document'] as Record<string, unknown>;
        const preview = output['previewModel'] as { title: string; blocks: Array<Record<string, unknown>> };

        // hero attached, section h2-1 carries its slot id.
        expect((document['hero'] as Record<string, unknown>)['imageSlotId']).toBe('hero');
        const docSections = document['sections'] as Array<Record<string, unknown>>;
        expect(docSections[0]['imageSlots']).toEqual(['section-h2-1']);
        expect(docSections[1]['imageSlots']).toEqual([]);

        // preview order: title → hero image → highlight → heading(h2-1) → section image → paragraph ...
        const kinds = preview.blocks.map(block => block['kind']);
        const titleIndex = kinds.indexOf('title');
        const heroImageIndex = kinds.findIndex((kind, i) => kind === 'image' && preview.blocks[i]['slotId'] === 'hero');
        const headingIndex = preview.blocks.findIndex(
            block => block['kind'] === 'heading' && block['text'] === '새벽배송이란'
        );
        const sectionImageIndex = preview.blocks.findIndex(
            block => block['kind'] === 'image' && block['slotId'] === 'section-h2-1'
        );
        const paragraphIndex = preview.blocks.findIndex(
            block => block['kind'] === 'paragraph' && block['text'] === '첫 문단입니다.'
        );

        expect(titleIndex).toBeLessThan(heroImageIndex);
        expect(headingIndex).toBeLessThan(sectionImageIndex);
        expect(sectionImageIndex).toBeLessThan(paragraphIndex);
    });
});

describe('blog grounding chain', () => {
    it('preserves grounded facts from outline through draft, image-plan, and assemble', async () => {
        const facts = [{ key: '배송 시간', value: '새벽 7시 이전', source: 'user' }];

        const outline = await blogOutlineBlock.execute(
            { topic: '새벽배송', facts, articles: [{ title: 's', url: 'http://example.com' }] },
            { topic: '새벽배송' }
        );
        const draft = await blogDraftBlock.execute(outline.output, {});
        expect((draft.output as Record<string, unknown>)['facts']).toEqual(facts);

        const plan = await blogImagePlanBlock.execute(draft.output, { includeImages: false });
        expect((plan.output as Record<string, unknown>)['facts']).toEqual(facts);

        const assembled = await blogAssembleBlock.execute(plan.output, {});
        const document = (assembled.output as Record<string, unknown>)['document'] as Record<string, unknown>;
        expect(document['facts']).toEqual(facts);
    });

    it('keeps grounding when the outline output comes from a resume seed (block not re-run)', async () => {
        // On the checkpoint/resume path the outline block is NOT re-run; its output is replaced by
        // buildBlogOutlineResumeSeed, which must carry facts/articles. Simulate that seeded output
        // and confirm blog-draft still grounds on it (the path the grounding-chain test above missed).
        const facts = [{ key: '배송 시간', value: '새벽 7시 이전', source: 'user' }];
        const resumeSeedOutput = {
            mode: 'blog-outline',
            topic: '새벽배송',
            title: '내가 고른 제목',
            sections: [{ id: 'h2-1', level: 2, heading: '직접 고른 섹션', summary: '요약', targetWords: 150 }],
            outlineSelectionStatus: 'selected',
            facts,
            articles: [{ title: '출처', url: 'http://example.com' }],
        };

        const draft = await blogDraftBlock.execute(resumeSeedOutput, {});
        expect((draft.output as Record<string, unknown>)['facts']).toEqual(facts);
    });
});

describe('blog-export block', () => {
    it('emits naver html, markdown, and an image manifest (not markdown-only)', async () => {
        const document = {
            title: '새벽배송 완벽 정리',
            hero: { imageSlotId: 'hero', caption: '대표' },
            sections: [
                {
                    id: 'h2-1',
                    level: 2,
                    heading: '새벽배송이란',
                    paragraphs: ['첫 문단입니다.'],
                    imageSlots: ['section-h2-1'],
                },
            ],
            seo: { title: 'SEO 제목', description: 'SEO 설명', keywords: ['새벽배송'] },
            facts: [],
            imageSlots: [
                {
                    slotId: 'hero',
                    placement: 'afterTitle',
                    purpose: 'hero',
                    promptSource: 'p',
                    caption: '대표',
                    alt: '대표 이미지',
                    imageUrl: 'http://example.com/hero.png',
                },
                {
                    slotId: 'section-h2-1',
                    placement: 'afterSectionHeading',
                    sectionId: 'h2-1',
                    purpose: 's',
                    promptSource: 'p',
                    caption: '섹션1',
                    alt: '섹션1 이미지',
                    imageUrl: 'http://example.com/s1.png',
                },
            ],
        };
        const result = await blogExportBlock.execute({ document }, {});
        const output = result.output as Record<string, unknown>;

        const naverHtml = output['naverHtml'] as string;
        const markdown = output['markdown'] as string;
        const imageManifest = output['imageManifest'] as Array<Record<string, unknown>>;

        // naverHtml preserves title → hero image → heading → section image → paragraph order.
        expect(naverHtml).toContain('<h1>새벽배송 완벽 정리</h1>');
        expect(naverHtml.indexOf('hero.png')).toBeLessThan(naverHtml.indexOf('<h2>새벽배송이란</h2>'));
        expect(naverHtml.indexOf('<h2>새벽배송이란</h2>')).toBeLessThan(naverHtml.indexOf('s1.png'));
        expect(naverHtml.indexOf('s1.png')).toBeLessThan(naverHtml.indexOf('첫 문단입니다.'));
        expect(naverHtml).toContain('<figcaption>');

        // markdown is a backup, not the primary — but must still be present and non-empty.
        expect(markdown).toContain('# 새벽배송 완벽 정리');
        expect(markdown.length).toBeGreaterThan(0);

        // image manifest carries slotId/url/caption/alt for manual upload.
        expect(imageManifest).toEqual([
            { slotId: 'hero', url: 'http://example.com/hero.png', caption: '대표', alt: '대표 이미지' },
            { slotId: 'section-h2-1', url: 'http://example.com/s1.png', caption: '섹션1', alt: '섹션1 이미지' },
        ]);
    });
});
