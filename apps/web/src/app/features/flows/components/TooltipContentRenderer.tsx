import React from 'react';

import { JsonViewer, MarkdownViewer, isMarkdownContent } from '@flows/ui-kit';

import { TooltipImage } from './TooltipImage';
import { tryParseJson } from '../utils';

export interface TooltipContentRendererProps {
    content: unknown;
    type: string;
    maxHeight?: number;
    collapsed?: number;
    textLimit?: number;
    /** Custom className for MarkdownViewer */
    markdownClassName?: string;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const firstString = (...values: unknown[]): string | undefined => {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
};

const hasLongformFriendlyShape = (value: unknown): value is Record<string, unknown> => {
    const record = asRecord(value);
    if (!record) return false;
    return Boolean(
        firstString(record.fullScriptDraft, record.renderer, record.rendererRoute, record.resolution) ||
            Array.isArray(record.sourceDigest) ||
            Array.isArray(record.sections) ||
            Array.isArray(record.visualChapters) ||
            Array.isArray(record.scenes)
    );
};

const LongformTooltipSummary = ({ value }: { value: Record<string, unknown> }) => {
    const sourceCount = Array.isArray(value.sourceDigest) ? value.sourceDigest.length : 0;
    const sectionCount = Array.isArray(value.sections) ? value.sections.length : 0;
    const sceneCount = Array.isArray(value.scenes) ? value.scenes.length : 0;
    const renderer = firstString(value.renderer, value.rendererRoute);
    const resolution = firstString(value.resolution);
    const script = firstString(value.fullScriptDraft);

    return (
        <div className="min-w-[180px] max-w-[400px] text-[10px] text-foreground">
            <div className="font-semibold text-sky-200">롱폼 제작 기획안</div>
            <div className="mt-1 text-muted-foreground">
                {renderer ?? 'renderer 준비 중'}
                {resolution ? ` · ${resolution}` : ''}
                {sceneCount > 0 ? ` · 장면 ${sceneCount}개` : ''}
            </div>
            <div className="mt-1 text-muted-foreground">
                자료 {sourceCount}개 · 섹션 {sectionCount}개 · 검수 대기
            </div>
            {script ? <div className="mt-1 line-clamp-3 whitespace-pre-wrap">{script}</div> : null}
        </div>
    );
};

/**
 * Renders tooltip content based on type (image, json, markdown, text).
 * Single source of truth for content type rendering in tooltips.
 */
export const TooltipContentRenderer: React.FC<TooltipContentRendererProps> = ({
    content,
    type,
    maxHeight = 120,
    collapsed = 2,
    textLimit = 150,
    markdownClassName = 'text-xs [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-xs [&_p]:text-xs [&_code]:text-[10px]',
}) => {
    // Image type
    if (type === 'image') {
        return <TooltipImage src={content as string} altText="Preview" />;
    }

    // JSON/object type
    if (type === 'json' || (content !== null && typeof content === 'object')) {
        if (hasLongformFriendlyShape(content)) {
            return <LongformTooltipSummary value={content} />;
        }
        return (
            <div className="min-w-[100px] max-w-[400px]">
                <JsonViewer data={content} maxHeight={maxHeight} collapsed={collapsed} />
            </div>
        );
    }

    // String content
    const strValue = String(content ?? '');

    // Try to parse JSON string
    const parsedJson = tryParseJson(strValue);
    if (parsedJson) {
        if (hasLongformFriendlyShape(parsedJson)) {
            return <LongformTooltipSummary value={parsedJson} />;
        }
        return (
            <div className="min-w-[100px] max-w-[400px]">
                <JsonViewer data={parsedJson} maxHeight={maxHeight} collapsed={collapsed} />
            </div>
        );
    }

    // Check for markdown
    if (type === 'markdown' || isMarkdownContent(strValue)) {
        return (
            <div className="min-w-[100px] max-w-[400px]">
                <MarkdownViewer
                    content={strValue.slice(0, textLimit * 3)}
                    maxHeight={maxHeight}
                    className={markdownClassName}
                />
            </div>
        );
    }

    // Plain text
    return (
        <div className="text-xs text-foreground min-w-[100px] max-w-[400px] break-all whitespace-pre-wrap">
            {strValue.slice(0, textLimit)}
            {strValue.length > textLimit && <span className="text-muted-foreground">...</span>}
        </div>
    );
};
