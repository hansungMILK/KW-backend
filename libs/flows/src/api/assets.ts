// TODO: import api from '@flows/web-core' when backend is ready
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
 * const response = await api.get<AssetView>(`/assets/${assetId}`);
 * return response.data;
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
