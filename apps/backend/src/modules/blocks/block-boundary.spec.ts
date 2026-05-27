import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../../..');

describe('shorts block boundaries', () => {
    it('keeps generic shorts blocks free of countryball-only contracts', () => {
        const genericBlockFiles = [
            'apps/backend/src/modules/blocks/content-block.ts',
            'apps/backend/src/modules/blocks/data-block.ts',
            'apps/backend/src/modules/blocks/analysis-block.ts',
            'apps/backend/src/modules/blocks/media-image-block.ts',
            'apps/backend/src/modules/blocks/media-tts-block.ts',
            'apps/backend/src/modules/blocks/media-video-block.ts',
        ];

        for (const file of genericBlockFiles) {
            const source = readFileSync(resolve(repoRoot, file), 'utf8');

            expect(source, file).not.toMatch(/countryball|컨트리볼|captionOverlay|voiceRole/i);
        }
    });
});
