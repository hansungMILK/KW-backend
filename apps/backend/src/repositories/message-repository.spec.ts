import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
    vi.doUnmock('../adapters/aws/dynamodb');
    vi.resetModules();
});

describe('messageRepo DynamoDB adapter', () => {
    it('uses DynamoDB instead of memDb when real DynamoDB is selected', async () => {
        const send = vi.fn(async command => {
            if (command.constructor.name === 'QueryCommand') {
                return {
                    Items: [
                        {
                            messageId: 'm1',
                            flowId: 'flow-1',
                            role: 'assistant',
                            content: 'hello',
                            createdAt: '2026-05-19T00:00:00.000Z',
                            ttl: 123,
                        },
                    ],
                };
            }
            return {};
        });
        const memDb = {
            delete: vi.fn(() => {
                throw new Error('memDb should not be used');
            }),
            get: vi.fn(() => {
                throw new Error('memDb should not be used');
            }),
            put: vi.fn(() => {
                throw new Error('memDb should not be used');
            }),
            query: vi.fn(() => {
                throw new Error('memDb should not be used');
            }),
            scan: vi.fn(() => {
                throw new Error('memDb should not be used');
            }),
        };

        vi.doMock('../adapters/aws/dynamodb', () => ({
            TableNames: { messages: 'MessagesTable' },
            USE_REAL_DYNAMO: true,
            getDocClient: () => ({ send }),
            memDb,
        }));

        const { messageRepo } = await import('./message-repository');

        const listed = await messageRepo.listByFlow('flow-1');
        await messageRepo.put({
            messageId: 'm2',
            flowId: 'flow-1',
            role: 'user',
            content: 'hi',
            createdAt: '2026-05-19T00:00:01.000Z',
        });
        await messageRepo.get('m2');
        await messageRepo.deleteByFlowId('flow-1');

        expect(listed.items[0]).not.toHaveProperty('ttl');
        expect(send).toHaveBeenCalled();
        expect(memDb.query).not.toHaveBeenCalled();
        expect(memDb.put).not.toHaveBeenCalled();
        expect(memDb.get).not.toHaveBeenCalled();
    });
});
