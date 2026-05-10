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
            'horror-dark',
        ]);
    });

    it('uses the comic Shorts template as the default track for ordinary topics', () => {
        const selection = selectBgmForShorts({ requestText: '식물원김밥이 왜 유행인지 알려줘' });

        expect(selection?.track.id).toBe('default-comic-mi-steak-loop');
        expect(selection?.track.filename).toBe('default-comic-mi-steak-loop.mp3');
    });

    it('does not use Dark Toys for ordinary history or news documentary topics', () => {
        const selection = selectBgmForShorts({ requestText: '한국 역사 충격 사건 쇼츠 만들어줘' });

        expect(selection?.track.id).toBe('cinematic-tension-suno-01');
        expect(selection?.track.filename).toBe('cinematic-tension-loop.mp3');
        expect(selection?.track.title).toContain('Fallback Loop');
        expect(selection?.track.license).toContain('Project-owned generated asset');
    });

    it('uses Dark Toys only for scary horror topics', () => {
        const selection = selectBgmForShorts({ requestText: '무서운 괴담 쇼츠 만들어줘' });

        expect(selection?.track.id).toBe('ytal-horror-dark-01');
        expect(selection?.track.filename).toBe('ytal-horror-dark-dark-toys.mp3');
    });
});
