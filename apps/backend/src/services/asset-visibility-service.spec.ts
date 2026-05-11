import { beforeEach, describe, expect, it, vi } from 'vitest';

import { assetVisibilityService } from './asset-visibility-service';
import { assetRepo } from '../repositories/asset-repository';
import { runRepo } from '../repositories/run-repository';

import type { Asset, RunNode } from '@flows/contracts';

vi.mock('../repositories/asset-repository', () => ({
    assetRepo: {
        get: vi.fn(),
        listByRun: vi.fn(),
    },
}));

vi.mock('../repositories/run-repository', () => ({
    runRepo: {
        getRunNode: vi.fn(),
        listRunNodes: vi.fn(),
    },
}));

const getAsset = vi.mocked(assetRepo.get);
const listAssetsByRun = vi.mocked(assetRepo.listByRun);
const getRunNode = vi.mocked(runRepo.getRunNode);
const listRunNodes = vi.mocked(runRepo.listRunNodes);

const makeAsset = (assetId: string, runNodeId: string, status?: Asset['status']): Asset =>
    ({
        assetId,
        runId: 'run-assets',
        runNodeId,
        flowId: 'flow-assets',
        assetType: 'IMAGE',
        mimeType: 'image/png',
        publicUrl: `http://localhost/${assetId}.png`,
        metadata: {},
        ...(status ? { status } : {}),
        createdAt: new Date().toISOString(),
    }) as Asset;

const makeNode = (nodeId: string, status: RunNode['status']): RunNode =>
    ({
        runId: 'run-assets',
        nodeId,
        blockType: 'media-image',
        label: nodeId,
        status,
        progress: status === 'COMPLETED' ? 100 : 75,
        retryCount: 0,
        parentNodeIds: [],
        updatedAt: new Date().toISOString(),
    }) as RunNode;

describe('assetVisibilityService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('lists only published assets whose producer node is completed', async () => {
        const visible = makeAsset('asset-visible', 'node-completed', 'PUBLISHED');
        const pending = makeAsset('asset-pending', 'node-completed', 'PENDING');
        const runningNodeAsset = makeAsset('asset-running-node', 'node-running', 'PUBLISHED');
        const legacyVisible = makeAsset('asset-legacy-visible', 'node-completed');

        listAssetsByRun.mockResolvedValueOnce([visible, pending, runningNodeAsset, legacyVisible]);
        listRunNodes.mockResolvedValueOnce([
            makeNode('node-completed', 'COMPLETED'),
            makeNode('node-running', 'RUNNING'),
        ]);

        await expect(assetVisibilityService.listPublishedByRun('run-assets')).resolves.toEqual([
            visible,
            { ...legacyVisible, status: 'PUBLISHED' },
        ]);
    });

    it('hides direct asset lookup until the asset is published and its producer node is completed', async () => {
        const pending = makeAsset('asset-pending', 'node-completed', 'PENDING');
        const runningNodeAsset = makeAsset('asset-running-node', 'node-running', 'PUBLISHED');
        const visible = makeAsset('asset-visible', 'node-completed', 'PUBLISHED');
        const legacyVisible = makeAsset('asset-legacy-visible', 'node-completed');

        getAsset.mockResolvedValueOnce(pending);
        await expect(assetVisibilityService.getPublished('asset-pending')).resolves.toBeNull();

        getAsset.mockResolvedValueOnce(runningNodeAsset);
        getRunNode.mockResolvedValueOnce(makeNode('node-running', 'RUNNING'));
        await expect(assetVisibilityService.getPublished('asset-running-node')).resolves.toBeNull();

        getAsset.mockResolvedValueOnce(visible);
        getRunNode.mockResolvedValueOnce(makeNode('node-completed', 'COMPLETED'));
        await expect(assetVisibilityService.getPublished('asset-visible')).resolves.toEqual(visible);

        getAsset.mockResolvedValueOnce(legacyVisible);
        getRunNode.mockResolvedValueOnce(makeNode('node-completed', 'COMPLETED'));
        await expect(assetVisibilityService.getPublished('asset-legacy-visible')).resolves.toEqual({
            ...legacyVisible,
            status: 'PUBLISHED',
        });
    });
});
