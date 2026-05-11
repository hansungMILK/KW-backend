import { beforeEach, describe, expect, it, vi } from 'vitest';

import { blockExecutor } from './block-executor';
import { executionEngine } from './execution-engine';
import { wsService } from './websocket-service';
import { deleteObject } from '../adapters/aws/s3';
import { assetRepo } from '../repositories/asset-repository';
import { runRepo } from '../repositories/run-repository';

import type { Run, RunNode } from '@flows/contracts';

vi.mock('../utils/id-generator', () => {
    let nextId = 0;
    return {
        generateNumericId: vi.fn(() => {
            nextId += 1;
            return `asset-${nextId}`;
        }),
    };
});

vi.mock('./block-executor', () => ({
    blockExecutor: {
        execute: vi.fn(),
    },
}));

vi.mock('./trace-service', () => ({
    traceService: {
        record: vi.fn(async () => undefined),
    },
}));

vi.mock('./websocket-service', () => ({
    wsService: {
        broadcastToFlow: vi.fn(async () => undefined),
    },
}));

vi.mock('./ws-flow-events-service', () => ({
    broadcastNodePortUpdated: vi.fn(async () => undefined),
}));

vi.mock('../adapters/aws/s3', () => ({
    deleteObject: vi.fn(async () => undefined),
    getPublicUrl: (key: string) => `http://localhost:8800/_local-assets/${key}`,
    publicUrlFromS3Uri: (uri: string) => `http://localhost:8800/_local-assets/${uri.replace(/^s3:\/\/[^/]+\//, '')}`,
    putObject: vi.fn(async () => undefined),
}));

vi.mock('../repositories/asset-repository', () => ({
    assetRepo: {
        put: vi.fn(async () => undefined),
        updateStatus: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
    },
}));

vi.mock('../repositories/run-repository', () => ({
    runRepo: {
        getRun: vi.fn(),
        getRunNode: vi.fn(),
        updateRunNodeStatus: vi.fn(),
    },
}));

const executeBlock = vi.mocked(blockExecutor.execute);
const deleteUploadedObject = vi.mocked(deleteObject);
const putAsset = vi.mocked(assetRepo.put);
const updateAssetStatus = vi.mocked(assetRepo.updateStatus);
const deleteAsset = vi.mocked(assetRepo.delete);
const broadcastToFlow = vi.mocked(wsService.broadcastToFlow);
const getRun = vi.mocked(runRepo.getRun);
const getRunNode = vi.mocked(runRepo.getRunNode);
const updateRunNodeStatus = vi.mocked(runRepo.updateRunNodeStatus);

