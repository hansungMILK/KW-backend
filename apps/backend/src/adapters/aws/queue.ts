import { spawn } from 'child_process';
import { closeSync, existsSync, mkdirSync, openSync } from 'fs';
import { join } from 'path';

import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

import { env, isAwsExecutionEnvironment, isLocalStage } from '../../config/env';
import { executionEngine } from '../../services/execution-engine';

import type { QueueMessage } from '@flows/contracts';

/**
 * Queue abstraction — decouples run-service from execution engine.
 *
 * Local mode  (STAGE=local, no SQS):
 *   send() starts the same runWorker handler in a detached local process by
 *   default, so HTTP requests return QUEUED quickly while long-running image /
 *   video work is owned by worker timeout/cancel logic instead of the request
 *   Lambda lifecycle.
 *
 * Prod mode  (STAGE != local):
 *   send() publishes to SQS; processLocally() is used by the SQS Lambda worker.
 */

const IS_LOCAL = isLocalStage && !isAwsExecutionEnvironment;
const LOCAL_WORKER_LOG_FILE = '.local-db/local-run-worker.log';
const LOCAL_WORKER_RUNNER = 'scripts/local-worker-runner.mjs';

let _sqsClient: SQSClient | null = null;
const getSqsClient = (): SQSClient => {
    if (!_sqsClient) _sqsClient = new SQSClient({ region: env.awsRegion });
    return _sqsClient;
};

function resolveBackendCwd(): string {
    const cwd = process.cwd();
    if (existsSync(join(cwd, 'serverless.yml'))) return cwd;

    const appCwd = join(cwd, 'apps', 'backend');
    if (existsSync(join(appCwd, 'serverless.yml'))) return appCwd;

    return cwd;
}

function dispatchLocalWorker(message: QueueMessage): void {
    if (isAwsExecutionEnvironment) {
        throw new Error(
            '[queue] local worker dispatch is disabled in AWS Lambda. ' +
                'Configure EXECUTION_QUEUE_URL/SQS for this stage.'
        );
    }

    const backendCwd = resolveBackendCwd();
    const runnerPath = join(backendCwd, LOCAL_WORKER_RUNNER);
    if (!existsSync(runnerPath)) {
        throw new Error(`local worker runner not found: ${runnerPath}`);
    }

    const logPath = join(backendCwd, LOCAL_WORKER_LOG_FILE);
    mkdirSync(join(backendCwd, '.local-db'), { recursive: true });

    const logFd = openSync(logPath, 'a');
    try {
        const child = spawn(process.execPath, [runnerPath], {
            cwd: backendCwd,
            detached: true,
            env: {
                ...process.env,
                LOCAL_QUEUE_MESSAGE_JSON: JSON.stringify(message),
            },
            stdio: ['ignore', logFd, logFd],
        });
        child.on('error', err => {
            console.error('[queue] local worker process failed to start', err);
        });
        child.unref();
    } finally {
        closeSync(logFd);
    }
}

export const queue = {
    /**
     * Send a queue message.
     * In local mode: schedule local processing, or process inline when
     * LOCAL_QUEUE_MODE=inline is explicitly set. LOCAL_QUEUE_MODE=async keeps
     * the legacy in-process behavior for narrow debugging only.
     * In prod mode: publish to SQS and let the worker Lambda process it.
     */
    async send(message: QueueMessage): Promise<void> {
        if (IS_LOCAL) {
            if (env.localQueueMode === 'inline') {
                await this.processLocally(message);
                return;
            }

            if (env.localQueueMode === 'worker') {
                dispatchLocalWorker(message);
                return;
            }

            const timer = setTimeout(() => {
                void this.processLocally(message).catch(err => {
                    console.error('[queue] async local execution failed', err);
                });
            }, 0);
            timer.unref?.();
            return;
        } else {
            if (!env.executionQueueUrl) throw new Error('EXECUTION_QUEUE_URL not configured');
            await getSqsClient().send(
                new SendMessageCommand({
                    QueueUrl: env.executionQueueUrl,
                    MessageBody: JSON.stringify(message),
                })
            );
        }
    },

    /**
     * Process a queue message directly (the Lambda handler body in prod).
     * Called from:
     *   - send() in local mode
     *   - SQS-triggered Lambda worker in prod (future)
     */
    async processLocally(message: QueueMessage): Promise<void> {
        switch (message.type) {
            case 'EXECUTE_RUN':
                await executionEngine.handleRunExecution(message.runId, message.executionId);
                break;

            case 'EXECUTE_NODE':
                await executionEngine.handleNodeExecution(message.runId, message.nodeId, message.executionId);
                break;

            default: {
                const _exhaustive: never = message;
                console.warn('[queue] processLocally: unknown message type', _exhaustive);
            }
        }
    },
};
