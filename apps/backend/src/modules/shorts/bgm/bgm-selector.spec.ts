import { describe, expect, it } from 'vitest';

import { SHORTS_BGM_CATALOG } from './bgm-catalog';
import { selectBgmForShorts } from './bgm-selector';

describe('selectBgmForShorts', () => {
    it('keeps only the default Shorts BGM in the catalog', () => {
        expect(SHORTS_BGM_CATALOG).toHaveLength(1);
        expect(SHORTS_BGM_CATALOG[0]).toMatchObject({
            id: 'default-comic-mi-steak-loop',
            filename: 'default-comic-mi-steak-loop.mp3',
            mood: 'default-comic',
        });
    });

    it('uses the default BGM for ordinary topics', () => {
        const selection = selectBgmForShorts({ requestText: '식물원김밥이 왜 유행인지 알려줘' });

        expect(selection?.track.id).toBe('default-comic-mi-steak-loop');
        expect(selection?.track.filename).toBe('default-comic-mi-steak-loop.mp3');
        expect(selection?.reason).toBe('default Shorts BGM');
    });

    it('uses the same default BGM for news and horror topics', () => {
        const selection = selectBgmForShorts({ requestText: '한국 역사 충격 사건 쇼츠 만들어줘' });
        const horrorSelection = selectBgmForShorts({ requestText: '무서운 괴담 쇼츠 만들어줘' });

        expect(selection?.track.id).toBe('default-comic-mi-steak-loop');
        expect(horrorSelection?.track.id).toBe('default-comic-mi-steak-loop');
    });
});
