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

const firstNumber = (...values: unknown[]): number | undefined => {
    for (const value of values) {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
    }
    return undefined;
};

const asRecordArray = (value: unknown): Record<string, unknown>[] =>
    Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(asRecord(item))) : [];

const getUrlFromRecord = (value: unknown): string | undefined => {
    const record = asRecord(value);
    if (!record) return undefined;
    return firstString(record.url, record.publicUrl, record.data, record.previewUrl, record.downloadUrl);
};

const looksLikeVideoUrl = (value: string | undefined): boolean =>
    Boolean(value && (value.startsWith('data:video/') || /\.(mp4|mov|webm)(?:$|[?#])/i.test(value)));

const isVideoRecord = (value: unknown): value is Record<string, unknown> => {
    const record = asRecord(value);
    if (!record) return false;
    const mimeType = firstString(record.mimeType, record.contentType)?.toLowerCase();
    const assetType = firstString(record.type, record.assetType, record.kind)?.toLowerCase();
    const format = firstString(record.format, record.extension)?.toLowerCase();
    const url = getUrlFromRecord(record);
    return (
        assetType === 'video' ||
        mimeType?.startsWith('video/') === true ||
        format === 'mp4' ||
        format === 'mov' ||
        format === 'webm' ||
        looksLikeVideoUrl(url)
    );
};

const getVideoRecord = (value: Record<string, unknown>): Record<string, unknown> | undefined => {
    if (isVideoRecord(value.video)) return value.video;
    const artifactVideo = asRecordArray(value.artifacts).find(isVideoRecord);
    if (artifactVideo) return artifactVideo;
    return isVideoRecord(value) ? value : undefined;
};

const BLOG_MODES = [
    'blog-brief',
    'blog-research',
    'blog-outline',
    'blog-draft',
    'blog-image-plan',
    'blog-images',
    'blog-seo',
    'blog-assemble',
    'blog-export',
];

// Route blog outputs by the explicit `mode` discriminant (not sections-shape),
// so intermediate blog modes are not hijacked by the longform tooltip (RC2).
const isBlogShape = (value: unknown): value is Record<string, unknown> => {
    const record = asRecord(value);
    if (!record) return false;
    const mode = firstString(record.mode);
    return mode !== undefined && BLOG_MODES.includes(mode);
};

const BLOG_MODE_LABELS: Record<string, string> = {
    'blog-brief': '블로그 브리프',
    'blog-research': '근거 자료 수집',
    'blog-outline': '블로그 목차',
    'blog-draft': '블로그 본문 초안',
    'blog-image-plan': '이미지 배치 계획',
    'blog-images': '블로그 이미지 생성',
    'blog-seo': 'SEO 메타데이터',
    'blog-assemble': '블로그 조립',
    'blog-export': '블로그 내보내기',
};

const BlogTooltipSummary = ({ value }: { value: Record<string, unknown> }) => {
    const mode = firstString(value.mode) ?? '';
    const label = BLOG_MODE_LABELS[mode] ?? '블로그';
    const title = firstString(value.title, value.topic);
    const sectionCount = Array.isArray(value.sections) ? value.sections.length : 0;
    const slotCount = Array.isArray(value.imageSlots) ? value.imageSlots.length : 0;
    return (
        <div className="min-w-[180px] max-w-[320px] text-[10px] text-foreground">
            <div className="font-semibold text-emerald-300">{label}</div>
            {title ? <div className="mt-1 line-clamp-2 text-foreground">{title}</div> : null}
            {(sectionCount > 0 || slotCount > 0) && (
                <div className="mt-1 text-muted-foreground">
                    {sectionCount > 0 ? `섹션 ${sectionCount}개` : ''}
                    {sectionCount > 0 && slotCount > 0 ? ' · ' : ''}
                    {slotCount > 0 ? `이미지 ${slotCount}장` : ''}
                </div>
            )}
        </div>
    );
};

const hasLongformFriendlyShape = (value: unknown): value is Record<string, unknown> => {
    const record = asRecord(value);
    if (!record) return false;
    return Boolean(
        getVideoRecord(record) ||
            asRecordArray(record.images).length > 0 ||
            firstString(record.fullScriptDraft, record.renderer, record.rendererRoute, record.resolution) ||
            Array.isArray(record.sourceDigest) ||
            Array.isArray(record.sections) ||
            Array.isArray(record.visualChapters) ||
            Array.isArray(record.scenes)
    );
};

const LongformTooltipSummary = ({ value }: { value: Record<string, unknown> }) => {
    const video = getVideoRecord(value);
    if (video) {
        const durationSec = firstNumber(video.durationSec, asRecord(video.metadata)?.durationSec, value.durationSec);
        return (
            <div className="min-w-[180px] max-w-[320px] text-[10px] text-foreground">
                <div className="font-semibold text-foreground">최종 영상</div>
                <div className="mt-1 text-muted-foreground">
                    MP4 생성됨{durationSec !== undefined ? ` · 약 ${Math.round(durationSec)}초` : ''}
                </div>
                <div className="mt-1 line-clamp-1 text-primary">미리보기/다운로드 가능</div>
            </div>
        );
    }

    const images = asRecordArray(value.images);
    if (images.length > 0) {
        return (
            <div className="min-w-[180px] max-w-[320px] text-[10px] text-foreground">
                <div className="font-semibold text-foreground">이미지 결과</div>
                <div className="mt-1 text-muted-foreground">장면 이미지 {images.length}장</div>
            </div>
        );
    }

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
        if (isBlogShape(content)) {
            return <BlogTooltipSummary value={content} />;
        }
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
        if (isBlogShape(parsedJson)) {
            return <BlogTooltipSummary value={parsedJson} />;
        }
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
