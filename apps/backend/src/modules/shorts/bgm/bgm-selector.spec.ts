import { describe, expect, it } from 'vitest';

import { SHORTS_BGM_CATALOG } from './bgm-catalog';
import { selectBgmForShorts } from './bgm-selector';

describe('selectBgmForShorts', () => {
    it('keeps YouTube Audio Library tracks as the first production candidates per mood', () => {
        expect(SHORTS_BGM_CATALOG.filter(track => track.id.startsWith('ytal-')).map(track => track.mood)).toEqual([
            'warm-storytelling',
            'cinematic-tension',
            'fast-explainer',
            'quirky-office',
            'futuristic-tech',
        ]);
    });

    it('uses the cinematic Suno template catalog slot with the safe fallback loop when Suno files are not installed yet', () => {
        const selection = selectBgmForShorts({ requestText: '한국 역사 충격 사건 쇼츠 만들어줘' });

        expect(selection?.track.id).toBe('cinematic-tension-suno-01');
        expect(selection?.track.filename).toBe('cinematic-tension-loop.mp3');
        expect(selection?.track.title).toContain('Fallback Loop');
        expect(selection?.track.license).toContain('Project-owned generated asset');
    });
});