describe('executionEngine asset publication', () => {
    let run: Run;
    let node: RunNode;
    let sequence: string[];

    beforeEach(() => {
        vi.clearAllMocks();
        sequence = [];

        run = {
            runId: 'run-asset-test',
            flowId: 'flow-asset-test',
            runType: 'FULL_FLOW',
            status: 'RUNNING',
            triggerSource: 'MANUAL',
            flowSnapshot: { nodes: [], edges: [] },
            createdAt: new Date().toISOString(),
        } as Run;

        node = {
            runId: run.runId,
            nodeId: 'node-image',
            blockType: 'media-image',
            label: '이미지 생성',
            status: 'PENDING',
            progress: 0,
            retryCount: 0,
            parentNodeIds: [],
            updatedAt: new Date().toISOString(),
        } as RunNode;

        getRun.mockImplementation(async () => run);
        getRunNode.mockImplementation(async () => node);
        updateRunNodeStatus.mockImplementation(async (_runId, _nodeId, status, extra) => {
            sequence.push(`node.status:${status}`);
            node = {
                ...node,
                ...extra,
                status,
            } as RunNode;
            return { ok: true, node };
        });
        putAsset.mockImplementation(async asset => {
            sequence.push(`asset.put:${asset.assetId}:${asset.status}`);
        });
        deleteUploadedObject.mockImplementation(async key => {
            sequence.push(`storage.delete:${key}`);
        });
        updateAssetStatus.mockImplementation(async (assetId, status) => {
            sequence.push(`asset.status:${assetId}:${status}`);
            return {
                assetId,
                runId: run.runId,
                runNodeId: node.nodeId,
                flowId: run.flowId,
                assetType: 'IMAGE',
                mimeType: 'image/png',
                status,
                createdAt: new Date().toISOString(),
            };
        });
        deleteAsset.mockImplementation(async assetId => {
            sequence.push(`asset.delete:${assetId}`);
        });
        broadcastToFlow.mockImplementation(async (_flowId, message) => {
            const type =
                typeof message === 'object' && message ? String((message as { type?: unknown }).type) : 'unknown';
            sequence.push(`ws:${type}`);
        });
    });

    it('broadcasts asset.created only after the node is completed', async () => {
        executeBlock.mockResolvedValueOnce({
            output: { images: [{ sceneNumber: 1 }, { sceneNumber: 2 }] },
            durationMs: 123,
            assets: [
                {
                    assetType: 'IMAGE',
                    mimeType: 'image/png',
                    data: 'http://localhost/image-1.png',
                    metadata: { sceneNumber: 1, s3Key: 'media/images/batch/scene-001.png' },
                },
                {
                    assetType: 'IMAGE',
                    mimeType: 'image/png',
                    data: 'http://localhost/image-2.png',
                    metadata: { sceneNumber: 2, s3Key: 'media/images/batch/scene-002.png' },
                },
            ],
        });

        await executionEngine.handleNodeExecution(run.runId, node.nodeId, 'exec-1');

        const completedIndex = sequence.indexOf('node.status:COMPLETED');
        const firstAssetEventIndex = sequence.indexOf('ws:asset.created');

        expect(completedIndex).toBeGreaterThan(-1);
        expect(firstAssetEventIndex).toBeGreaterThan(completedIndex);
        expect(putAsset).toHaveBeenCalledTimes(2);
        expect(putAsset.mock.calls.every(call => call[0].status === 'PENDING')).toBe(true);
        expect(updateAssetStatus).toHaveBeenCalledTimes(2);
        expect(updateAssetStatus.mock.calls.every(call => call[1] === 'PUBLISHED')).toBe(true);
        expect(
            broadcastToFlow.mock.calls.filter(([, msg]) => (msg as { type?: string }).type === 'asset.created')
        ).toHaveLength(2);
    });

    it('rolls back inserted assets and emits no asset.created event when batch persistence fails', async () => {
        executeBlock.mockResolvedValueOnce({
            output: { images: [{ sceneNumber: 1 }, { sceneNumber: 2 }] },
            durationMs: 123,
            assets: [
                {
                    assetType: 'IMAGE',
                    mimeType: 'image/png',
                    data: 'http://localhost/image-1.png',
                    metadata: { sceneNumber: 1, s3Key: 'media/images/batch/scene-001.png' },
                },
                {
                    assetType: 'IMAGE',
                    mimeType: 'image/png',
                    data: 'http://localhost/image-2.png',
                    metadata: { sceneNumber: 2, s3Key: 'media/images/batch/scene-002.png' },
                },
            ],
        });
        putAsset.mockImplementationOnce(async asset => {
            sequence.push(`asset.put:${asset.assetId}:${asset.status}`);
        });
        putAsset.mockImplementationOnce(async () => {
            sequence.push('asset.put:failed');
            throw new Error('asset persistence failed');
        });

        await executionEngine.handleNodeExecution(run.runId, node.nodeId, 'exec-1');

        const insertedAsset = putAsset.mock.calls[0]?.[0];
        expect(insertedAsset?.assetId).toBeTruthy();
        expect(deleteAsset).toHaveBeenCalledWith(insertedAsset?.assetId);
        expect(sequence).toContain('node.status:FAILED');
        expect(broadcastToFlow.mock.calls.some(([, msg]) => (msg as { type?: string }).type === 'asset.created')).toBe(
            false
        );
    });

    it('rolls back assets and emits no asset.created event when publish status update fails', async () => {
        executeBlock.mockResolvedValueOnce({
            output: { images: [{ sceneNumber: 1 }, { sceneNumber: 2 }] },
            durationMs: 123,
            assets: [
                {
                    assetType: 'IMAGE',
                    mimeType: 'image/png',
                    data: 'http://localhost/image-1.png',
                    metadata: { sceneNumber: 1, s3Key: 'media/images/batch/scene-001.png' },
                },
                {
                    assetType: 'IMAGE',
                    mimeType: 'image/png',
                    data: 'http://localhost/image-2.png',
                    metadata: { sceneNumber: 2, s3Key: 'media/images/batch/scene-002.png' },
                },
            ],
        });
        updateAssetStatus.mockImplementationOnce(async (assetId, status) => {
            sequence.push(`asset.status:${assetId}:${status}`);
            return {
                assetId,
                runId: run.runId,
                runNodeId: node.nodeId,
                flowId: run.flowId,
                assetType: 'IMAGE',
                mimeType: 'image/png',
                status,
                createdAt: new Date().toISOString(),
            };
        });
        updateAssetStatus.mockImplementationOnce(async assetId => {
            sequence.push(`asset.status:${assetId}:failed`);
            throw new Error('asset publish failed');
        });

        await executionEngine.handleNodeExecution(run.runId, node.nodeId, 'exec-1');

        const insertedAssetIds = putAsset.mock.calls.map(call => call[0].assetId);
        expect(insertedAssetIds).toHaveLength(2);
        for (const assetId of insertedAssetIds) {
            expect(deleteAsset).toHaveBeenCalledWith(assetId);
        }
        expect(deleteUploadedObject).toHaveBeenCalledWith('media/images/batch/scene-001.png');
        expect(deleteUploadedObject).toHaveBeenCalledWith('media/images/batch/scene-002.png');
        expect(sequence).toContain('node.status:FAILED');
        expect(broadcastToFlow.mock.calls.some(([, msg]) => (msg as { type?: string }).type === 'asset.created')).toBe(
            false
        );
    });

    it('does not publish assets reported through context.onAsset when the block later fails', async () => {
        executeBlock.mockImplementationOnce(async (_blockType, _input, _config, context) => {
            await context?.onAsset?.({
                assetType: 'IMAGE',
                mimeType: 'image/png',
                data: 'http://localhost/partial-image.png',
                metadata: { sceneNumber: 1 },
            });
            throw new Error('block failed after reporting an asset');
        });

        await executionEngine.handleNodeExecution(run.runId, node.nodeId, 'exec-1');

        expect(putAsset).not.toHaveBeenCalled();
        expect(deleteAsset).not.toHaveBeenCalled();
        expect(sequence).toContain('node.status:FAILED');
        expect(broadcastToFlow.mock.calls.some(([, msg]) => (msg as { type?: string }).type === 'asset.created')).toBe(
            false
        );
    });

    it('rolls back assets when the completed status transition fails after persistence', async () => {
        executeBlock.mockResolvedValueOnce({
            output: { images: [{ sceneNumber: 1 }, { sceneNumber: 2 }] },
            durationMs: 123,
            assets: [
                {
                    assetType: 'IMAGE',
                    mimeType: 'image/png',
                    data: 'http://localhost/image-1.png',
                    metadata: { sceneNumber: 1 },
                },
                {
                    assetType: 'IMAGE',
                    mimeType: 'image/png',
                    data: 'http://localhost/image-2.png',
                    metadata: { sceneNumber: 2 },
                },
            ],
        });
        updateRunNodeStatus.mockImplementation(async (_runId, _nodeId, status, extra) => {
            sequence.push(`node.status:${status}`);
            if (status === 'COMPLETED') {
                return { ok: false, error: 'completion transition failed' };
            }
            node = {
                ...node,
                ...extra,
                status,
            } as RunNode;
            return { ok: true, node };
        });

        await executionEngine.handleNodeExecution(run.runId, node.nodeId, 'exec-1');

        const insertedAssetIds = putAsset.mock.calls.map(call => call[0].assetId);
        expect(insertedAssetIds).toHaveLength(2);
        for (const assetId of insertedAssetIds) {
            expect(deleteAsset).toHaveBeenCalledWith(assetId);
        }
        expect(sequence).toContain('node.status:FAILED');
        expect(broadcastToFlow.mock.calls.some(([, msg]) => (msg as { type?: string }).type === 'asset.created')).toBe(
            false
        );
    });

    it('rolls back published assets when the run is cancelled before node completion', async () => {
        executeBlock.mockResolvedValueOnce({
            output: { images: [{ sceneNumber: 1 }, { sceneNumber: 2 }] },
            durationMs: 123,
            assets: [
                {
                    assetType: 'IMAGE',
                    mimeType: 'image/png',
                    data: 'http://localhost/image-1.png',
                    metadata: { sceneNumber: 1 },
                },
                {
                    assetType: 'IMAGE',
                    mimeType: 'image/png',
                    data: 'http://localhost/image-2.png',
                    metadata: { sceneNumber: 2 },
                },
            ],
        });
        let publishCount = 0;
        updateAssetStatus.mockImplementation(async (assetId, status) => {
            publishCount += 1;
            sequence.push(`asset.status:${assetId}:${status}`);
            if (publishCount === 2) run = { ...run, status: 'CANCELLED' };
            return {
                assetId,
                runId: run.runId,
                runNodeId: node.nodeId,
                flowId: run.flowId,
                assetType: 'IMAGE',
                mimeType: 'image/png',
                status,
                createdAt: new Date().toISOString(),
            };
        });

        await executionEngine.handleNodeExecution(run.runId, node.nodeId, 'exec-1');

        const insertedAssetIds = putAsset.mock.calls.map(call => call[0].assetId);
        expect(insertedAssetIds).toHaveLength(2);
        for (const assetId of insertedAssetIds) {
            expect(deleteAsset).toHaveBeenCalledWith(assetId);
        }
        expect(sequence).toContain('node.status:CANCELLED');
        expect(updateRunNodeStatus.mock.calls.some(call => call[2] === 'COMPLETED')).toBe(false);
        expect(broadcastToFlow.mock.calls.some(([, msg]) => (msg as { type?: string }).type === 'asset.created')).toBe(
            false
        );
    });

    it('rolls back a pending asset when the run is cancelled immediately after persistence', async () => {
        executeBlock.mockResolvedValueOnce({
            output: { images: [{ sceneNumber: 1 }, { sceneNumber: 2 }] },
            durationMs: 123,
            assets: [
                {
                    assetType: 'IMAGE',
                    mimeType: 'image/png',
                    data: 'http://localhost/image-1.png',
                    metadata: { sceneNumber: 1 },
                },
                {
                    assetType: 'IMAGE',
                    mimeType: 'image/png',
                    data: 'http://localhost/image-2.png',
                    metadata: { sceneNumber: 2 },
                },
            ],
        });
        putAsset.mockImplementationOnce(async asset => {
            sequence.push(`asset.put:${asset.assetId}:${asset.status}`);
            run = { ...run, status: 'CANCELLED' };
        });

        await executionEngine.handleNodeExecution(run.runId, node.nodeId, 'exec-1');

        const insertedAssetId = putAsset.mock.calls[0]?.[0].assetId;
        expect(insertedAssetId).toBeTruthy();
        expect(deleteAsset).toHaveBeenCalledWith(insertedAssetId);
        expect(updateAssetStatus).not.toHaveBeenCalled();
        expect(sequence).toContain('node.status:CANCELLED');
        expect(updateRunNodeStatus.mock.calls.some(call => call[2] === 'COMPLETED')).toBe(false);
        expect(broadcastToFlow.mock.calls.some(([, msg]) => (msg as { type?: string }).type === 'asset.created')).toBe(
            false
        );
    });
});
