import { describe, expect, it } from 'vitest';

import { BLOCK_CATALOG, findBlockByType, toSpecBlockDetail } from './_catalog';

describe('HTTP block catalog', () => {
    it('publishes the longform production nodes with backend execution metadata', () => {
        const expectedTypes = [
            'longform-source',
            'longform-brief',
            'longform-script',
            'longform-storyboard',
            'longform-scene-json',
            'longform-review',
            'longform-tts',
            'longform-srt-align',
            'longform-motion-compose',
            'longform-render',
            'longform-qa',
            'longform-package',
        ];

        const catalogTypes = BLOCK_CATALOG.map(block => block.$definition.type);

        expect(catalogTypes).toEqual(expect.arrayContaining(expectedTypes));

        for (const blockType of expectedTypes) {
            const block = findBlockByType(blockType);
            expect(block).toBeDefined();
            if (!block) throw new Error(`Missing block ${blockType}`);
            expect(block?.isFrontend).toBe(0);
            expect(block?.isRunnable).toBe(true);

            const detail = toSpecBlockDetail(block);
            expect(detail.category).toMatch(/process|output/);
            expect(detail.inputSchema.length).toBeGreaterThan(0);
            expect(detail.outputSchema.length).toBeGreaterThan(0);
        }
    });
});
