import { describe, expect, it } from 'vitest';

import { selectShortsRulepack } from './topic-router';

describe('selectShortsRulepack', () => {
    it('selects countryball reenactment only for explicit countryball profile or wording', () => {
        expect(selectShortsRulepack({ contentProfileId: 'shorts.countryball.v1' }).id).toBe('countryball-shorts');
        expect(selectShortsRulepack({ topic: '국가볼로 미중갈등 상황극 쇼츠 만들어줘' }).id).toBe('countryball-shorts');
        expect(selectShortsRulepack({ topic: '미중갈등 쇼츠 만들어줘' }).id).toBe('general-shorts');
    });
});
