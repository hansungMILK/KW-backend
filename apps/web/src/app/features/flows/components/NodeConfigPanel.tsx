import React from 'react';
import { useTranslation } from 'react-i18next';

import { FileText, Settings, X } from 'lucide-react';

import { cn } from '@flows/lib/utils';

import type { NodeData } from '@flows/flows';

interface NodeConfigPanelProps {
    selectedNode: NodeData | null;
    onClose: () => void;
    onLabelChange: (nodeId: string, label: string) => void;
    onDescriptionChange: (nodeId: string, description: string) => void;
    onConfigChange: (nodeId: string, key: string, value: unknown) => void;
}

type MaybeCustomNode = NodeData & {
    blockType?: string;
    label?: string;
    name?: string;
};

export const isCustomNode = (node: NodeData | null | undefined): node is NodeData => {
    if (!node) return false;

    const { type, blockType } = node as MaybeCustomNode;

    return (
        type === 'custom' ||
        type === 'custom-node' ||
        type.startsWith('custom-') ||
        (typeof blockType === 'string' && blockType.length > 0 && !type)
    );
};

const stringifyConfigValue = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(value, null, 2);
};

const parseConfigValue = (value: string): unknown => {
    const trimmed = value.trim();
    if (trimmed === '') return '';
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;

    const numeric = Number(trimmed);
    if (!Number.isNaN(numeric) && trimmed === String(numeric)) return numeric;

    try {
        return JSON.parse(trimmed);
    } catch {
        return value;
    }
};

export const NodeConfigPanel: React.FC<NodeConfigPanelProps> = ({
    selectedNode,
    onClose,
    onLabelChange,
    onDescriptionChange,
    onConfigChange,
}) => {
    const { t } = useTranslation(['flows']);

    if (!selectedNode) return null;

    const customNode = selectedNode as MaybeCustomNode;
    const config = (selectedNode.config ?? {}) as Record<string, unknown>;
    const configEntries = Object.entries(config);
    const title = selectedNode.customLabel || customNode.label || customNode.name || selectedNode.type;
    const nodeId = selectedNode.id ?? '';

    return (
        <div
            className={cn(
                'fixed inset-y-0 right-0 w-full sm:w-80',
                'flex flex-col bg-glass-bg backdrop-blur-[20px] border-l sm:border-l border-glass-border',
                'shadow-floating overflow-hidden',
                'animate-in slide-in-from-right-4 duration-200 z-50'
            )}
            onMouseDown={e => e.stopPropagation()}
            onDoubleClick={e => e.stopPropagation()}
        >
            <div className="p-3 border-b border-border/50 bg-surface-elevated/50 flex-shrink-0">
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                            <Settings className="w-4 h-4 text-primary" />
                        </div>
                        <input
                            type="text"
                            value={title ?? ''}
                            onChange={e => onLabelChange(nodeId, e.target.value)}
                            className="bg-transparent font-semibold text-sm text-foreground focus:bg-muted/30 outline-none rounded px-1.5 py-0.5 -ml-1 flex-1 min-w-0 border border-transparent focus:border-primary/40 transition-colors"
                            placeholder={t('detailPanel.nodeLabel')}
                        />
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-muted-foreground/60 hover:text-foreground w-7 h-7 flex items-center justify-center rounded-md hover:bg-muted/50 transition-colors"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <span className="text-[10px] font-mono bg-muted/50 px-1.5 py-0.5 rounded border border-border/50 text-muted-foreground">
                    {customNode.blockType || selectedNode.type}
                </span>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3" onWheel={e => e.stopPropagation()}>
                <section className="border border-border/50 rounded-lg overflow-hidden bg-muted/20">
                    <div className="px-3 py-2 flex items-center gap-2">
                        <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-xs font-semibold text-foreground/90 uppercase tracking-wider">
                            {t('detailPanel.description')}
                        </span>
                    </div>
                    <div className="px-3 pb-3">
                        <textarea
                            className="w-full bg-background/60 border border-border/50 rounded-md p-2 text-xs text-foreground focus:border-primary/50 outline-none resize-none h-20 transition-colors"
                            value={selectedNode.description || ''}
                            onChange={e => onDescriptionChange(nodeId, e.target.value)}
                            onKeyDown={e => e.stopPropagation()}
                            placeholder={t('detailPanel.descriptionPlaceholder')}
                        />
                    </div>
                </section>

                <section className="border border-border/50 rounded-lg overflow-hidden bg-muted/20">
                    <div className="px-3 py-2 flex items-center gap-2">
                        <Settings className="w-3.5 h-3.5 text-primary" />
                        <span className="text-xs font-semibold text-foreground/90 uppercase tracking-wider">
                            {t('detailPanel.configuration')}
                        </span>
                    </div>
                    <div className="px-3 pb-3 space-y-3">
                        {configEntries.length === 0 ? (
                            <div className="text-xs text-muted-foreground/60 italic text-center py-2">
                                {t('detailPanel.noSettings')}
                            </div>
                        ) : (
                            configEntries.map(([key, value]) => (
                                <div key={key}>
                                    <label className="text-[10px] text-muted-foreground/80 font-medium mb-1.5 block uppercase tracking-wider">
                                        {key}
                                    </label>
                                    <textarea
                                        className="w-full bg-background/80 border border-border/60 rounded-md px-2.5 py-2 text-xs text-foreground focus:border-primary/60 outline-none transition-colors resize-y min-h-[40px] font-mono"
                                        value={stringifyConfigValue(value)}
                                        onChange={e => onConfigChange(nodeId, key, parseConfigValue(e.target.value))}
                                        onKeyDown={e => e.stopPropagation()}
                                    />
                                </div>
                            ))
                        )}
                    </div>
                </section>
            </div>
        </div>
    );
};
