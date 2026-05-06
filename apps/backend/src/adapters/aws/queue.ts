import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

import { env, isLocalStage } from '../../config/env';
import { executionEngine } from '../../services/execution-engine';

import type { QueueMessage } from '@flows/contracts';

/**
 * Queue abstraction — decouples run-service from execution engine.
 *
 * Local mode  (STAGE=local, no SQS):
 *   send() schedules processLocally() asynchronously by default so HTTP
 *   requests return QUEUED quickly while serverless-offline keeps running.
 *
 * Prod mode  (STAGE != local):
 *   send() publishes to SQS; processLocally() is used by the SQS Lambda worker.
 */

const IS_LOCAL = isLocalStage;

let _sqsClient: SQSClient | null = null;
const getSqsClient = (): SQSClient => {
    if (!_sqsClient) _sqsClient = new SQSClient({ region: env.awsRegion });
    return _sqsClient;
};

export const queue = {
    /**
     * Send a queue message.
     * In local mode: schedule local processing, or process inline when
     * LOCAL_QUEUE_MODE=inline is explicitly set.
     * In prod mode: publish to SQS and let the worker Lambda process it.
     */
    async send(message: QueueMessage): Promise<void> {
        if (IS_LOCAL) {
            if (env.localQueueMode === 'inline') {
                await this.processLocally(message);
                return;
            }

            setImmediate(() => {
                void this.processLocally(message).catch(err => {
                    console.error('[queue] async local execution failed', err);
                });
            });
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
