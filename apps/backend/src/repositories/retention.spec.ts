import { describe, expect, it } from 'vitest';

import { retentionTtlFrom, stripRetentionTtl, withRetentionTtl } from './retention';
import { env } from '../config/env';

const SECONDS_PER_DAY = 24 * 60 * 60;

describe('retention helpers', () => {
    it('sets DynamoDB TTL from the configured retention window', () => {
        const base = '2026-05-18T00:00:00.000Z';
        const expected = Math.floor(Date.parse(base) / 1000) + env.dataRetentionDays * SECONDS_PER_DAY;

        expect(retentionTtlFrom(base)).toBe(expected);
        expect(withRetentionTtl({ runId: 'run-1' }, base)).toEqual({ runId: 'run-1', ttl: expected });
    });

    it('removes internal TTL before returning records to API callers', () => {
        expect(stripRetentionTtl({ assetId: 'asset-1', ttl: 123 })).toEqual({ assetId: 'asset-1' });
    });
});
