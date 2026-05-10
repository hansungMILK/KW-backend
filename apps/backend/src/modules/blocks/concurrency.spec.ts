import { describe, expect, it } from 'vitest';

import { runWithConcurrency } from './concurrency';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('runWithConcurrency', () => {
    it('runs all items when no stop condition is set', async () => {
        const started: number[] = [];

        const results = await runWithConcurrency([1, 2, 3], 2, async item => {
            started.push(item);
            return item * 2;
        });

        expect(started).toEqual([1, 2, 3]);
        expect(results).toEqual([
            { status: 'fulfilled', value: 2 },
            { status: 'fulfilled', value: 4 },
            { status: 'fulfilled', value: 6 },
        ]);
    });

    it('does not schedule new items after the stop condition turns true', async () => {
        const started: number[] = [];
        let shouldStop = false;

        const results = await runWithConcurrency(
            [1, 2, 3, 4],
            2,
            async item => {
                started.push(item);
                if (item === 1) {
                    shouldStop = true;
                    throw new Error('first scene failed');
                }
                await delay(10);
                return item;
            },
            { shouldStop: () => shouldStop }
        );

        expect(started.every(item => item <= 2)).toBe(true);
        expect(results[0]?.status).toBe('rejected');
        if (results[1]) expect(results[1]).toEqual({ status: 'fulfilled', value: 2 });
        expect(results[2]).toBeUndefined();
        expect(results[3]).toBeUndefined();
    });
});
