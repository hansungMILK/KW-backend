import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mediaVideoBlock } from './media-video-block';
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
});
