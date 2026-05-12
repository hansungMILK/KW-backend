import { QueueMessageSchema } from '@flows/contracts';

import { queue } from '../adapters/aws/queue';

const rawMessage = process.env.LOCAL_QUEUE_MESSAGE_JSON;

if (!rawMessage) {
    throw new Error('LOCAL_QUEUE_MESSAGE_JSON is required for local worker execution');
}

const messageJson = rawMessage;

async function main(): Promise<void> {
    const parsed = QueueMessageSchema.parse(JSON.parse(messageJson));
    await queue.processLocally(parsed);
}

void main().catch(err => {
    console.error('[local-worker] execution failed', err);
    process.exitCode = 1;
});
