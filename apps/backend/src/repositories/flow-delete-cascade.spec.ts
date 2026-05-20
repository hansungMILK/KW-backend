import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./message-repository', () => ({
    messageRepo: {
        deleteByFlowId: vi.fn(async () => 1),
    },
}));

vi.mock('./proposal-repository', () => ({
    proposalRepo: {
        deleteByFlowId: vi.fn(async () => 2),
    },
}));

vi.mock('./run-repository', () => ({
    runRepo: {
        listByFlow: vi.fn(),
        deleteRunNodes: vi.fn(async () => 2),
        deleteRun: vi.fn(async () => undefined),
    },
}));

vi.mock('./asset-repository', () => ({
    assetRepo: {
        listByRun: vi.fn(),
        delete: vi.fn(async () => undefined),
    },
}));

vi.mock('./trace-repository', () => ({
    traceRepo: {
        deleteByRun: vi.fn(async () => 3),
    },
}));

vi.mock('../adapters/aws/s3', () => ({
    deleteObject: vi.fn(async () => undefined),
}));

import { assetRepo } from './asset-repository';
import { flowRepo } from './flow-repository';
import { messageRepo } from './message-repository';
import { proposalRepo } from './proposal-repository';
import { runRepo } from './run-repository';
import { traceRepo } from './trace-repository';
import { deleteObject } from '../adapters/aws/s3';

import type { Asset, Run } from '@flows/contracts';

const makeRun = (runId: string, status: Run['status'] = 'COMPLETED'): Run => ({
    runId,
    flowId: 'flow-cascade-delete',
    status,
    runType: 'FULL_FLOW',
    createdAt: '2026-05-20T00:00:00.000Z',
    updatedAt: '2026-05-20T00:00:00.000Z',
    startedAt: null,
    completedAt: null,
});

const makeAsset = (assetId: string, runId: string, s3Key?: string): Asset => ({
    assetId,
    runId,
    runNodeId: 'node-1',
    flowId: 'flow-cascade-delete',
    assetType: 'IMAGE',
    mimeType: 'image/png',
    publicUrl: null,
    metadata: s3Key ? { s3Key } : {},
    status: 'PUBLISHED',
    createdAt: '2026-05-20T00:00:00.000Z',
});

describe('flowRepo.deleteWithCascade', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        await flowRepo.delete('flow-cascade-delete');
        await flowRepo.put({
            id: 'flow-cascade-delete',
            name: '삭제 대상 플로우',
            state: 'READY',
            nodes: [],
            edges: [],
            channelId: 'flow-cascade-delete',
            createdAt: '2026-05-20T00:00:00.000Z',
            updatedAt: '2026-05-20T00:00:00.000Z',
        });
    });

    it('deletes flow-owned runs, run nodes, traces, asset records, and S3 objects', async () => {
        vi.mocked(runRepo.listByFlow).mockResolvedValueOnce({
            items: [makeRun('run-1'), makeRun('run-2', 'FAILED')],
            nextCursor: null,
        });
        vi.mocked(assetRepo.listByRun).mockImplementation(async runId =>
            runId === 'run-1'
                ? [
                      makeAsset('asset-1', runId, 'media/images/scene-001.png'),
                      makeAsset('asset-2', runId, 'media/images/scene-001.png'),
                  ]
                : [makeAsset('asset-3', runId, 'media/video/output.mp4')]
        );
        vi.mocked(runRepo.deleteRunNodes).mockResolvedValueOnce(2).mockResolvedValueOnce(1);
        vi.mocked(traceRepo.deleteByRun).mockResolvedValueOnce(4).mockResolvedValueOnce(5);

        const result = await flowRepo.deleteWithCascade('flow-cascade-delete');

        expect(result).toEqual({
            deleted: true,
            messagesDeleted: 1,
            proposalsDeleted: 2,
            runsDeleted: 2,
            runNodesDeleted: 3,
            tracesDeleted: 9,
            assetsDeleted: 3,
            storageObjectsDeleted: 2,
            activeRunCount: 0,
        });
        expect(deleteObject).toHaveBeenCalledTimes(2);
        expect(deleteObject).toHaveBeenCalledWith('media/images/scene-001.png');
        expect(deleteObject).toHaveBeenCalledWith('media/video/output.mp4');
        expect(assetRepo.delete).toHaveBeenCalledWith('asset-1');
        expect(assetRepo.delete).toHaveBeenCalledWith('asset-2');
        expect(assetRepo.delete).toHaveBeenCalledWith('asset-3');
        expect(runRepo.deleteRunNodes).toHaveBeenCalledWith('run-1');
        expect(runRepo.deleteRunNodes).toHaveBeenCalledWith('run-2');
        expect(runRepo.deleteRun).toHaveBeenCalledWith('run-1');
        expect(runRepo.deleteRun).toHaveBeenCalledWith('run-2');
        expect(messageRepo.deleteByFlowId).toHaveBeenCalledWith('flow-cascade-delete');
        expect(proposalRepo.deleteByFlowId).toHaveBeenCalledWith('flow-cascade-delete');
        await expect(flowRepo.get('flow-cascade-delete')).resolves.toBeNull();
    });

    it('does not delete anything when the flow still has queued or running runs', async () => {
        vi.mocked(runRepo.listByFlow).mockResolvedValueOnce({
            items: [makeRun('run-active', 'RUNNING')],
            nextCursor: null,
        });

        const result = await flowRepo.deleteWithCascade('flow-cascade-delete');

        expect(result.deleted).toBe(false);
        expect(result.activeRunCount).toBe(1);
        expect(deleteObject).not.toHaveBeenCalled();
        expect(assetRepo.delete).not.toHaveBeenCalled();
        expect(runRepo.deleteRun).not.toHaveBeenCalled();
        expect(messageRepo.deleteByFlowId).not.toHaveBeenCalled();
        await expect(flowRepo.get('flow-cascade-delete')).resolves.not.toBeNull();
    });
});
