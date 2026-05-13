import { spawnSync } from 'child_process';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { describe, expect, it } from 'vitest';

const runSmoke = process.env.RUN_LONGFORM_B_REAL_SMOKE === '1';
const smokeIt = runSmoke ? it : it.skip;

describe('mediaVideoBlock longform real MP4 smoke', () => {
    smokeIt(
        'renders approved longform production to a real 2K MP4 with preview and download URLs',
        async () => {
            const ffmpegPath = resolveBinary('ffmpeg');
            const ffprobePath = resolveBinary('ffprobe');
            process.env.FFMPEG_PATH = ffmpegPath;
            process.env.FFPROBE_PATH = ffprobePath;
            process.env.MAX_LONGFORM_HTML_RENDER_ESTIMATED_COST_USD = '5';

            const { getLocalAssetPath, getPublicUrl, putObject } = await import('../../adapters/aws/s3');
            const { mediaVideoBlock } = await import('./media-video-block');

            const workDir = await mkdtemp(join(tmpdir(), 'eureka-longform-b-smoke-'));
            try {
                const audioPath = join(workDir, 'audio.mp3');

                runOrThrow(ffmpegPath, [
                    '-y',
                    '-f',
                    'lavfi',
                    '-i',
                    'sine=frequency=440:duration=2',
                    '-q:a',
                    '6',
                    audioPath,
                ]);

                await putObject('smoke/longform-b/audio.mp3', await readFile(audioPath), 'audio/mpeg');

                const input = {
                    mode: 'longform-gate-b',
                    rendererRoute: 'hyperframes',
                    gateBApproved: true,
                    images: [],
                    scenes: [
                        {
                            sceneId: 'scene-1',
                            sceneNumber: 1,
                            headline: '첫 장면',
                            layout: 'source-proof',
                        },
                        {
                            sceneId: 'scene-2',
                            sceneNumber: 2,
                            headline: '두 번째 장면',
                            layout: 'timeline',
                        },
                    ],
                    normalizedScenes: [
                        {
                            sceneNumber: 1,
                            durationSec: 1,
                            narration: '첫 장면 자막입니다.',
                        },
                        {
                            sceneNumber: 2,
                            durationSec: 1,
                            narration: '두 번째 장면 자막입니다.',
                        },
                    ],
                    subtitleCues: [
                        { sceneNumber: 1, text: '첫 장면 자막입니다.', startSec: 0, endSec: 1 },
                        { sceneNumber: 2, text: '두 번째 장면 자막입니다.', startSec: 1, endSec: 2 },
                    ],
                    audio: {
                        url: getPublicUrl('smoke/longform-b/audio.mp3'),
                        durationSec: 2,
                        provider: 'elevenlabs',
                        voiceId: 'pNInz6obpgDQGcFmaJgB',
                    },
                    motionCues: [
                        { sceneNumber: 1, type: 'slow-zoom-in' },
                        { sceneNumber: 2, type: 'slow-zoom-in' },
                    ],
                    approvedGateAArtifact: {
                        gate: 'A',
                        mode: 'longform-gate-a',
                        reviewStatus: 'approved',
                        fullScriptDraft: '승인된 롱폼 대본입니다.',
                        scenePlan: [
                            { sceneNumber: 1, title: '첫 장면', durationSec: 1 },
                            { sceneNumber: 2, title: '두 번째 장면', durationSec: 1 },
                        ],
                        rendererRoute: 'hyperframes',
                        mediaExecutionAllowed: true,
                    },
                    metadata: {
                        title: '롱폼 제작 스모크',
                        contentProfileId: 'longform.explainer.v1',
                    },
                };

                const result = await mediaVideoBlock.execute(
                    input,
                    {
                        mode: 'longform-gate-b',
                        rendererRoute: 'hyperframes',
                        htmlComposeEstimatedCostUsd: 0.25,
                        hyperframesRenderEstimatedCostUsd: 0.25,
                    },
                    {
                        runId: 'run-longform-b-real-smoke',
                        nodeId: 'node-media-video-real-smoke',
                    }
                );

                const output = result.output as Record<string, unknown>;
                const video = output['video'] as Record<string, unknown>;
                const qa = output['qa'] as Record<string, unknown>;
                const backgroundMusic = output['backgroundMusic'] as Record<string, unknown>;
                const asset = result.assets?.[0];
                const s3Key = asset?.metadata?.['s3Key'];

                expect(video['previewUrl']).toEqual(video['downloadUrl']);
                expect(video['width']).toBe(2560);
                expect(video['height']).toBe(1440);
                expect(qa).toMatchObject({
                    hasVideo: true,
                    hasAudio: true,
                    width: 2560,
                    height: 1440,
                });
                expect(backgroundMusic).toMatchObject({
                    id: 'default-bgm',
                    title: 'Glass Horizon',
                    artist: 'loudsquaredance310',
                });
                expect(output['longformProductionQa']).toMatchObject({
                    ttsProvider: 'elevenlabs',
                    voiceId: 'pNInz6obpgDQGcFmaJgB',
                    subtitleCueCount: 2,
                    motionCueCount: 2,
                });
                expect(typeof s3Key).toBe('string');
                expect(await readFile(getLocalAssetPath(s3Key as string))).toHaveLength(Number(video['sizeBytes']));
            } finally {
                await rm(workDir, { recursive: true, force: true });
            }
        },
        60000
    );
});

function resolveBinary(name: 'ffmpeg' | 'ffprobe'): string {
    const existing = process.env[name === 'ffmpeg' ? 'FFMPEG_PATH' : 'FFPROBE_PATH'];
    if (existing) return existing;

    const result = spawnSync('which', [name], { encoding: 'utf8' });
    if (result.status !== 0 || !result.stdout.trim()) {
        throw new Error(`${name} binary is required for RUN_LONGFORM_B_REAL_SMOKE=1`);
    }
    return result.stdout.trim();
}

function runOrThrow(binary: string, args: string[]): void {
    const result = spawnSync(binary, args, { encoding: 'utf8' });
    if (result.status !== 0) {
        throw new Error(`${binary} failed: ${result.stderr || result.stdout}`);
    }
}
