import { readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { describe, expect, it } from 'vitest';

const repoDir = dirname(fileURLToPath(import.meta.url));

describe('repository environment boundary', () => {
    it('requires every memDb-backed repository to declare the real DynamoDB branch', () => {
        const files = readdirSync(repoDir)
            .filter(file => file.endsWith('-repository.ts'))
            .map(file => join(repoDir, file));

        const offenders = files
            .map(file => ({ file, source: readFileSync(file, 'utf8') }))
            .filter(({ source }) => source.includes('memDb.'))
            .filter(({ source }) => !source.includes('USE_REAL_DYNAMO'))
            .map(({ file }) => file.replace(`${repoDir}/`, ''));

        expect(offenders).toEqual([]);
    });
});
