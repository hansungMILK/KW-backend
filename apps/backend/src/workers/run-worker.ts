import { QueueMessageSchema } from '@flows/contracts';

import { queue } from '../adapters/aws/queue';

import type { SQSEvent } from 'aws-lambda';

/**
 * SQS worker for run execution.
 *
 * The HTTP handler enqueues EXECUTE_RUN / EXECUTE_NODE messages and returns 202.
 * This worker owns the actual execution in deployed stages.
 */
export const main = async (event: SQSEvent): Promise<void> => {
    for (const record of event.Records) {
        const body = JSON.parse(record.body) as unknown;
        const parsed = QueueMessageSchema.parse(body);
        await queue.processLocally(parsed);
    }
};
