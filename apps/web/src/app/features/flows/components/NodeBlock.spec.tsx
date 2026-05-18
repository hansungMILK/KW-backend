import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { NodeBlock } from './NodeBlock';

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

const renderNode = (node: NodeData) =>
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
});
