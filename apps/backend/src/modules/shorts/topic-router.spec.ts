import { describe, expect, it } from 'vitest';

import { selectShortsRulepack } from './topic-router';

describe('selectShortsRulepack', () => {
    it('keeps the generic shorts router on generic rulepacks only', () => {
        expect(selectShortsRulepack({ contentProfileId: 'shorts.countryball.v1' }).id).toBe('general-shorts');
        expect(selectShortsRulepack({ topic: '국가볼로 미중갈등 상황극 쇼츠 만들어줘' }).id).toBe('general-shorts');
        expect(selectShortsRulepack({ topic: '미중갈등 쇼츠 만들어줘' }).id).toBe('general-shorts');
    });
});
