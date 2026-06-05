import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { NodeBlock, selectPreviewVariant } from './NodeBlock';

import type { ConfigValue } from './NodeBlock';
import type { BlockDefinitionWithFrontend, NodeData } from '@flows/flows';

const testState = vi.hoisted(() => ({
    registry: {} as Record<string, BlockDefinitionWithFrontend>,
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@flows/flows', async importOriginal => {
    const actual = (await importOriginal()) as Record<string, unknown>;
    return {
        ...actual,
        useBlockRegistry: () => testState.registry,
        useS3Image: (src: string) => ({ src, isLoading: false, error: null }),
    };
});

const makeDefinition = (type: string, label: string): BlockDefinitionWithFrontend => ({
    id: type,
    type,
    label,
    description: '',
    inputs: [{ id: 'in', label: 'Input', type: 'json' }],
    outputs: [{ id: 'out', label: 'Output', type: 'json' }],
    defaultConfig: {},
    isFrontend: false,
    stereo: 'process',
    isRunnable: true,
});

const makeNode = (type: string, value: unknown): NodeData => ({
    id: `node-${type}`,
    type,
    name: type,
    position: { x: 0, y: 0 },
    state: 'COMPLETED',
    config: {},
    inputData: {},
    outputData: {
        out: {
            type: 'json',
            value,
            timestamp: 1,
        },
    },
});

const renderNode = (
    node: NodeData,
    handlers?: {
        onConfigPatch?: (patch: Record<string, ConfigValue>) => void | Promise<void>;
    }
) =>
    render(
        <NodeBlock
            node={node}
            highlightState={{ isSelected: false }}
            portHandlers={{
                onPortMouseDown: vi.fn(),
                onPortMouseUp: vi.fn(),
            }}
            configHandlers={{
                onConfigChange: vi.fn(),
                onConfigPatch: handlers?.onConfigPatch,
                onLabelChange: vi.fn(),
                onToggleAuto: vi.fn(),
            }}
            actions={{
                onDelete: vi.fn(),
                onTrigger: vi.fn(),
                onViewLogs: vi.fn(),
            }}
            onMouseDown={vi.fn()}
        />
    );

describe('NodeBlock longform previews', () => {
    it('shows the same narration draft in the script preview and review editor', () => {
        testState.registry = {
            content: makeDefinition('content', '스크립트 생성'),
        };

        renderNode(
            makeNode('content', {
                title: '고죠 vs 나루토 풀전력 쇼츠',
                script: {
                    angle: '이건 설정 싸움이 아니라 판을 잡는 가상 대결입니다.',
                    cta: '누가 먼저 무너질지 댓글로 남겨주세요.',
                },
                scenes: [
                    {
                        sceneNumber: 1,
                        narration: '처음부터 풀전력이면 시작부터 숨이 막혀.',
                        caption: '풀전력 시작',
                    },
                    {
                        sceneNumber: 2,
                        narration: '고죠는 미동도 없고 나루토는 바로 압박해.',
                        caption: '압박 시작',
                    },
                ],
            })
        );

        expect(screen.getByText('검수 대상: 아래 나레이션 전체')).toBeTruthy();
        expect(screen.getByText('1. 처음부터 풀전력이면 시작부터 숨이 막혀.')).toBeTruthy();
        expect(screen.getByDisplayValue(/처음부터 풀전력이면 시작부터 숨이 막혀/)).toBeTruthy();
        expect(screen.queryByText(/이건 설정 싸움/)).toBeNull();
    });

    it('shows countryball dialogue lines as a script preview', () => {
        testState.registry = {
            'countryball-script': makeDefinition('countryball-script', '컨트리볼 대본 생성'),
        };

        renderNode(
            makeNode('countryball-script', {
                mode: 'countryball-script',
                title: '폴란드 K2 쇼크',
                scenes: [
                    {
                        sceneNumber: 1,
                        dialogueLines: [
                            { country: '폴란드', line: '에이, 무슨 한국산 전차야?' },
                            { country: '한국', line: '그럼 한번 테스트해보시죠.' },
                        ],
                    },
                    {
                        sceneNumber: 2,
                        dialogueLines: [{ country: '폴란드', line: '잠깐, 진흙탕에서 왜 날아다녀?' }],
                    },
                ],
            })
        );

        expect(screen.getByText('대본 크게 보기')).toBeTruthy();
        expect(screen.getByText('1. 폴란드: 에이, 무슨 한국산 전차야? / 한국: 그럼 한번 테스트해보시죠.')).toBeTruthy();
        fireEvent.click(screen.getByText('대본 크게 보기'));
        expect(screen.getByText('대본 문서')).toBeTruthy();
        expect(screen.getByText('폴란드: 에이, 무슨 한국산 전차야?')).toBeTruthy();
        expect(screen.getByText('한국: 그럼 한번 테스트해보시죠.')).toBeTruthy();
    });

    it('shows countryball dialogue lines from normalizedScenes', () => {
        testState.registry = {
            'countryball-data': makeDefinition('countryball-data', '컨트리볼 데이터 정규화'),
        };

        renderNode(
            makeNode('countryball-data', {
                mode: 'countryball-data',
                title: '밤 11시 주문, 아침 도착 실화?',
                normalizedScenes: [
                    {
                        sceneNumber: 1,
                        caption: '밤 11시 주문',
                        dialogueLines: [
                            { country: '미국', line: '너 지금 주문한다고?' },
                            { country: '한국', line: '응, 아침에 와.' },
                        ],
                    },
                ],
            })
        );

        expect(screen.getByText('대본 크게 보기')).toBeTruthy();
        expect(screen.getByText('1. 미국: 너 지금 주문한다고? / 한국: 응, 아침에 와.')).toBeTruthy();
    });

    it('shows countryball angle options and persists a selected snapshot without auto-running', async () => {
        testState.registry = {
            'countryball-angle-lab': makeDefinition('countryball-angle-lab', '컨트리볼 앵글 선택'),
        };
        const onConfigPatch = vi.fn(async () => undefined);

        renderNode(
            makeNode('countryball-angle-lab', {
                mode: 'countryball-angle-lab',
                angleOptions: [
                    {
                        id: 'angle_1',
                        title: '새벽 문앞 괴담',
                        oneLinePitch: '미국볼이 새벽 4시 문앞 소리를 침입 사건으로 오해한다.',
                        selectedMechanisms: [{ id: 'ordinary_as_absurd' }],
                        scenePreview: [{ beat: 1, scene: '밤 11시 30분 주문' }],
                    },
                    {
                        id: 'angle_2',
                        title: '계란이 출근보다 빠르다',
                        oneLinePitch: '계란 배송이 미국볼보다 먼저 하루를 시작한다.',
                        selectedMechanisms: [{ id: 'speed_pressure' }],
                        scenePreview: [{ beat: 1, scene: '아침 식탁' }],
                    },
                    {
                        id: 'angle_3',
                        title: '배송 상자 신앙',
                        oneLinePitch: '외국볼이 배송 상자를 신성한 물건처럼 받든다.',
                        selectedMechanisms: [{ id: 'ritualization' }],
                        scenePreview: [{ beat: 1, scene: '상자 앞 촛불' }],
                    },
                ],
                recommendedChoice: { id: 'angle_1', reason: '새벽배송 체감 포인트가 가장 선명함' },
                selectionPrompt: '세 가지 중 하나를 골라주세요.',
            }),
            { onConfigPatch }
        );

        expect(screen.getByText('컨트리볼 앵글 후보')).toBeTruthy();
        expect(screen.getByText('새벽 문앞 괴담')).toBeTruthy();
        expect(screen.getByText('계란이 출근보다 빠르다')).toBeTruthy();
        expect(screen.getByText(/마음에 드는 상황극을 고른 뒤/)).toBeTruthy();
        fireEvent.click(screen.getByText('1번 선택'));
        await waitFor(() => {
            expect(onConfigPatch).toHaveBeenCalledWith(
                expect.objectContaining({
                    selectedAngleId: 'angle_1',
                    angleSelectionStatus: 'selected',
                    selectedAngle: expect.objectContaining({ id: 'angle_1', title: '새벽 문앞 괴담' }),
                    angleOptions: expect.any(Array),
                    recommendedChoice: expect.any(Object),
                    selectionPrompt: '세 가지 중 하나를 골라주세요.',
                })
            );
        });
        // Immediate local feedback: the picked card flips to "선택됨" without a run.
        expect(await screen.findByText('선택됨 ✓')).toBeTruthy();
    });

    it('shows single-image prompt planning as an image prompt, not a script review card', () => {
        testState.registry = {
            content: makeDefinition('content', '이미지 프롬프트 구성'),
        };

        renderNode(
            makeNode('content', {
                mode: 'single-image',
                outputKind: 'image-prompt',
                title: '바나나 댄스',
                promptPlan: {
                    title: '바나나 댄스',
                    imagePrompt:
                        'A cheerful banana dancing under colorful stage lights, playful studio backdrop, dynamic pose, polished 3D character illustration',
                },
                style: { format: 'single-image', aspectRatio: '9:16', sceneCount: 1 },
                scenes: [
                    {
                        sceneNumber: 1,
                        storyBeat: 'single-image',
                        caption: '춤추는 바나나',
                        narration: '바나나가 무대 위에서 춤추는 장면입니다.',
                        imagePrompt:
                            'A cheerful banana dancing under colorful stage lights, playful studio backdrop, dynamic pose, polished 3D character illustration',
                    },
                ],
            })
        );

        expect(screen.getByText('이미지 프롬프트')).toBeTruthy();
        expect(screen.getByText('프롬프트 크게 보기')).toBeTruthy();
        expect(screen.queryByText('대본 크게 보기')).toBeNull();
    });

    it('shows the longform render node as a video result instead of repeating upstream planning text', () => {
        testState.registry = {
            'longform-render': makeDefinition('longform-render', '롱폼 2K 렌더'),
        };

        renderNode(
            makeNode('longform-render', {
                mode: 'longform-gate-a',
                titleCandidates: ['업스트림 기획안 제목'],
                fullScriptDraft: '이 긴 upstream 대본은 렌더 노드에서 반복 노출되면 안 됩니다.',
                scenes: [{ sceneId: 'scene-1', headline: '첫 장면', visualType: 'fact-card' }],
                video: {
                    type: 'video',
                    format: 'mp4',
                    url: 'http://localhost:8800/_local-assets/final.mp4',
                    durationSec: 43,
                },
            })
        );

        expect(screen.getAllByText('최종 영상').length).toBeGreaterThan(0);
        expect(screen.getByText('MP4 열기/다운로드')).toBeTruthy();
        expect(screen.queryByText('롱폼 제작 기획안')).toBeNull();
        expect(screen.queryByText(/upstream 대본/)).toBeNull();
    });

    it('shows longform QA as a verification summary instead of another video preview', () => {
        testState.registry = {
            'longform-qa': makeDefinition('longform-qa', '롱폼 QA'),
        };

        renderNode(
            makeNode('longform-qa', {
                video: {
                    type: 'video',
                    format: 'mp4',
                    url: 'http://localhost:8800/_local-assets/final.mp4',
                    durationSec: 43,
                },
                qaReport: {
                    passed: true,
                    checks: {
                        previewUrl: true,
                        videoStream: true,
                        audioStream: true,
                        resolution2k: true,
                        subtitleLayer: true,
                    },
                },
            })
        );

        expect(screen.getByText('QA 검수 결과')).toBeTruthy();
        expect(screen.getByText(/렌더 품질 통과/)).toBeTruthy();
        expect(screen.queryByText('MP4 열기/다운로드')).toBeNull();
    });

    it('shows the integration node as metadata instead of repeating the final video card', () => {
        testState.registry = {
            integration: makeDefinition('integration', '메타데이터 생성'),
        };

        renderNode(
            makeNode('integration', {
                title: '한성대 대동제 라인업 요약',
                description: '한성대학교 대동제 핵심 일정과 확인 포인트를 정리했습니다.',
                hashtags: ['#shorts', '#한성대', '#대동제'],
                publicUrl: 'http://localhost:8800/_local-assets/final.mp4',
                video: {
                    type: 'video',
                    format: 'mp4',
                    url: 'http://localhost:8800/_local-assets/final.mp4',
                    durationSec: 43,
                },
            })
        );

        expect(screen.getByText('메타데이터 생성 결과')).toBeTruthy();
        expect(screen.getAllByText('한성대 대동제 라인업 요약').length).toBeGreaterThan(0);
        expect(screen.getByText('#한성대')).toBeTruthy();
        expect(screen.queryByText('MP4 열기/다운로드')).toBeNull();
    });

    it('shows the longform package node as a download package summary', () => {
        testState.registry = {
            'longform-package': makeDefinition('longform-package', '롱폼 패키지'),
        };

        renderNode(
            makeNode('longform-package', {
                downloadUrl: 'http://localhost:8800/_local-assets/final.mp4',
                video: {
                    type: 'video',
                    format: 'mp4',
                    url: 'http://localhost:8800/_local-assets/final.mp4',
                    durationSec: 300,
                },
                qaReport: {
                    passed: true,
                },
                subtitleCues: [{ text: '자막입니다.', startSec: 0, endSec: 2 }],
            })
        );

        expect(screen.getByText('최종 패키지')).toBeTruthy();
        expect(screen.getByText('MP4 다운로드')).toBeTruthy();
        expect(screen.queryByText('MP4 열기/다운로드')).toBeNull();
    });

    it('renders a Naver-style blog preview from a blog-assemble previewModel (no export bar)', () => {
        testState.registry = {
            'blog-assemble': makeDefinition('blog-assemble', '블로그 조립'),
        };

        renderNode(
            makeNode('blog-assemble', {
                mode: 'blog-assemble',
                previewModel: {
                    title: '제로웨이스트 입문 가이드',
                    blocks: [
                        { kind: 'title', text: '제로웨이스트 입문 가이드' },
                        { kind: 'highlight', text: '핵심만 정리한 강조 박스입니다.' },
                        { kind: 'heading', level: 2, text: '왜 시작해야 할까' },
                        { kind: 'paragraph', text: '작은 변화부터 시작하면 됩니다.' },
                    ],
                },
            })
        );

        expect(screen.getByText('왜 시작해야 할까')).toBeTruthy();
        expect(screen.getByText('작은 변화부터 시작하면 됩니다.')).toBeTruthy();
        expect(screen.getByText('핵심만 정리한 강조 박스입니다.')).toBeTruthy();
        // blog-assemble has no export strings -> export bar is hidden.
        expect(screen.queryByText('blog.export.copyNaver')).toBeNull();
    });

    it('renders the export bar and naverHtml preview for a blog-export output', () => {
        testState.registry = {
            'blog-export': makeDefinition('blog-export', '블로그 내보내기'),
        };

        renderNode(
            makeNode('blog-export', {
                mode: 'blog-export',
                naverHtml: '<h1>제로웨이스트 입문 가이드</h1>\n<p>오늘부터 시작하세요.</p>',
                markdown: '# 제로웨이스트 입문 가이드\n\n오늘부터 시작하세요.',
                imageManifest: [{ slotId: 'hero', url: 'https://img.example/hero.jpg', caption: 'c', alt: 'a' }],
            })
        );

        // All three export actions are present.
        expect(screen.getByText('blog.export.copyNaver')).toBeTruthy();
        expect(screen.getByText('blog.export.copyMarkdown')).toBeTruthy();
        expect(screen.getByText('blog.export.downloadZip')).toBeTruthy();
        // naverHtml is rendered as the visual preview.
        expect(screen.getByText('오늘부터 시작하세요.')).toBeTruthy();
    });

    it('renders intermediate blog modes as a readable section summary, not longform (RC2)', () => {
        testState.registry = {
            'blog-outline': makeDefinition('blog-outline', '블로그 목차'),
        };

        renderNode(
            makeNode('blog-outline', {
                mode: 'blog-outline',
                topic: '제로웨이스트',
                title: '제로웨이스트 완벽 정리',
                sections: [
                    { id: 'h2-1', level: 2, heading: '왜 시작해야 할까', summary: '환경과 비용 절감.' },
                    { id: 'h2-2', level: 2, heading: '오늘 할 수 있는 것', summary: '작은 습관부터.' },
                ],
            })
        );

        // Uses section.heading (blog), NOT the longform "섹션 N" title path.
        expect(screen.getByText(/왜 시작해야 할까/)).toBeTruthy();
        expect(screen.getByText('환경과 비용 절감.')).toBeTruthy();
        // Title shows in the node body preview (and in the port tooltip summary).
        expect(screen.getAllByText('제로웨이스트 완벽 정리').length).toBeGreaterThan(0);
        // Longform-only labels must be absent.
        expect(screen.queryByText('대본 섹션')).toBeNull();
        expect(screen.queryByText('롱폼 제작 기획안')).toBeNull();
    });

    it('renders no-section blog modes (seo) without blanking and without longform', () => {
        testState.registry = {
            'blog-seo': makeDefinition('blog-seo', 'SEO 메타데이터'),
        };

        renderNode(
            makeNode('blog-seo', {
                mode: 'blog-seo',
                topic: '제로웨이스트',
                seo: { title: '제로웨이스트 완벽 정리', keyword: '제로웨이스트' },
                aeoSummary: '제로웨이스트는 쓰레기를 줄이는 생활 방식입니다.',
            })
        );

        // Title falls back to topic so the node never blanks.
        expect(screen.getAllByText('제로웨이스트').length).toBeGreaterThan(0);
        expect(screen.getByText('제로웨이스트는 쓰레기를 줄이는 생활 방식입니다.')).toBeTruthy();
        expect(screen.queryByText('롱폼 제작 기획안')).toBeNull();
    });
});

describe('selectPreviewVariant', () => {
    const blogModes = [
        'blog-brief',
        'blog-research',
        'blog-outline',
        'blog-draft',
        'blog-image-plan',
        'blog-images',
        'blog-seo',
        'blog-assemble',
        'blog-export',
    ];

    it.each(blogModes)('routes blog mode %s to the blog variant', mode => {
        expect(selectPreviewVariant({ mode, sections: [{ heading: 'h' }] })).toBe('blog');
    });

    it('routes a longform-gate-a record to longform', () => {
        expect(selectPreviewVariant({ mode: 'longform-gate-a' })).toBe('longform');
    });

    it('routes a record with fullScriptDraft and no blog mode to longform (regression c)', () => {
        expect(selectPreviewVariant({ fullScriptDraft: 'intro\n\nbody' })).toBe('longform');
    });

    it('routes a record with sections and no blog mode to longform (regression c)', () => {
        expect(selectPreviewVariant({ sections: [{ title: '섹션 1', narration: '...' }] })).toBe('longform');
    });

    it('routes a video record to video', () => {
        expect(selectPreviewVariant({ video: { url: 'https://x/clip.mp4' } })).toBe('video');
    });

    it('routes an images record to images', () => {
        expect(selectPreviewVariant({ images: [{ url: 'https://x/a.png' }] })).toBe('images');
    });

    it('routes a non-record to other', () => {
        expect(selectPreviewVariant('plain string')).toBe('other');
    });
});
