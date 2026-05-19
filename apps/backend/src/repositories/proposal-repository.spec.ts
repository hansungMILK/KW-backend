import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
    vi.doUnmock('../adapters/aws/dynamodb');
    vi.resetModules();
});

describe('proposalRepo DynamoDB adapter', () => {
    it('uses DynamoDB instead of memDb when real DynamoDB is selected', async () => {
        const send = vi.fn(async command => {
            if (command.constructor.name === 'QueryCommand') {
                return {
                    Items: [
                        {
                            proposalId: 'p1',
                            flowId: 'flow-1',
                            status: 'PENDING',
                            proposedNodes: [],
                            proposedEdges: [],
                            createdAt: '2026-05-19T00:00:00.000Z',
                            updatedAt: '2026-05-19T00:00:00.000Z',
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
            TableNames: { proposals: 'ProposalsTable' },
            USE_REAL_DYNAMO: true,
            getDocClient: () => ({ send }),
            memDb,
        }));

        const { proposalRepo } = await import('./proposal-repository');

        const listed = await proposalRepo.listByFlow('flow-1');
        await proposalRepo.put({
            proposalId: 'p2',
            flowId: 'flow-1',
            status: 'PENDING',
            proposedNodes: [],
            proposedEdges: [],
            approvalRequired: true,
            createdAt: '2026-05-19T00:00:01.000Z',
            updatedAt: '2026-05-19T00:00:01.000Z',
        });
        await proposalRepo.get('p2');
        await proposalRepo.deleteByFlowId('flow-1');

        expect(listed[0]).not.toHaveProperty('ttl');
        expect(send).toHaveBeenCalled();
        expect(memDb.query).not.toHaveBeenCalled();
        expect(memDb.put).not.toHaveBeenCalled();
        expect(memDb.get).not.toHaveBeenCalled();
    });
});
