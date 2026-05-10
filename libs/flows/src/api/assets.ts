import { api } from '@flows/web-core';

const _log = console.log.bind(console, '[assets-api]');

export interface AssetView {
    id: string;
    type: 'image' | 'audio' | 'video' | string;
    url?: string;
    name?: string;
    mimeType?: string;
    createdAt?: number;
}

/**
 * Fetch asset metadata and download URL
 * GET /assets/{assetId}
 *
 * @param assetId - Asset ID to fetch
 * @returns AssetView with type, url, and metadata
 */
export const getAsset = async (assetId: string): Promise<AssetView> => {
    _log(`> getAsset(${assetId})`);
    const response = await api.get<AssetView>(`/assets/${assetId}`);
    return response.data;
};
