import { api } from '@flows/web-core';

const _log = console.log.bind(console, '[assets-api]');

// ============================================================================
// Types
// ============================================================================

export interface AssetMetadata {
    width?: number;
    height?: number;
    durationSec?: number;
    name?: string;
    [key: string]: unknown;
}

export interface AssetView {
    assetId: string;
    runId?: string;
    runNodeId?: string;
    flowId?: string;
    /** Lowercased asset type: image | audio | video | json | text */
    type: 'image' | 'audio' | 'video' | 'json' | 'text' | string;
    mimeType?: string;
    /** Public CDN URL for download/display */
    url?: string;
    name?: string;
    createdAt?: number;
    metadata?: AssetMetadata;
}

// Backend raw type (server returns uppercase assetType and publicUrl)
interface BackendAsset {
    assetId: string;
    runId?: string;
    runNodeId?: string;
    flowId?: string;
    assetType: 'IMAGE' | 'AUDIO' | 'VIDEO' | 'JSON' | 'TEXT' | string;
    mimeType?: string;
    publicUrl?: string | null;
    metadata?: AssetMetadata;
    createdAt?: string | number;
}

// ============================================================================
// Conversion helper
// ============================================================================

/**
 * Normalize backend Asset to AssetView
 * - assetType (IMAGE) → type (image)
 * - publicUrl → url (empty string if null)
 * - metadata.name → name (fallback to assetId)
 * - createdAt string → ms timestamp
 */
export const toAssetView = (raw: BackendAsset): AssetView => ({
    assetId: raw.assetId,
    runId: raw.runId,
    runNodeId: raw.runNodeId,
    flowId: raw.flowId,
    type: (raw.assetType ?? '').toLowerCase() as AssetView['type'],
    mimeType: raw.mimeType,
    url: raw.publicUrl ?? '',
    name: raw.metadata?.name ?? raw.assetId,
    createdAt: raw.createdAt ? Date.parse(String(raw.createdAt)) : undefined,
    metadata: raw.metadata,
});

// ============================================================================
// API functions
// ============================================================================

/**
 * Fetch asset metadata and download URL
 * GET /assets/{assetId}
 */
export const getAsset = async (assetId: string): Promise<AssetView> => {
    _log(`> getAsset(${assetId})`);
    const response = await api.get<BackendAsset>(`/assets/${assetId}`);
    return toAssetView(response.data);
};

/**
 * List assets for a run
 * GET /runs/{runId}/assets
 */
export const getRunAssets = async (runId: string): Promise<AssetView[]> => {
    _log(`> getRunAssets(${runId})`);
    const response = await api.get<{ items: BackendAsset[] }>(`/runs/${runId}/assets`);
    return (response.data.items ?? []).map(toAssetView);
};
