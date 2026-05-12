import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mediaVideoBlock } from './media-video-block';
import { putObject } from '../../adapters/aws/s3';
import { ffmpegAdapter } from '../../adapters/external/ffmpeg-adapter';

vi.mock('../../adapters/aws/s3', () => ({
    getPublicUrl: (key: string) => `http://localhost:8800/_local-assets/${key}`,
    putObject: vi.fn(async () => undefined),
}));

vi.mock('../../adapters/external/ffmpeg-adapter', () => ({
    ffmpegAdapter: {
        compose: vi.fn(async () => ({
            videoBuffer: Buffer.from('video'),
            durationSec: 5,
            sizeBytes: 5,
        })),
        probeVideo: vi.fn(async () => ({
            hasVideo: true,
            hasAudio: true,
            width: 2560,
            height: 1440,
            durationSec: 5,
        })),
    },
}));

vi.mock('../../services/trace-service', () => ({
    traceService: {
        record: vi.fn(async () => undefined),
    },
}));

vi.mock('../shorts/bgm/bgm-selector', () => ({
    selectBgmForShorts: vi.fn(() => undefined),
}));

describe('mediaVideoBlock', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('refuses longform Gate B before approved Gate A artifacts are provided', async () => {
        await expect(
            mediaVideoBlock.execute(
                longformVideoInput(),
                { mode: 'longform-gate-b', rendererRoute: 'hyperframes' },
                {
                    runId: 'run_1',
                    nodeId: 'node_1',
                }
            )
        ).rejects.toThrow(/approved planning artifact/i);

        expect(ffmpegAdapter.compose).not.toHaveBeenCalled();
        expect(putObject).not.toHaveBeenCalled();
    });

    it('blocks longform Gate B when estimated HTML and HyperFrames cost is above five dollars', async () => {
        await expect(
            mediaVideoBlock.execute(
                longformVideoInput({ gateBApproved: true }),
                {
                    mode: 'longform-gate-b',
                    rendererRoute: 'hyperframes',
                    htmlComposeEstimatedCostUsd: 2.75,
                    hyperframesRenderEstimatedCostUsd: 2.5,
                },
                {
                    runId: 'run_1',
                    nodeId: 'node_1',
                }
            )
        ).rejects.toThrow(/LONGFORM_HTML_RENDER_COST_LIMIT_EXCEEDED/);

        expect(ffmpegAdapter.compose).not.toHaveBeenCalled();
        expect(putObject).not.toHaveBeenCalled();
    });

    it('blocks longform Gate B when render cost estimates are missing', async () => {
        await expect(
            mediaVideoBlock.execute(
                longformVideoInput({ gateBApproved: true }),
                { mode: 'longform-gate-b', rendererRoute: 'hyperframes' },
                {
                    runId: 'run_1',
                    nodeId: 'node_1',
                }
            )
        ).rejects.toThrow(/requires render cost estimate/i);

        expect(ffmpegAdapter.compose).not.toHaveBeenCalled();
        expect(putObject).not.toHaveBeenCalled();
    });

    it('blocks longform Gate B when the Gate A artifact is not explicitly approved', async () => {
        await expect(
            mediaVideoBlock.execute(
                longformVideoInput({
                    gateBApproved: true,
                    approvedGateAArtifact: {
                        gate: 'A',
                        mode: 'longform-gate-a',
                        reviewStatus: 'rejected',
                        fullScriptDraft: '반려된 롱폼 대본입니다.',
                        scenePlan: [{ sceneNumber: 1, title: '첫 장면', durationSec: 5 }],
                        rendererRoute: 'hyperframes',
                        mediaExecutionAllowed: true,
                    },
                }),
                {
                    mode: 'longform-gate-b',
                    rendererRoute: 'hyperframes',
                    htmlComposeEstimatedCostUsd: 1,
                    hyperframesRenderEstimatedCostUsd: 1,
                },
                {
                    runId: 'run_1',
                    nodeId: 'node_1',
                }
            )
        ).rejects.toThrow(/approved planning artifact/i);

        expect(ffmpegAdapter.compose).not.toHaveBeenCalled();
        expect(putObject).not.toHaveBeenCalled();
    });

    it('renders approved longform Gate B as 2K MP4 with preview, download, and QA metadata', async () => {
        const result = await mediaVideoBlock.execute(
            longformVideoInput({ gateBApproved: true }),
            {
                mode: 'longform-gate-b',
                rendererRoute: 'hyperframes',
                backgroundMusic: false,
                htmlComposeEstimatedCostUsd: 1,
                hyperframesRenderEstimatedCostUsd: 1,
            },
            {
                runId: 'run_1',
                nodeId: 'node_1',
            }
        );

        expect(ffmpegAdapter.compose).toHaveBeenCalledTimes(1);
        expect(ffmpegAdapter.compose).toHaveBeenCalledWith(
            expect.objectContaining({
                outputWidth: 2560,
                outputHeight: 1440,
                outputFormat: 'mp4',
            })
        );
        expect(ffmpegAdapter.probeVideo).toHaveBeenCalledWith(Buffer.from('video'));
        expect(result.output.video).toMatchObject({
            url: expect.stringContaining('/media/video/'),
            previewUrl: expect.stringContaining('/media/video/'),
            downloadUrl: expect.stringContaining('/media/video/'),
            width: 2560,
            height: 1440,
            format: 'mp4',
        });
        expect(result.output.qa).toMatchObject({
            hasVideo: true,
            hasAudio: true,
            width: 2560,
            height: 1440,
        });
        expect(result.assets?.[0]?.metadata).toMatchObject({
            width: 2560,
            height: 1440,
            rendererRoute: 'hyperframes',
        });
    });

    it('rejects longform Gate B when ffprobe QA cannot confirm audio and video streams', async () => {
        vi.mocked(ffmpegAdapter.probeVideo).mockResolvedValueOnce({
            hasVideo: true,
            hasAudio: false,
            width: 2560,
            height: 1440,
            durationSec: 5,
        });

        await expect(
            mediaVideoBlock.execute(
                longformVideoInput({ gateBApproved: true }),
                {
                    mode: 'longform-gate-b',
                    rendererRoute: 'hyperframes',
                    backgroundMusic: false,
                    htmlComposeEstimatedCostUsd: 1,
                    hyperframesRenderEstimatedCostUsd: 1,
                },
                {
                    runId: 'run_1',
                    nodeId: 'node_1',
                }
            )
        ).rejects.toThrow(/ffprobe QA failed/i);

        expect(putObject).not.toHaveBeenCalled();
    });

    it('rejects longform Gate B when ffprobe reports a truncated duration', async () => {
        vi.mocked(ffmpegAdapter.probeVideo).mockResolvedValueOnce({
            hasVideo: true,
            hasAudio: true,
            width: 2560,
            height: 1440,
            durationSec: 1,
        });

        await expect(
            mediaVideoBlock.execute(
                longformVideoInput({ gateBApproved: true }),
                {
                    mode: 'longform-gate-b',
                    rendererRoute: 'hyperframes',
                    backgroundMusic: false,
                    htmlComposeEstimatedCostUsd: 1,
                    hyperframesRenderEstimatedCostUsd: 1,
                },
                {
                    runId: 'run_1',
                    nodeId: 'node_1',
                }
            )
        ).rejects.toThrow(/duration/i);

        expect(putObject).not.toHaveBeenCalled();
    });

    it('does not treat a generic gate B marker as longform without a longform Gate B mode', async () => {
        await mediaVideoBlock.execute(
            {
                ...longformVideoInput(),
                mode: 'video-render',
                gate: 'B',
                approvedGateAArtifact: undefined,
            },
            { backgroundMusic: false },
            {
                runId: 'run_1',
                nodeId: 'node_1',
            }
        );

        const request = vi.mocked(ffmpegAdapter.compose).mock.calls[0]?.[0];
        expect(request).toMatchObject({
            outputWidth: 1080,
            outputHeight: 1920,
        });
        expect(ffmpegAdapter.probeVideo).not.toHaveBeenCalled();
    });

    it('passes narration-derived subtitles to the video compositor instead of visual teaser captions', async () => {
        const abortController = new AbortController();
        const progress = vi.fn(async () => undefined);
        await mediaVideoBlock.execute(
            {
                images: [
                    {
                        url: 'http://localhost:8800/_local-assets/image-1.png',
                        sceneNumber: 1,
                        visualText: '짧은 티저',
                        caption: '짧은 캡션',
                    },
                ],
                normalizedScenes: [
                    {
                        sceneNumber: 1,
                        durationSec: 5,
                        narration: '이 문장이 실제 TTS로 읽히고 하단 자막에도 그대로 나와야 합니다.',
                        caption: '짧은 캡션',
                        visualText: '짧은 티저',
                    },
                ],
                subtitleCues: [
                    {
                        sceneNumber: 1,
                        text: '첫 훅도 실제 TTS 순서대로 하단 자막에 나와야 합니다.',
                        role: 'hook',
                        startSec: 0,
                        endSec: 1.7,
                    },
                    {
                        sceneNumber: 1,
                        text: '이 문장이 실제 TTS로 읽히고 하단 자막에도 그대로 나와야 합니다.',
                        role: 'scene',
                        startSec: 1.7,
                        endSec: 5.2,
                    },
                ],
                audio: {
                    url: 'http://localhost:8800/_local-assets/audio.mp3',
                    durationSec: 5.2,
                },
                metadata: {
                    title: '테스트 제목',
                },
            },
            { backgroundMusic: false },
            {
                runId: 'run_1',
                nodeId: 'node_1',
                abortSignal: abortController.signal,
                onProgress: progress,
            }
        );

        expect(ffmpegAdapter.compose).toHaveBeenCalledTimes(1);
        const request = vi.mocked(ffmpegAdapter.compose).mock.calls[0]?.[0];
        expect(request?.signal).toBeInstanceOf(AbortSignal);
        expect(request?.onProgress).toBeTypeOf('function');
        expect(request?.images).toHaveLength(2);
        expect(request?.images[0]).toMatchObject({
            title: '테스트 제목',
            durationSec: 1.7,
            caption: '첫 훅도 실제 TTS 순서대로 하단 자막에 나와야 합니다.',
        });
        expect(request?.images[1]).toMatchObject({
            title: '테스트 제목',
            durationSec: 3.5,
            caption: '이 문장이 실제 TTS로 읽히고 하단 자막에도 그대로 나와야 합니다.',
        });
        expect(progress).toHaveBeenCalledWith(35, '영상 합성 입력 준비 완료');
    });

    it('rescales stale subtitle cues to the real TTS audio duration', async () => {
        await mediaVideoBlock.execute(
            {
                images: [
                    {
                        url: 'http://localhost:8800/_local-assets/image-1.png',
                        sceneNumber: 1,
                    },
                    {
                        url: 'http://localhost:8800/_local-assets/image-2.png',
                        sceneNumber: 2,
                    },
                ],
                subtitleCues: [
                    {
                        sceneNumber: 1,
                        text: '첫 번째 자막',
                        startSec: 0,
                        endSec: 30,
                    },
                    {
                        sceneNumber: 2,
                        text: '두 번째 자막',
                        startSec: 30,
                        endSec: 60,
                    },
                ],
                audio: {
                    url: 'http://localhost:8800/_local-assets/audio.mp3',
                    durationSec: 31,
                },
            },
            { backgroundMusic: false },
            {
                runId: 'run_1',
                nodeId: 'node_1',
            }
        );

        const request = vi.mocked(ffmpegAdapter.compose).mock.calls[0]?.[0];
        expect(request?.images).toEqual([
            expect.objectContaining({ durationSec: 15.5, caption: '첫 번째 자막' }),
            expect.objectContaining({ durationSec: 15.5, caption: '두 번째 자막' }),
        ]);
    });

    it('normalizes placeholder source ids before passing segments to the video compositor', async () => {
        await mediaVideoBlock.execute(
            {
                images: [
                    {
                        url: 'http://localhost:8800/_local-assets/image-1.png',
                        sceneNumber: 1,
                        sourceLabel: 'source-1',
                    },
                ],
                normalizedScenes: [
                    {
                        sceneNumber: 1,
                        durationSec: 5,
                        narration: '세레브라스가 SEC에 S-1을 냈습니다.',
                        sourceRefs: ['source-1'],
                    },
                ],
                audio: {
                    url: 'http://localhost:8800/_local-assets/audio.mp3',
                    durationSec: 5,
                },
                metadata: {
                    title: '엔비디아에 도전장',
                    sources: [
                        {
                            id: 'source-1',
                            source: '인공지능신문',
                            publishedAt: '2026-04-22T17:52:25+09:00',
                        },
                    ],
                },
            },
            { backgroundMusic: false },
            {
                runId: 'run_1',
                nodeId: 'node_1',
            }
        );

        const request = vi.mocked(ffmpegAdapter.compose).mock.calls[0]?.[0];
        expect(request?.images[0]).toMatchObject({
            sourceLabel: '기준: 인공지능신문 2026-04-22',
        });
    });
});

