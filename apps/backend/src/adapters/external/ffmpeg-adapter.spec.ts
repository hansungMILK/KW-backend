import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { describe, expect, it } from 'vitest';

import { isSupportedFontFile } from './ffmpeg-adapter';

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
