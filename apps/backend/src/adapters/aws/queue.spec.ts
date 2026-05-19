import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
    vi.doUnmock('child_process');
    vi.doUnmock('../../config/env');
    vi.doUnmock('../../services/execution-engine');
    vi.resetModules();
});

describe('queue local dispatch', () => {
    it('dispatches local long-running work through a detached worker process', async () => {
        const on = vi.fn();
        const unref = vi.fn();
        const spawn = vi.fn(() => ({ on, unref }));

        vi.doMock('child_process', () => ({ spawn }));
        vi.doMock('../../config/env', () => ({
            env: {
                awsRegion: 'ap-northeast-2',
                executionQueueUrl: '',
                localQueueMode: 'worker',
                stage: 'local',
            },
            isAwsExecutionEnvironment: false,
            isLocalStage: true,
        }));
        vi.doMock('../../services/execution-engine', () => ({
            executionEngine: {
                handleNodeExecution: vi.fn(),
                handleRunExecution: vi.fn(),
            },
        }));

        const { queue } = await import('./queue');
        const message = {
            type: 'EXECUTE_RUN',
            runId: 'run-1',
            executionId: 'exec-1',
            timestamp: '2026-05-12T00:00:00.000Z',
        } as const;
        await queue.send(message);

        expect(spawn).toHaveBeenCalledOnce();
        const [command, args, options] = spawn.mock.calls[0] ?? [];
        expect(command).toBe(process.execPath);
        expect(args).toEqual(expect.arrayContaining([expect.stringContaining('local-worker-runner.mjs')]));
        expect(options).toEqual(
            expect.objectContaining({
                detached: true,
                env: expect.objectContaining({
                    LOCAL_QUEUE_MESSAGE_JSON: JSON.stringify(message),
                }),
            })
        );
        expect(unref).toHaveBeenCalledOnce();
    });

    it('keeps inline mode available for focused debugging', async () => {
        const handleRunExecution = vi.fn(async () => undefined);

        vi.doMock('../../config/env', () => ({
            env: {
                awsRegion: 'ap-northeast-2',
                executionQueueUrl: '',
                localQueueMode: 'inline',
                stage: 'local',
            },
            isAwsExecutionEnvironment: false,
            isLocalStage: true,
        }));
        vi.doMock('../../services/execution-engine', () => ({
            executionEngine: {
                handleNodeExecution: vi.fn(),
                handleRunExecution,
            },
        }));

        const { queue } = await import('./queue');
        await queue.send({
            type: 'EXECUTE_RUN',
            runId: 'run-inline',
            executionId: 'exec-inline',
            timestamp: '2026-05-12T00:00:00.000Z',
        });

        expect(handleRunExecution).toHaveBeenCalledWith('run-inline', 'exec-inline');
    });

    it('does not fall back to the local worker in AWS Lambda', async () => {
        const spawn = vi.fn();

        vi.doMock('child_process', () => ({ spawn }));
        vi.doMock('../../config/env', () => ({
            env: {
                awsRegion: 'ap-northeast-2',
                executionQueueUrl: '',
                localQueueMode: 'worker',
                stage: 'dev',
            },
            isAwsExecutionEnvironment: true,
            isLocalStage: false,
        }));
        vi.doMock('../../services/execution-engine', () => ({
            executionEngine: {
                handleNodeExecution: vi.fn(),
                handleRunExecution: vi.fn(),
            },
        }));

        const { queue } = await import('./queue');

        await expect(
            queue.send({
                type: 'EXECUTE_RUN',
                runId: 'run-prod',
                executionId: 'exec-prod',
                timestamp: '2026-05-12T00:00:00.000Z',
            })
        ).rejects.toThrow('EXECUTION_QUEUE_URL not configured');
        expect(spawn).not.toHaveBeenCalled();
    });
});
