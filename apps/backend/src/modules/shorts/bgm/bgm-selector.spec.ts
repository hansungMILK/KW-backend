import { describe, expect, it } from 'vitest';

import { selectBgmForShorts } from './bgm-selector';

describe('selectBgmForShorts', () => {
    it('uses the cinematic Suno template catalog slot with the safe fallback loop when Suno files are not installed yet', () => {
        const selection = selectBgmForShorts({ requestText: '한국 역사 충격 사건 쇼츠 만들어줘' });

        expect(selection?.track.id).toBe('cinematic-tension-suno-01');
        expect(selection?.track.filename).toBe('cinematic-tension-loop.mp3');
        expect(selection?.track.title).toContain('Fallback Loop');
        expect(selection?.track.license).toContain('Project-owned generated asset');
    });
});
