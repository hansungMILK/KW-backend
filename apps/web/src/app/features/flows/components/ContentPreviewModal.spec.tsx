import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ContentPreviewModal } from './ContentPreviewModal';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@flows/flows', () => ({
    downloadImage: vi.fn(),
    useS3Image: (src: string) => ({ src, isLoading: false, error: null }),
}));

describe('ContentPreviewModal', () => {
    it('shows only spoken narration in script previews, not planning angle text', () => {
        render(
            <ContentPreviewModal
                open
                onOpenChange={vi.fn()}
                content={{
                    type: 'script',
                    value: {
                        title: '고죠 vs 나루토 풀전력 쇼츠',
                        script: {
                            angle: '이건 설정 싸움이 아니라 판을 잡는 가상 대결입니다.',
                            cta: '누가 먼저 무너질지 댓글로 남겨주세요.',
                        },
                        scenes: [
                            {
                                narration: '처음부터 풀전력이면 시작부터 숨이 막혀.',
                            },
                            {
                                narration: '고죠는 미동도 없고 나루토는 바로 압박해.',
                            },
                        ],
                    },
                }}
            />
        );

        expect(screen.getByText('실제 영상에 읽히는 나레이션만 표시합니다.')).toBeTruthy();
        expect(screen.getByText('처음부터 풀전력이면 시작부터 숨이 막혀.')).toBeTruthy();
        expect(screen.getByText('고죠는 미동도 없고 나루토는 바로 압박해.')).toBeTruthy();
        expect(screen.queryByText(/이건 설정 싸움/)).toBeNull();
    });

    it('shows countryball dialogue lines in script previews', () => {
        render(
            <ContentPreviewModal
                open
                onOpenChange={vi.fn()}
                content={{
                    type: 'script',
                    value: {
                        mode: 'countryball-script',
                        title: '폴란드 K2 쇼크',
                        scenes: [
                            {
                                dialogueLines: [
                                    { country: '폴란드', line: '에이, 무슨 한국산 전차야?' },
                                    { country: '한국', line: '그럼 한번 테스트해보시죠.' },
                                ],
                            },
                        ],
                    },
                }}
            />
        );

        expect(screen.getByText('폴란드: 에이, 무슨 한국산 전차야?')).toBeTruthy();
        expect(screen.getByText('한국: 그럼 한번 테스트해보시죠.')).toBeTruthy();
    });

    it('shows countryball dialogue lines from normalized scenes in script previews', () => {
        render(
            <ContentPreviewModal
                open
                onOpenChange={vi.fn()}
                content={{
                    type: 'script',
                    value: {
                        mode: 'countryball-data',
                        title: '밤 11시 주문, 아침 도착 실화?',
                        normalizedScenes: [
                            {
                                caption: '밤 11시 주문',
                                dialogueLines: [
                                    { country: '미국', line: '너 지금 주문한다고?' },
                                    { country: '한국', line: '응, 아침에 와.' },
                                ],
                            },
                        ],
                    },
                }}
            />
        );

        expect(screen.getByText('미국: 너 지금 주문한다고?')).toBeTruthy();
        expect(screen.getByText('한국: 응, 아침에 와.')).toBeTruthy();
    });

    it('renders a blog document for the blog content type (RC4 크게 보기)', () => {
        render(
            <ContentPreviewModal
                open
                onOpenChange={vi.fn()}
                content={{
                    type: 'blog',
                    value: {
                        mode: 'blog-export',
                        naverHtml: '<h1>제로웨이스트 입문 가이드</h1>\n<p>오늘부터 시작하세요.</p>',
                        markdown: '# 제로웨이스트 입문 가이드\n\n오늘부터 시작하세요.',
                    },
                }}
            />
        );

        // The blog type renders BlogPreview (not the JSON catch-all).
        expect(screen.getByText('블로그')).toBeTruthy();
        expect(screen.getByText('오늘부터 시작하세요.')).toBeTruthy();
    });

    it('renders a blog document from a previewModel via the blog content type', () => {
        render(
            <ContentPreviewModal
                open
                onOpenChange={vi.fn()}
                content={{
                    type: 'blog',
                    value: {
                        mode: 'blog-assemble',
                        previewModel: {
                            title: '제로웨이스트 입문 가이드',
                            blocks: [
                                { kind: 'title', text: '제로웨이스트 입문 가이드' },
                                { kind: 'paragraph', text: '작은 변화부터 시작하면 됩니다.' },
                            ],
                        },
                    },
                }}
            />
        );

        expect(screen.getByText('작은 변화부터 시작하면 됩니다.')).toBeTruthy();
    });
});
