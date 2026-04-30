import { api } from '@flows/web-core';

import type { Asset } from '@flows/contracts';

const _log = console.log.bind(console, '[assets-api]');

export type AssetType = 'image' | 'audio' | 'video' | 'file';

export interface AssetView {
    id: string;
    type: AssetType;
    url: string;
    name: string;
    size?: number;
    mimeType?: string;
    createdAt: number;
}

const toAssetView = (asset: Asset): AssetView => ({
    id: asset.assetId,
    type: asset.assetType.toLowerCase() as AssetType,
    url: asset.publicUrl ?? '',
    name: String(asset.metadata?.name ?? asset.assetId),
    mimeType: asset.mimeType,
    createdAt: Date.parse(asset.createdAt),
});

/**
 * Get asset by ID
 * GET /assets/{assetId}
 *
 */
export const getAsset = async (assetId: string): Promise<AssetView> => {
    _log(`> getAsset(${assetId})`);
    const response = await api.get<Asset>(`/assets/${assetId}`);
    return toAssetView(response.data);
};

/**
 * Get all assets for a run
 * GET /runs/{runId}/assets
 */
export const getRunAssets = async (runId: string): Promise<AssetView[]> => {
    _log(`> getRunAssets(${runId})`);
    const response = await api.get<{ items: Asset[] }>(`/runs/${runId}/assets`);
    return response.data.items.map(toAssetView);
};
