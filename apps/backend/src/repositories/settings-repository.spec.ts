import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalCwd = process.cwd();
let tempCwd = '';

beforeEach(() => {
    tempCwd = mkdtempSync(join(tmpdir(), 'flows-settings-'));
    process.chdir(tempCwd);
});

afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempCwd, { recursive: true, force: true });
    vi.doUnmock('../config/env');
    vi.unstubAllEnvs();
    vi.resetModules();
});

describe('settingsRepo real-Dynamo sync boundary', () => {
    it('does not fall back to .local-db for sync reads in AWS/dev', async () => {
        vi.stubEnv('ALLOW_INSECURE_SETTINGS', 'true');
        vi.doMock('../config/env', () => ({
            env: {
                awsRegion: 'ap-northeast-2',
                assetsTable: 'assets-dev',
                connectionsTable: 'connections-dev',
                dynamodbEndpoint: '',
                flowsTable: 'flows-dev',
                messagesTable: 'messages-dev',
                proposalsTable: 'proposals-dev',
                runNodesTable: 'run-nodes-dev',
                runsTable: 'runs-dev',
                settingsTable: 'settings-dev',
                stage: 'dev',
                tracesTable: 'traces-dev',
            },
            isAwsExecutionEnvironment: true,
            isLocalStage: false,
        }));

        const { settingsRepo } = await import('./settings-repository');

        expect(settingsRepo.isSyncReadAvailable).toBe(false);
        expect(() => settingsRepo.getKey('openai')).toThrow(/getKey\(\) is local-only/);
        expect(() => settingsRepo.getDecryptedKey('openai')).toThrow(/getDecryptedKey\(\) is local-only/);
        expect(existsSync(join(tempCwd, '.local-db'))).toBe(false);
    });
});
