import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalCwd = process.cwd();
let tempCwd = '';

beforeEach(() => {
    tempCwd = mkdtempSync(join(tmpdir(), 'flows-s3-'));
    process.chdir(tempCwd);
});

afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempCwd, { recursive: true, force: true });
    vi.doUnmock('../../config/env');
    vi.unstubAllEnvs();
    vi.resetModules();
});

describe('s3 local asset boundary', () => {
    it('allows local asset storage only for local/offline runtime', async () => {
        vi.doMock('../../config/env', () => ({
            env: {
                awsRegion: 'ap-northeast-2',
                cdnDomain: '',
                s3Bucket: 'eureka-flows-local',
                stage: 'local',
            },
            isLocalStage: true,
        }));

        const { getPublicUrl, putObject } = await import('./s3');

        await putObject('images/test.txt', 'ok', 'text/plain');

        expect(getPublicUrl('images/test.txt')).toBe('http://localhost:8800/_local-assets/images/test.txt');
        expect(existsSync(join(tempCwd, '.local-assets', 'images', 'test.txt'))).toBe(true);
    });

    it('fails fast in AWS/dev when S3_BUCKET is missing instead of writing local assets', async () => {
        vi.doMock('../../config/env', () => ({
            env: {
                awsRegion: 'ap-northeast-2',
                cdnDomain: '',
                s3Bucket: 'eureka-flows-local',
                stage: 'dev',
            },
            isLocalStage: false,
        }));

        const { getPublicUrl, putObject } = await import('./s3');

        expect(() => getPublicUrl('images/test.txt')).toThrow(/S3_BUCKET is required/);
        await expect(putObject('images/test.txt', 'ok', 'text/plain')).rejects.toThrow(/S3_BUCKET is required/);
        expect(existsSync(join(tempCwd, '.local-assets'))).toBe(false);
    });
});
