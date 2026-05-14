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
});
