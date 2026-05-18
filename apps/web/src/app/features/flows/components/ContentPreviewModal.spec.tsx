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
});
