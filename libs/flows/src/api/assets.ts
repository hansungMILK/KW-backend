import { api } from '@flows/web-core';

// TODO: remove mock when backend is fully ready for getAsset
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

/**
 * Get asset by ID
 * GET /assets/{assetId}
 *
 * TODO: backend not ready — replace mock with real call:
 * return (await api.get<AssetView>(`/assets/${assetId}`)).data;
 */
export const getAsset = async (assetId: string): Promise<AssetView> => {
    _log(`> getAsset(${assetId})`);
    return Promise.resolve({
        id: assetId,
        type: 'file',
        url: '',
        name: assetId,
        createdAt: Date.now(),
    });
};

/**
 * Get all assets for a run
 * GET /runs/{runId}/assets
 */
export const getRunAssets = async (runId: string): Promise<AssetView[]> => {
    _log(`> getRunAssets(${runId})`);
    const response = await api.get<AssetView[]>(`/runs/${runId}/assets`);
    return response.data;
};
