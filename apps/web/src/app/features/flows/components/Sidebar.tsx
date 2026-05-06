import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { LayoutGrid, Star } from 'lucide-react';

import { useBlockRegistry } from '@flows/flows';
import { cn } from '@flows/lib/utils';

import type { BlockDefinitionWithFrontend } from '@flows/flows';

interface SidebarProps {
    onAddNode: (type: string, customLabel?: string) => void;
    isLoading?: boolean;
}

export interface SidebarRef {
    open: () => void;
}

type BlockStereo = 'input' | 'process' | 'output';

const CATEGORY_CONFIG: Record<BlockStereo, { label: string }> = {
    input: { label: '입력' },
    process: { label: '처리' },
    output: { label: '출력' },
};
const CATEGORIES: BlockStereo[] = ['input', 'process', 'output'];

const BlockItem: React.FC<{
    block: BlockDefinitionWithFrontend;
    onSelect: () => void;
    disabled?: boolean;
}> = ({ block, onSelect, disabled }) => {
    const { t } = useTranslation('nodes');
    const description = t(`blocks.descriptions.${block.type}`, { defaultValue: block.description ?? '' });
    return (
        <button
            onClick={onSelect}
            disabled={disabled}
            className={cn(
                'w-full text-left py-3 flex gap-3 items-start',
                'border-b border-border last:border-0',
                'hover:bg-accent/30 transition-colors',
                'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
        >
            <Star className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="min-w-0 w-full">
                <p className="text-sm font-medium text-foreground">{block.label}</p>
                {description && (
                    <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{description}</p>
                )}
            </div>
        </button>
    );
};

export const Sidebar = forwardRef<SidebarRef, SidebarProps>(({ onAddNode, isLoading }, ref) => {
    const blockRegistry = useBlockRegistry();
    const [isOpen, setIsOpen] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(ref, () => ({
        open: () => setIsOpen(true),
    }));

    useEffect(() => {
        const el = panelRef.current;
        if (!el) return;
        const handler = (e: WheelEvent) => e.stopPropagation();
        el.addEventListener('wheel', handler, { passive: false });
        return () => el.removeEventListener('wheel', handler);
    }, [isOpen]);

    // Build categorized block list from server registry
    const blocksByCategory = useMemo(() => {
        // blockRegistry indexes each block by both type and id for backward compat,
        // so deduplicate by block.type before categorizing
        const seen = new Set<string>();
        const all = Object.values(blockRegistry).filter(block => {
            if (seen.has(block.type)) return false;
            seen.add(block.type);
            return true;
        });
        const map: Record<BlockStereo, BlockDefinitionWithFrontend[]> = {
            input: [],
            process: [],
            output: [],
        };
        for (const block of all) {
            const stereo = (block as BlockDefinitionWithFrontend & { stereo?: string }).stereo as
                | BlockStereo
                | undefined;
            if (stereo === 'input') map.input.push(block);
            else if (stereo === 'output') map.output.push(block);
            else map.process.push(block); // default to process for unlabeled blocks
        }
        return map;
    }, [blockRegistry]);

    const handleClose = () => setIsOpen(false);

    const handleAddNode = (block: BlockDefinitionWithFrontend) => {
        onAddNode(block.type);
        handleClose();
    };

    return (
        <>
            {/* Library toggle button */}
            <div className="absolute left-2 sm:left-4 bottom-4 sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 z-30 pointer-events-auto">
                <div
                    className={cn(
                        'flex flex-col gap-2 p-1.5 sm:p-2 rounded-xl sm:rounded-2xl',
                        'bg-glass-bg backdrop-blur-[24px] border border-glass-border shadow-floating'
                    )}
                >
                    <button
                        title="라이브러리"
                        onClick={() => setIsOpen(v => !v)}
                        className={cn(
                            'w-9 h-9 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center transition-all duration-150 hover:bg-accent',
                            isOpen
                                ? 'bg-glass-bg text-primary shadow-md'
                                : 'text-muted-foreground hover:text-foreground'
                        )}
                    >
                        <LayoutGrid className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Block list panel */}
            {isOpen && (
                <>
                    <div className="fixed inset-0 z-10 bg-black/20 sm:bg-transparent" onClick={handleClose} />
                    <div
                        ref={panelRef}
                        className={cn(
                            'fixed inset-x-0 bottom-0 z-20 rounded-t-2xl max-h-[80vh]',
                            'sm:absolute sm:inset-auto sm:left-20 sm:top-1/2 sm:-translate-y-1/2 sm:w-60 sm:rounded-2xl sm:max-h-[75vh]',
                            'bg-background border border-border shadow-lg flex flex-col pointer-events-auto',
                            'animate-in fade-in slide-in-from-bottom-4 sm:slide-in-from-left-2 duration-200'
                        )}
                    >
                        {/* Mobile drag handle */}
                        <div className="flex justify-center pt-2 pb-1 sm:hidden">
                            <div className="w-10 h-1 bg-muted-foreground/30 rounded-full" />
                        </div>

                        {/* Block list */}
                        <div className="overflow-y-auto px-4 pb-2 flex-1">
                            {CATEGORIES.map((category, idx) => {
                                const blocks = blocksByCategory[category];
                                if (!blocks.length) return null;
                                return (
                                    <div key={category} className={idx > 0 ? 'mt-4' : 'mt-3'}>
                                        <p className="text-sm font-semibold text-foreground mb-1">
                                            {CATEGORY_CONFIG[category].label}
                                        </p>
                                        <div className="h-px bg-border mb-1" />
                                        {blocks.map(block => (
                                            <BlockItem
                                                key={block.type}
                                                block={block}
                                                onSelect={() => handleAddNode(block)}
                                                disabled={isLoading}
                                            />
                                        ))}
                                    </div>
                                );
                            })}
                            {Object.values(blocksByCategory).every(arr => arr.length === 0) && (
                                <p className="text-xs text-muted-foreground text-center py-6">블록을 불러오는 중...</p>
                            )}
                        </div>
                    </div>
                </>
            )}
        </>
    );
});

Sidebar.displayName = 'Sidebar';
