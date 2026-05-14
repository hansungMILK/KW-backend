import { createHash } from 'crypto';
import { readFileSync } from 'fs';

import { describe, expect, it } from 'vitest';

import { SHORTS_BGM_CATALOG } from './bgm-catalog';
import { selectBgmForShorts } from './bgm-selector';

const CANONICAL_DEFAULT_BGM_SHA256 = '37f55c71ef0aea6312efb8c735ecbf028b06219b42cc265bddc482d7b4adc2e9';

describe('selectBgmForShorts', () => {
    it('keeps only the default Shorts BGM in the catalog', () => {
        expect(SHORTS_BGM_CATALOG).toHaveLength(1);
        expect(SHORTS_BGM_CATALOG[0]).toMatchObject({
            id: 'default-bgm',
            title: 'Glass Horizon',
            artist: 'loudsquaredance310',
            filename: 'default-bgm.mp3',
            mood: 'default',
        });
    });

    it('uses the default BGM for ordinary topics', () => {
        const selection = selectBgmForShorts({ requestText: '식물원김밥이 왜 유행인지 알려줘' });

        expect(selection?.track.id).toBe('default-bgm');
        expect(selection?.track.filename).toBe('default-bgm.mp3');
        expect(selection?.reason).toBe('default BGM');
    });

    it('uses the same default BGM for news and horror topics', () => {
        const selection = selectBgmForShorts({ requestText: '한국 역사 충격 사건 쇼츠 만들어줘' });
        const horrorSelection = selectBgmForShorts({ requestText: '무서운 괴담 쇼츠 만들어줘' });

        expect(selection?.track.id).toBe('default-bgm');
        expect(horrorSelection?.track.id).toBe('default-bgm');
    });

    it('uses the canonical user-supplied default BGM file, not a renamed placeholder', () => {
        const selection = selectBgmForShorts({ requestText: '롱폼 배경음악 검증' });
        expect(selection?.track.filePath).toBeTruthy();
        if (!selection?.track.filePath) throw new Error('Expected default BGM file path');

        const hash = createHash('sha256').update(readFileSync(selection.track.filePath)).digest('hex');

        expect(hash).toBe(CANONICAL_DEFAULT_BGM_SHA256);
    });
});
