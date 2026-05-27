import { EventEmitter } from 'events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    decodeDataUrlBinary,
    isSupportedFontFile,
    prepareFfmpegFontconfigEnv,
    resolveFfmpegPath,
    resolveFfprobePath,
    splitOverlayLines,
} from './ffmpeg-adapter';

import type * as Fs from 'fs';

afterEach(() => {
    vi.doUnmock('child_process');
    vi.doUnmock('fs');
    vi.doUnmock('../../config/env');
    delete process.env.ALLOW_SHORTS_OVERLAY_OFF;
    delete process.env.SHORTS_FFMPEG_OVERLAY;
    vi.resetModules();
    vi.restoreAllMocks();
});

describe('ffmpeg font validation', () => {
    it('rejects XML font dumps even when the filename looks like a TTF', () => {
        const dir = mkdtempSync(join(tmpdir(), 'font-validation-'));
        const fakeTtf = join(dir, 'PretendardVariable.ttf');

        try {
            writeFileSync(fakeTtf, '<?xml version="1.0"?><ttFont></ttFont>');

            expect(isSupportedFontFile(fakeTtf)).toBe(false);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('accepts the checked-in Pretendard Black OpenType font', () => {
        expect(isSupportedFontFile('assets/fonts/Pretendard-Black.otf')).toBe(true);
    });
});

describe('ffmpeg binary input loading', () => {
    it('decodes data URLs directly instead of relying on runtime fetch behavior', () => {
        expect(decodeDataUrlBinary('data:text/plain;base64,SGVsbG8=')?.toString('utf8')).toBe('Hello');
        expect(decodeDataUrlBinary('data:text/plain,Hello%20World')?.toString('utf8')).toBe('Hello World');
        expect(decodeDataUrlBinary('https://example.com/image.png')).toBeUndefined();
    });
});

describe('ffmpeg Lambda fontconfig environment', () => {
    it('creates a writable fontconfig config and cache under the composition work dir', () => {
        const dir = mkdtempSync(join(tmpdir(), 'ffmpeg-fontconfig-'));

        try {
            const env = prepareFfmpegFontconfigEnv({ STAGE: 'dev' }, dir);

            expect(env.HOME).toBe('/tmp');
            expect(env.XDG_CACHE_HOME).toBe(join(dir, 'fontconfig-cache'));
            expect(env.FONTCONFIG_PATH).toBe(join(dir, 'fontconfig'));
            expect(env.FONTCONFIG_FILE).toBe(join(dir, 'fontconfig', 'fonts.conf'));
            expect(existsSync(env.FONTCONFIG_FILE)).toBe(true);
            expect(readFileSync(env.FONTCONFIG_FILE, 'utf8')).toContain('/var/task/assets/fonts');
            expect(readFileSync(env.FONTCONFIG_FILE, 'utf8')).toContain('<cachedir>');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('ffmpeg process wrapper', () => {
    it('settles when ffmpeg emits exit even if close is delayed', async () => {
        vi.resetModules();

        const child = new EventEmitter() as EventEmitter & {
            stderr: EventEmitter;
            kill: ReturnType<typeof vi.fn>;
        };
        child.stderr = new EventEmitter();
        child.kill = vi.fn();

        const spawn = vi.fn(() => child);
        vi.doMock('child_process', () => ({
            spawn,
            spawnSync: vi.fn(() => ({ status: 0, stdout: 'drawtext', stderr: '' })),
        }));

        const { runFfmpeg } = await import('./ffmpeg-adapter');
        const execution = runFfmpeg(['-version']);

        child.emit('exit', 0, null);

        await expect(execution).resolves.toBeUndefined();
        expect(spawn.mock.calls[0]?.[2]).toEqual({
            stdio: ['ignore', 'ignore', 'pipe'],
            env: process.env,
        });
    });
});

describe('ffmpeg composition duration boundary', () => {
    it('sets an explicit output duration so looped image inputs cannot run forever without audio', async () => {
        vi.resetModules();

        const child = new EventEmitter() as EventEmitter & {
            stderr: EventEmitter;
            kill: ReturnType<typeof vi.fn>;
        };
        child.stderr = new EventEmitter();
        child.kill = vi.fn();

        const spawn = vi.fn(() => child);
        vi.doMock('child_process', () => ({
            spawn,
            spawnSync: vi.fn(() => ({ status: 0, stdout: 'subtitles', stderr: '' })),
        }));

        const { ffmpegAdapter } = await import('./ffmpeg-adapter');
        const composition = ffmpegAdapter.compose({
            images: [
                {
                    url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
                    durationSec: 0.5,
                    title: 'FFmpeg',
                    caption: 'overlay smoke',
                },
            ],
            outputWidth: 1080,
            outputHeight: 1920,
            outputFormat: 'mp4',
        });

        await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
        child.emit('exit', 0, null);

        await expect(composition).rejects.toThrow();
        const args = spawn.mock.calls[0]?.[1] as string[];
        const outputDurationFlagIndex = args.lastIndexOf('-t');
        const outputFramesFlagIndex = args.lastIndexOf('-frames:v');
        const filterGraph = args[args.indexOf('-filter_complex') + 1];

        expect(outputDurationFlagIndex).toBeGreaterThan(args.indexOf('-map'));
        expect(args[outputDurationFlagIndex + 1]).toBe('0.5');
        expect(outputFramesFlagIndex).toBeGreaterThan(args.indexOf('-map'));
        expect(args[outputFramesFlagIndex + 1]).toBe('15');
        expect(args).toContain('-nostdin');
        expect(args).not.toContain('-loop');
        expect(filterGraph).toContain('loop=loop=14:size=1:start=0,setpts=N/(30*TB)');
        expect(filterGraph).toContain('trim=duration=0.5,setpts=PTS-STARTPTS');
        expect(filterGraph).not.toContain('concat=n=1');
        expect(filterGraph).toContain('[v0]format=yuv420p[v]');
    });

    it('passes countryball caption position into drawtext coordinates', async () => {
        vi.resetModules();

        const child = new EventEmitter() as EventEmitter & {
            stderr: EventEmitter;
            kill: ReturnType<typeof vi.fn>;
        };
        child.stderr = new EventEmitter();
        child.kill = vi.fn();

        const spawn = vi.fn(() => child);
        vi.doMock('child_process', () => ({
            spawn,
            spawnSync: vi.fn(() => ({ status: 0, stdout: 'drawtext', stderr: '' })),
        }));

        const { ffmpegAdapter } = await import('./ffmpeg-adapter');
        const composition = ffmpegAdapter.compose({
            images: [
                {
                    url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
                    durationSec: 0.5,
                    title: '컨트리볼',
                    caption: '말하는 볼 옆 자막',
                    captionPosition: 'middle-right',
                    captionStyle: 'whiteBlack',
                },
            ],
            outputWidth: 320,
            outputHeight: 568,
            outputFormat: 'mp4',
        });

        await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
        child.emit('exit', 0, null);

        await expect(composition).rejects.toThrow();
        const args = spawn.mock.calls[0]?.[1] as string[];
        const filterGraph = args[args.indexOf('-filter_complex') + 1];

        expect(filterGraph).toContain("text='말하는 볼 옆 자막'");
        expect(filterGraph).toContain('x=w-text_w-64');
        expect(filterGraph).toContain('y=960');
        expect(filterGraph).toContain('fontcolor=white');
    });
});

describe('ffmpeg font path resolution', () => {
    it('returns absolute font paths so child ffmpeg does not depend on cwd', async () => {
        vi.resetModules();
        process.env.FFMPEG_FONT_FILE = 'assets/fonts/Jalnan2.otf';

        const { resolveOverlayFontFile } = await import('./ffmpeg-adapter');

        expect(resolveOverlayFontFile()).toMatch(/^\/.+Jalnan2\.otf$/);
    });
});

describe('ffmpeg binary resolution', () => {
    it('honors explicit existing ffmpeg and ffprobe paths', () => {
        const dir = mkdtempSync(join(tmpdir(), 'ffmpeg-bin-resolution-'));
        const ffmpeg = join(dir, 'ffmpeg');
        const ffprobe = join(dir, 'ffprobe');

        try {
            writeFileSync(ffmpeg, '');
            writeFileSync(ffprobe, '');

            const env = {
                FFMPEG_PATH: ffmpeg,
                FFPROBE_PATH: ffprobe,
            };

            expect(resolveFfmpegPath(env)).toBe(ffmpeg);
            expect(resolveFfprobePath(env, ffmpeg)).toBe(ffprobe);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('derives ffprobe from an existing ffmpeg sibling path', () => {
        const dir = mkdtempSync(join(tmpdir(), 'ffprobe-sibling-resolution-'));
        const ffmpeg = join(dir, 'ffmpeg');
        const ffprobe = join(dir, 'ffprobe');

        try {
            writeFileSync(ffmpeg, '');
            writeFileSync(ffprobe, '');

            expect(resolveFfprobePath({ FFMPEG_PATH: ffmpeg }, ffmpeg)).toBe(ffprobe);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('does not trust missing absolute serverless defaults on local machines', () => {
        const missing = '/definitely-missing-eureka-flow/ffprobe';

        expect(resolveFfprobePath({ FFPROBE_PATH: missing }, '/definitely-missing-eureka-flow/ffmpeg')).not.toBe(
            missing
        );
    });
});

describe('shorts overlay text wrapping', () => {
    it('keeps the last title word when the first line is full', () => {
        expect(splitOverlayLines('모수 와인 바꿔치기, 안성재 사과', 11, 2)).toEqual([
            '모수 와인 바꿔치기,',
            '안성재 사과',
        ]);
    });
});

describe('shorts overlay strategy', () => {
    it('falls back to ASS subtitles when drawtext is unavailable but subtitles/libass is available', async () => {
        vi.resetModules();
        vi.doMock('child_process', () => ({
            spawn: vi.fn(),
            spawnSync: vi.fn(() => ({ status: 0, stdout: 'subtitles', stderr: '' })),
        }));

        const { resolveOverlayStrategy } = await import('./ffmpeg-adapter');

        expect(resolveOverlayStrategy()).toBe('ass');
    });

    it('blocks disabled overlays outside local stage unless explicitly allowed', async () => {
        vi.resetModules();
        process.env.SHORTS_FFMPEG_OVERLAY = 'off';
        vi.doMock('../../config/env', () => ({
            env: {
                awsRegion: 'ap-northeast-2',
                cdnDomain: 'cdn.example.com',
                s3Bucket: 'eureka-flows-backend-assets-dev',
                stage: 'dev',
            },
            isLocalStage: false,
        }));

        const { resolveOverlayStrategy } = await import('./ffmpeg-adapter');

        expect(() => resolveOverlayStrategy()).toThrow(/VIDEO_OVERLAY_DISABLED_IN_STAGE/);
    });

    it('fails clearly when no overlay renderer is available', async () => {
        vi.resetModules();
        vi.doMock('child_process', () => ({
            spawn: vi.fn(),
            spawnSync: vi.fn(() => ({ status: 0, stdout: 'scale\ncrop', stderr: '' })),
        }));
        vi.doMock('fs', async importOriginal => {
            const actual = await importOriginal<typeof Fs>();
            return {
                ...actual,
                existsSync: (path: string) => (path === '/usr/bin/sips' ? false : actual.existsSync(path)),
            };
        });

        const { resolveOverlayStrategy } = await import('./ffmpeg-adapter');

        expect(() => resolveOverlayStrategy()).toThrow(/VIDEO_OVERLAY_CAPABILITY_MISSING/);
    });
});

describe('ffmpeg remote-stage asset boundary', () => {
    it('rejects local asset URLs outside local/offline stage instead of reading local files', async () => {
        vi.resetModules();
        vi.doMock('../../config/env', () => ({
            env: {
                awsRegion: 'ap-northeast-2',
                cdnDomain: 'cdn.example.com',
                s3Bucket: 'eureka-flows-backend-assets-dev',
                stage: 'dev',
            },
            isLocalStage: false,
        }));

        const { ffmpegAdapter } = await import('./ffmpeg-adapter');

        await expect(
            ffmpegAdapter.compose({
                images: [{ url: 'http://localhost:8800/_local-assets/image.png', durationSec: 1 }],
                outputWidth: 1080,
                outputHeight: 1920,
                outputFormat: 'mp4',
            })
        ).rejects.toThrow(/local asset URLs are disabled/);
    });
});
