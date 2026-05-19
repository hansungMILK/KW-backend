import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalCwd = process.cwd();
let tempCwd = '';

beforeEach(() => {
    tempCwd = mkdtempSync(join(tmpdir(), 'flows-dynamodb-'));
    process.chdir(tempCwd);
});

afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempCwd, { recursive: true, force: true });
    vi.doUnmock('../../config/env');
    vi.unstubAllEnvs();
    vi.resetModules();
});

describe('dynamodb local file store boundary', () => {
    it('allows the local file store only for local/offline runtime', async () => {
        vi.doMock('../../config/env', () => ({
            env: {
                awsRegion: 'ap-northeast-2',
                dynamodbEndpoint: '',
                stage: 'local',
            },
            isAwsExecutionEnvironment: false,
            isLocalStage: true,
        }));

        const { USE_LOCAL_FILE_DB, USE_REAL_DYNAMO, memDb } = await import('./dynamodb');

        expect(USE_REAL_DYNAMO).toBe(false);
        expect(USE_LOCAL_FILE_DB).toBe(true);

        memDb.put('test-table', 'key-1', { value: 'ok' });

        expect(memDb.get('test-table', 'key-1')).toEqual({ value: 'ok' });
        expect(existsSync(join(tempCwd, '.local-db', 'test-table.json'))).toBe(true);
    });

    it('does not create .local-db in AWS Lambda even if a caller accidentally touches memDb', async () => {
        vi.doMock('../../config/env', () => ({
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

        const { USE_LOCAL_FILE_DB, USE_REAL_DYNAMO, memDb } = await import('./dynamodb');

        expect(USE_REAL_DYNAMO).toBe(true);
        expect(USE_LOCAL_FILE_DB).toBe(false);
        expect(() => memDb.get('test-table', 'key-1')).toThrow(/disabled in AWS Lambda/);
        expect(existsSync(join(tempCwd, '.local-db'))).toBe(false);
    });

    it('fails fast in dev when real DynamoDB table env vars are missing', async () => {
        vi.doMock('../../config/env', () => ({
            env: {
                awsRegion: 'ap-northeast-2',
                assetsTable: 'eureka-flows-backend-assets-local',
                connectionsTable: 'eureka-flows-backend-connections-local',
                dynamodbEndpoint: '',
                flowsTable: 'eureka-flows-backend-flows-local',
                messagesTable: 'eureka-flows-backend-messages-local',
                proposalsTable: 'eureka-flows-backend-proposals-local',
                runNodesTable: 'eureka-flows-backend-run-nodes-local',
                runsTable: 'eureka-flows-backend-runs-local',
                settingsTable: 'eureka-flows-backend-settings-local',
                stage: 'dev',
                tracesTable: 'eureka-flows-backend-traces-local',
            },
            isAwsExecutionEnvironment: true,
            isLocalStage: false,
        }));

        await expect(import('./dynamodb')).rejects.toThrow(/required table env vars are missing/);
        expect(existsSync(join(tempCwd, '.local-db'))).toBe(false);
    });
});