function longformVideoInput(overrides: Record<string, unknown> = {}) {
    return {
        gate: 'B',
        mode: 'longform-gate-b',
        rendererRoute: 'hyperframes',
        gateBApproved: false,
        images: [
            {
                url: 'http://localhost:8800/_local-assets/longform-image-1.png',
                sceneNumber: 1,
                caption: '롱폼 첫 장면',
            },
        ],
        normalizedScenes: [
            {
                sceneNumber: 1,
                durationSec: 5,
                narration: '롱폼 승인 뒤 실제 제작되는 첫 장면입니다.',
            },
        ],
        subtitleCues: [
            {
                sceneNumber: 1,
                text: '롱폼 승인 뒤 실제 제작되는 첫 장면입니다.',
                startSec: 0,
                endSec: 5,
            },
        ],
        audio: {
            url: 'http://localhost:8800/_local-assets/longform-audio.mp3',
            durationSec: 5,
        },
        approvedGateAArtifact: {
            gate: 'A',
            mode: 'longform-gate-a',
            reviewStatus: 'approved',
            fullScriptDraft: '승인된 롱폼 대본입니다.',
            scenePlan: [{ sceneNumber: 1, title: '첫 장면', durationSec: 5 }],
            rendererRoute: 'hyperframes',
            mediaExecutionAllowed: true,
        },
        metadata: {
            title: '롱폼 테스트',
            contentProfileId: 'longform.explainer.v1',
        },
        ...overrides,
    };
}
