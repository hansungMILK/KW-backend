import { assetRepo } from '../repositories/asset-repository';
import { runRepo } from '../repositories/run-repository';

import type { Asset, RunNode } from '@flows/contracts';

const isCompletedNode = (node: RunNode | null | undefined): boolean => node?.status === 'COMPLETED';

const getStoredAssetStatus = (asset: Asset): Asset['status'] | undefined =>
    (asset as Asset & { status?: Asset['status'] }).status;

const isVisibleAssetStatus = (asset: Asset): boolean => {
    const status = getStoredAssetStatus(asset);
    return status === 'PUBLISHED' || status === undefined;
};

const normalizePublishedAsset = (asset: Asset): Asset => {
    if (asset.status === 'PUBLISHED') return asset;
    return { ...asset, status: 'PUBLISHED' };
};

export const assetVisibilityService = {
    async listPublishedByRun(runId: string): Promise<Asset[]> {
        const [assets, nodes] = await Promise.all([assetRepo.listByRun(runId), runRepo.listRunNodes(runId)]);
        const completedNodeIds = new Set(nodes.filter(isCompletedNode).map(node => node.nodeId));

        return assets
            .filter(asset => isVisibleAssetStatus(asset) && completedNodeIds.has(asset.runNodeId))
            .map(normalizePublishedAsset);
    },

    async getPublished(assetId: string): Promise<Asset | null> {
        const asset = await assetRepo.get(assetId);
        if (!asset || !isVisibleAssetStatus(asset)) return null;

        const node = await runRepo.getRunNode(asset.runId, asset.runNodeId);
        if (!isCompletedNode(node)) return null;

        return normalizePublishedAsset(asset);
    },
};
