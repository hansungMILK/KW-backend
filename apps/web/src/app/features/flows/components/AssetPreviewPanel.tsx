import React from 'react';

import { Download, X } from 'lucide-react';

import { cn } from '@flows/lib/utils';

import type { AssetCreatedMessage } from '@flows/socket';

interface AssetPreviewPanelProps {
    asset: AssetCreatedMessage;
    onClose: () => void;
}

export const AssetPreviewPanel: React.FC<AssetPreviewPanelProps> = ({ asset, onClose }) => {
    const { assetType, url, assetId } = asset;

    return (
        <div
            className={cn(
                'absolute bottom-6 right-6 z-40 w-72 rounded-2xl shadow-floating',
                'bg-glass-bg backdrop-blur-[24px] border border-glass-border',
                'animate-in slide-in-from-bottom-4 fade-in duration-200'
            )}
        >
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
                <span className="text-sm font-medium text-foreground">결과물 생성됨</span>
                <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
                    <X className="w-4 h-4" />
                </button>
            </div>

            <div className="p-3">
                {url && assetType === 'image' && (
                    <img src={url} alt={assetId} className="w-full rounded-lg object-cover max-h-40" />
                )}
                {url && assetType === 'video' && (
                    <video src={url} controls autoPlay muted className="w-full rounded-lg max-h-40" />
                )}
                {url && assetType === 'audio' && <audio src={url} controls className="w-full mt-1" />}
                {(!url || (assetType !== 'image' && assetType !== 'video' && assetType !== 'audio')) && (
                    <div className="text-xs text-muted-foreground text-center py-3">
                        파일 ID: <span className="font-mono">{assetId}</span>
                    </div>
                )}
            </div>

            {url && (
                <div className="px-3 pb-3">
                    <a
                        href={url}
                        download
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn(
                            'flex items-center justify-center gap-2 w-full py-2 rounded-lg text-sm font-medium',
                            'bg-primary/10 text-primary hover:bg-primary/20 transition-colors'
                        )}
                    >
                        <Download className="w-3.5 h-3.5" />
                        다운로드
                    </a>
                </div>
            )}
        </div>
    );
};
