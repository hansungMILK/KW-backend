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
