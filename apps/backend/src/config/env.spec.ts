import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
});

describe('env runtime boundary', () => {
    it('treats serverless-offline as local even when Lambda markers are present', async () => {
        vi.stubEnv('STAGE', 'local');
        vi.stubEnv('IS_OFFLINE', 'true');
        vi.stubEnv('AWS_EXECUTION_ENV', 'AWS_Lambda_nodejs20.x');

        const { isAwsExecutionEnvironment, isLocalStage } = await import('./env');

        expect(isAwsExecutionEnvironment).toBe(false);
        expect(isLocalStage).toBe(true);
    });

    it('keeps real AWS Lambda stages out of the local runtime path', async () => {
        vi.stubEnv('STAGE', 'dev');
        vi.stubEnv('AWS_EXECUTION_ENV', 'AWS_Lambda_nodejs20.x');

        const { isAwsExecutionEnvironment, isLocalStage } = await import('./env');

        expect(isAwsExecutionEnvironment).toBe(true);
        expect(isLocalStage).toBe(false);
    });
});
