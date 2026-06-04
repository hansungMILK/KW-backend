import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BlogPreview } from './BlogPreview';

import type { BlogPreviewModel } from './BlogPreview';

const sampleModel: BlogPreviewModel = {
    title: '제로웨이스트 입문 가이드',
    blocks: [
        { kind: 'title', text: '제로웨이스트 입문 가이드' },
        {
            kind: 'image',
            imageUrl: 'https://img.example/hero.jpg',
            caption: '대표 이미지 캡션',
            alt: 'hero',
            slotId: 'hero',
        },
        { kind: 'highlight', text: '핵심만 빠르게 정리한 강조 박스입니다.' },
        { kind: 'heading', level: 2, text: '왜 시작해야 할까' },
        { kind: 'paragraph', text: '첫 번째 문단 내용입니다.' },
        {
            kind: 'image',
            imageUrl: 'https://img.example/inline.jpg',
            caption: '인라인 캡션',
            alt: 'inline',
            slotId: 's1',
        },
        { kind: 'heading', level: 3, text: '작은 실천' },
        { kind: 'paragraph', text: '두 번째 문단 내용입니다.' },
        // image without a url must be skipped entirely (text-only flow)
        { kind: 'image', caption: '버려질 캡션', alt: 'missing', slotId: 's2' },
    ],
};

describe('BlogPreview', () => {
    it('renders title, headings, paragraphs, highlight box, and captioned images from previewModel', () => {
        render(<BlogPreview previewModel={sampleModel} />);

        // Title (h1)
        const heading = screen.getByRole('heading', { level: 1 });
        expect(heading.textContent).toContain('제로웨이스트 입문 가이드');

        // H2 + H3 sub-headings
        expect(screen.getByRole('heading', { level: 2 }).textContent).toContain('왜 시작해야 할까');
        expect(screen.getByRole('heading', { level: 3 }).textContent).toContain('작은 실천');

        // Paragraphs
        expect(screen.getByText('첫 번째 문단 내용입니다.')).toBeTruthy();
        expect(screen.getByText('두 번째 문단 내용입니다.')).toBeTruthy();

        // Highlight box
        expect(screen.getByText('핵심만 빠르게 정리한 강조 박스입니다.')).toBeTruthy();

        // Captioned images that HAVE a url render with figcaption
        expect(screen.getByText('대표 이미지 캡션')).toBeTruthy();
        expect(screen.getByText('인라인 캡션')).toBeTruthy();
    });

    it('renders the two images that have urls and skips the url-less image', () => {
        render(<BlogPreview previewModel={sampleModel} />);
        const imgs = screen.getAllByRole('img');
        expect(imgs).toHaveLength(2);
        expect(imgs.map(img => img.getAttribute('src'))).toEqual([
            'https://img.example/hero.jpg',
            'https://img.example/inline.jpg',
        ]);
        // The url-less image's caption must NOT be rendered.
        expect(screen.queryByText('버려질 캡션')).toBeNull();
    });

    it('falls back to rendering naverHtml when no previewModel is provided', () => {
        render(<BlogPreview naverHtml={'<h1>네이버 제목</h1>\n<p>본문 문단</p>'} />);
        expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('네이버 제목');
        expect(screen.getByText('본문 문단')).toBeTruthy();
    });

    it('renders nothing when neither source is provided', () => {
        const { container } = render(<BlogPreview />);
        expect(container.querySelector('[data-testid="blog-preview"]')).toBeNull();
    });
});
