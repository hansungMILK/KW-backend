import { EventEmitter } from 'events';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { isSupportedFontFile, resolveFfmpegPath, resolveFfprobePath, splitOverlayLines } from './ffmpeg-adapter';

afterEach(() => {
    vi.doUnmock('child_process');
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
        expect(spawn.mock.calls[0]?.[2]).toEqual({ stdio: ['ignore', 'ignore', 'pipe'] });
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
