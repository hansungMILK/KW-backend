import { afterEach, describe, expect, it } from 'vitest';

import {
    buildHyperframesChildEnv,
    buildLongformHyperframesHtml,
    resolveHyperframesCommand,
} from './hyperframes-adapter';

describe('hyperframes command resolution', () => {
    const originalConfiguredBin = process.env.HYPERFRAMES_CLI_BIN;

    afterEach(() => {
        if (originalConfiguredBin === undefined) {
            delete process.env.HYPERFRAMES_CLI_BIN;
        } else {
            process.env.HYPERFRAMES_CLI_BIN = originalConfiguredBin;
        }
    });

    it('runs the bundled CLI through the current Node binary instead of a .bin env shim', () => {
        delete process.env.HYPERFRAMES_CLI_BIN;

        const command = resolveHyperframesCommand();

        expect(command.bin).toBe(process.execPath);
        expect(command.prefixArgs[0]).toMatch(/node_modules\/hyperframes\/dist\/cli\.js$/);
    });

    it('honors an explicitly configured Hyperframes binary', () => {
        process.env.HYPERFRAMES_CLI_BIN = '/custom/hyperframes';

        expect(resolveHyperframesCommand()).toEqual({ bin: '/custom/hyperframes', prefixArgs: [] });
    });

    it('adds the local Node and FFmpeg directories to the render child PATH', () => {
        const env = buildHyperframesChildEnv({ PATH: '/usr/bin', FFMPEG_PATH: '/opt/homebrew/bin/ffmpeg' });

        expect(env.FFMPEG_PATH).toBe('/opt/homebrew/bin/ffmpeg');
        expect(env.PATH?.split(':')).toEqual(
            expect.arrayContaining([expect.stringMatching(/\/bin$/), '/opt/homebrew/bin', '/usr/bin', '/bin'])
        );
    });
});

describe('hyperframes motion directions', () => {
    it('turns AI motion cue types into timeline-specific animation instructions', () => {
        const html = buildLongformHyperframesHtml(
            {
                scenes: [
                    {
                        sceneId: 'scene-1',
                        sceneNumber: 1,
                        headline: 'AI 모션 장면',
                        visualText: '자료를 확대해서 보여준다',
                    },
                ],
                subtitleCues: [{ sceneNumber: 1, text: 'AI가 고른 모션을 적용합니다.', startSec: 0, endSec: 4 }],
                motionCues: [{ sceneNumber: 1, type: 'source-card-zoom' }],
                audioUrl: 'file://narration.mp3',
                audioDurationSec: 4,
                outputWidth: 2560,
                outputHeight: 1440,
            },
            {
                narrationSrc: './assets/narration.mp3',
                gsapSrc: './assets/gsap.min.js',
            }
        );

        expect(html).toContain('data-motion="source-card-zoom"');
        expect(html).toContain('scale: 1.07');
        expect(html).toContain('expo.out');
    });

    it('renders timed subtitles and meaningful visual panels instead of placeholder labels', () => {
        const html = buildLongformHyperframesHtml(
            {
                scenes: [
                    {
                        sceneId: 'scene-1',
                        sceneNumber: 1,
                        headline: '느대 탈출 사건 흐름',
                        layout: 'chapter-board',
                        visualType: 'event-timeline',
                        visualData: {
                            title: '사건 흐름',
                            items: ['대전 오월드에서 탈출', '수색 장기화', '가짜 정보가 더 빨리 확산'],
                        },
                    },
                ],
                subtitleCues: [
                    {
                        sceneNumber: 1,
                        text: '대전 오월드에서 늑대 한 마리가 탈출했습니다.',
                        startSec: 0,
                        endSec: 3.5,
                    },
                ],
                motionCues: [{ sceneNumber: 1, type: 'reveal' }],
                audioUrl: 'file://narration.mp3',
                audioDurationSec: 3.5,
                outputWidth: 2560,
                outputHeight: 1440,
            },
            {
                narrationSrc: './assets/narration.mp3',
                gsapSrc: './assets/gsap.min.js',
            }
        );

        expect(html).toContain('class="subtitle-layer"');
        expect(html).toContain('대전 오월드에서 늑대 한 마리가 탈출했습니다.');
        expect(html).toContain('visual-event-timeline');
        expect(html).toContain('대전 오월드에서 탈출');
        expect(html).not.toContain('chapter-board');
    });

    it('does not duplicate full narration as body copy when timed subtitles are present', () => {
        const narration = '야, 이 소식 진짜 반갑다. 무한도전 팬이면 바로 감 오지 않나?';
        const html = buildLongformHyperframesHtml(
            {
                scenes: [
                    {
                        sceneId: 'scene-1',
                        sceneNumber: 1,
                        headline: '왜 지금 다시 무한도전인가',
                        narration,
                        caption: narration,
                        visualType: 'event-timeline',
                        visualData: {
                            title: '무한도전 감성이 다시 켜진 순간',
                            items: ['유재석 진행 프로그램', '박명수 출연', '정준하 출연', '팬 반응 재점화'],
                        },
                    },
                ],
                subtitleCues: [{ sceneNumber: 1, text: narration, startSec: 0, endSec: 4 }],
                motionCues: [{ sceneNumber: 1, type: 'reveal' }],
                audioUrl: 'file://narration.mp3',
                audioDurationSec: 4,
                outputWidth: 2560,
                outputHeight: 1440,
            },
            {
                narrationSrc: './assets/narration.mp3',
                gsapSrc: './assets/gsap.min.js',
            }
        );

        expect(html).not.toContain('class="caption"');
        expect(html.split(narration).length - 1).toBe(1);
        expect(html).toContain('팬 반응 재점화');
    });
});
