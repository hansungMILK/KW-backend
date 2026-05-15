import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Code2, FileImage, FileText, FileVideo, Music, Type, X } from 'lucide-react';
import { toast } from 'sonner';

import { downloadImage, useS3Image } from '@flows/flows';
import { cn } from '@flows/lib/utils';
import {
    Button,
    Dialog,
    DialogClose,
    DialogContent,
    DialogHeader,
    DialogTitle,
    JsonViewer,
    MarkdownViewer,
    ScrollArea,
    isMarkdownContent,
} from '@flows/ui-kit';

import { tryParseJson } from '../utils';
import { S3Image } from './S3Image';

type ContentType = 'image' | 'image-gallery' | 'script' | 'video' | 'audio' | 'json' | 'markdown' | 'text';

/** Props for ContentPreviewModal */
export interface ContentPreviewModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    content: { value: unknown; type?: string } | null;
}

/** Get icon for content type */
const getContentTypeIcon = (type: ContentType): React.ReactNode => {
    const iconClass = 'w-4 h-4';
    switch (type) {
        case 'image':
        case 'image-gallery':
            return <FileImage className={iconClass} />;
        case 'script':
            return <FileText className={iconClass} />;
        case 'video':
            return <FileVideo className={iconClass} />;
        case 'audio':
            return <Music className={iconClass} />;
        case 'json':
            return <Code2 className={iconClass} />;
        case 'markdown':
            return <FileText className={iconClass} />;
        case 'text':
        default:
            return <Type className={iconClass} />;
    }
};

/** Detect content type from value and explicit type */
const detectContentType = (value: unknown, explicitType?: string): ContentType => {
    if (explicitType === 'image') return 'image';
    if (explicitType === 'image-gallery') return 'image-gallery';
    if (explicitType === 'script') return 'script';
    if (explicitType === 'video') return 'video';
    if (explicitType === 'audio') return 'audio';
    const stringValue = typeof value === 'string' ? value : '';
    if (stringValue.startsWith('data:video/') || /\.(mp4|mov|webm)(?:$|[?#])/i.test(stringValue)) return 'video';
    if (stringValue.startsWith('data:audio/') || /\.(mp3|wav|m4a|aac|ogg)(?:$|[?#])/i.test(stringValue)) {
        return 'audio';
    }
    if (explicitType === 'json' || (value !== null && typeof value === 'object')) return 'json';
    if (tryParseJson(value)) return 'json';
    if (explicitType === 'markdown' || isMarkdownContent(value)) return 'markdown';
    return 'text';
};

const isRecordValue = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const asRecordArray = (value: unknown): Record<string, unknown>[] =>
    Array.isArray(value) ? value.filter(isRecordValue) : [];

const asStringValue = (value: unknown): string | undefined =>
    typeof value === 'string' && value.trim() ? value : undefined;

const firstStringValue = (...values: unknown[]): string | undefined => {
    for (const value of values) {
        const stringValue = asStringValue(value);
        if (stringValue) return stringValue;
    }
    return undefined;
};

const getUrlFromRecord = (value: unknown): string | undefined => {
    if (!isRecordValue(value)) return undefined;
    return firstStringValue(value.url, value.publicUrl, value.data);
};

/** Copy image to clipboard using canvas (handles CORS and format issues) */
const copyImageToClipboard = async (imgElement: HTMLImageElement): Promise<void> => {
    const canvas = document.createElement('canvas');
    canvas.width = imgElement.naturalWidth;
    canvas.height = imgElement.naturalHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get canvas context');

    ctx.drawImage(imgElement, 0, 0);

    return new Promise((resolve, reject) => {
        canvas.toBlob(async blob => {
            if (!blob) {
                reject(new Error('Failed to create blob'));
                return;
            }

            try {
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                resolve();
            } catch (err) {
                reject(err);
            }
        }, 'image/png');
    });
};

/** Image preview with download support */
const ImagePreview: React.FC<{ src: string }> = ({ src }) => {
    const { t } = useTranslation(['nodes']);
    const { src: resolvedSrc, isLoading, error } = useS3Image(src);
    const [dims, setDims] = useState<string | null>(null);
    const imgRef = useRef<HTMLImageElement>(null);

    const handleDownload = useCallback(() => {
        if (resolvedSrc) {
            downloadImage(resolvedSrc, `preview-${Date.now()}.png`);
            toast.success(t('preview.downloadStarted'));
        }
    }, [resolvedSrc, t]);

    const handleCopyToClipboard = useCallback(async () => {
        if (!imgRef.current) return;

        try {
            await copyImageToClipboard(imgRef.current);
            toast.success(t('preview.imageCopied'));
        } catch {
            // Fallback: copy the URL instead
            try {
                await navigator.clipboard.writeText(src);
                toast.success(t('preview.urlCopied'));
            } catch {
                toast.error(t('preview.copyFailed'));
            }
        }
    }, [src, t]);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    if (error || !resolvedSrc) {
        return (
            <div className="flex items-center justify-center h-64 text-destructive">{t('visualization.noImage')}</div>
        );
    }

    return (
        <div className="flex flex-col gap-4">
            <div className="flex justify-center bg-black/20 rounded-lg p-4">
                <img
                    ref={imgRef}
                    src={resolvedSrc}
                    alt="Preview"
                    className="max-w-full max-h-[60vh] object-contain rounded"
                    onLoad={e => setDims(`${e.currentTarget.naturalWidth}×${e.currentTarget.naturalHeight}`)}
                />
            </div>
            <div className="flex items-center justify-between">
                {dims && <span className="text-xs text-muted-foreground font-mono">{dims}</span>}
                <ImageActions onCopy={handleCopyToClipboard} onDownload={handleDownload} />
            </div>
        </div>
    );
};

/** Image action buttons */
const ImageActions: React.FC<{ onCopy: () => void; onDownload: () => void }> = ({ onCopy, onDownload }) => {
    const { t } = useTranslation(['nodes']);

    return (
        <div className="flex gap-1 ml-auto">
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={onCopy}>
                {t('preview.copy')}
            </Button>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={onDownload}>
                {t('preview.download')}
            </Button>
        </div>
    );
};

const ImageGalleryPreview: React.FC<{ value: unknown }> = ({ value }) => {
    const recordValue = isRecordValue(value) ? value : {};
    const images = asRecordArray(recordValue.images);

    return (
        <div className="space-y-5">
            <div className="flex items-end justify-between gap-4 border-b border-border pb-4">
                <div>
                    <div className="text-xl font-semibold text-foreground">이미지 갤러리</div>
                    <div className="mt-1 text-sm text-muted-foreground">
                        장면 이미지 {images.length}장을 액자형으로 확인합니다.
                    </div>
                </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {images.map((image, index) => {
                    const url = getUrlFromRecord(image);
                    const caption = firstStringValue(image.caption, image.narration, image.visualText, image.topTitle);
                    const sceneNumber = firstStringValue(image.sceneNumber, image.scene) ?? String(index + 1);

                    return (
                        <figure
                            key={`${url ?? 'image'}-${index}`}
                            className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm"
                        >
                            <div className="aspect-[9/16] bg-black/80">
                                {url ? (
                                    <S3Image
                                        src={url}
                                        alt={`Scene ${index + 1}`}
                                        className="h-full w-full object-cover"
                                    />
                                ) : (
                                    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                                        이미지 없음
                                    </div>
                                )}
                            </div>
                            <figcaption className="space-y-1 p-3">
                                <div className="text-xs font-semibold text-sky-600">장면 {sceneNumber}</div>
                                {caption && (
                                    <div className="line-clamp-3 text-sm leading-relaxed text-foreground">
                                        {caption}
                                    </div>
                                )}
                            </figcaption>
                        </figure>
                    );
                })}
            </div>
        </div>
    );
};

const ScriptPreview: React.FC<{ value: unknown }> = ({ value }) => {
    const recordValue = isRecordValue(value) ? value : {};
    const script = isRecordValue(recordValue.script) ? recordValue.script : {};
    const scenes = asRecordArray(recordValue.scenes);
    const title = firstStringValue(recordValue.title, script.hook, recordValue.hook) ?? '생성된 대본';
    const hook = firstStringValue(recordValue.hook, script.hook);
    const angle = firstStringValue(script.angle, recordValue.angle);
    const cta = firstStringValue(script.cta, recordValue.cta);
    const bodyText = [
        title,
        hook,
        angle,
        ...scenes.map(scene => firstStringValue(scene.narration, scene.caption, scene.visualText)).filter(Boolean),
        cta,
    ]
        .filter(Boolean)
        .join('\n\n');

    return (
        <article className="mx-auto max-w-3xl">
            <div className="border-b border-border pb-5">
                <div className="text-sm font-semibold text-amber-600">대본 문서</div>
                <h2 className="mt-2 text-2xl font-bold leading-tight text-foreground">{title}</h2>
                {hook && <p className="mt-3 text-base leading-relaxed text-foreground/80">{hook}</p>}
                {angle && <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{angle}</p>}
            </div>
            <div className="mt-5 space-y-4">
                {scenes.map((scene, index) => {
                    const narration = firstStringValue(scene.narration, scene.caption, scene.visualText);
                    if (!narration) return null;
                    return (
                        <section
                            key={`${index}-${narration}`}
                            className="grid gap-3 border-b border-border/70 pb-4 sm:grid-cols-[72px_1fr]"
                        >
                            <div className="text-xs font-semibold uppercase tracking-wide text-amber-600">
                                Scene {index + 1}
                            </div>
                            <p className="text-base leading-8 text-foreground">{narration}</p>
                        </section>
                    );
                })}
            </div>
            {cta && (
                <div className="mt-5 rounded-xl bg-amber-500/10 px-4 py-3 text-sm font-medium leading-relaxed text-foreground">
                    마무리: {cta}
                </div>
            )}
            <div className="mt-5 flex justify-end">
                <CopyButton value={bodyText} />
            </div>
        </article>
    );
};

const VideoPreview: React.FC<{ src: string }> = ({ src }) => (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_220px]">
        <div className="flex justify-center rounded-2xl bg-black p-5 shadow-inner">
            <video
                src={src}
                controls
                className="aspect-[9/16] max-h-[72vh] max-w-full rounded-xl bg-black object-contain"
            />
        </div>
        <div className="flex flex-col justify-between rounded-2xl border border-border bg-muted/20 p-4">
            <div>
                <div className="text-sm font-semibold text-foreground">최종 영상</div>
                <div className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    완성된 MP4를 크게 확인하고 바로 다운로드할 수 있습니다.
                </div>
            </div>
            <div className="mt-4 flex flex-col gap-2">
                <Button variant="outline" size="sm" asChild className="h-8 gap-1.5 text-xs">
                    <a href={src} target="_blank" rel="noreferrer">
                        열기
                    </a>
                </Button>
                <Button variant="outline" size="sm" asChild className="h-8 gap-1.5 text-xs">
                    <a href={src} download>
                        MP4 다운로드
                    </a>
                </Button>
            </div>
        </div>
    </div>
);

const AudioPreview: React.FC<{ src: string }> = ({ src }) => (
    <div className="rounded-xl border border-border bg-muted/10 p-6">
        <div className="text-sm font-semibold text-foreground">나레이션 음성</div>
        <audio src={src} controls className="mt-4 w-full" />
        <div className="mt-4 flex justify-end">
            <Button variant="outline" size="sm" asChild className="h-8 gap-1.5 text-xs">
                <a href={src} download>
                    다운로드
                </a>
            </Button>
        </div>
    </div>
);

/** Text/JSON copy button */
const CopyButton: React.FC<{ value: string }> = ({ value }) => {
    const { t } = useTranslation(['nodes']);

    const handleCopy = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(value);
            toast.success(t('preview.copied'));
        } catch {
            toast.error(t('preview.copyFailed'));
        }
    }, [value, t]);

    return (
        <Button variant="outline" size="sm" onClick={handleCopy} className="h-8 gap-1.5 text-xs">
            {t('preview.copy')}
        </Button>
    );
};

export const ContentPreviewModal: React.FC<ContentPreviewModalProps> = ({ open, onOpenChange, content }) => {
    const { t } = useTranslation(['nodes']);

    // Derive content type from props (no useState needed)
    const contentType = useMemo(() => (content ? detectContentType(content.value, content.type) : 'text'), [content]);

    // Get localized content type label
    const contentTypeLabel = useMemo(() => {
        switch (contentType) {
            case 'image':
                return t('preview.types.image');
            case 'image-gallery':
                return '이미지 갤러리';
            case 'script':
                return '대본';
            case 'video':
                return '영상';
            case 'audio':
                return '음성';
            case 'json':
                return t('preview.types.json');
            case 'markdown':
                return t('preview.types.markdown');
            case 'text':
            default:
                return t('preview.types.text');
        }
    }, [contentType, t]);

    if (!content) return null;

    const renderContent = () => {
        switch (contentType) {
            case 'image':
                return <ImagePreview src={String(content.value)} />;

            case 'image-gallery':
                return <ImageGalleryPreview value={content.value} />;

            case 'script':
                return <ScriptPreview value={content.value} />;

            case 'video':
                return <VideoPreview src={String(content.value)} />;

            case 'audio':
                return <AudioPreview src={String(content.value)} />;

            case 'json': {
                const jsonData = tryParseJson(content.value) ?? content.value;
                return (
                    <div className="relative">
                        <div className="absolute top-2 right-2 z-10">
                            <CopyButton value={JSON.stringify(jsonData, null, 2)} />
                        </div>
                        <div className="p-4" onWheel={e => e.stopPropagation()}>
                            <JsonViewer data={jsonData} collapsed={false} />
                        </div>
                    </div>
                );
            }

            case 'markdown':
                return (
                    <div className="relative">
                        <div className="absolute top-2 right-2 z-10">
                            <CopyButton value={String(content.value)} />
                        </div>
                        <div className="p-4" onWheel={e => e.stopPropagation()}>
                            <MarkdownViewer content={String(content.value)} />
                        </div>
                    </div>
                );

            case 'text':
            default:
                return (
                    <div className="relative">
                        <div className="absolute top-2 right-2 z-10">
                            <CopyButton value={String(content.value)} />
                        </div>
                        <div className="p-4 font-mono text-sm whitespace-pre-wrap break-words">
                            {String(content.value)}
                        </div>
                    </div>
                );
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className={cn(
                    'max-w-6xl max-h-[88vh] p-0 gap-0',
                    'bg-background shadow-2xl',
                    '[&>button]:hidden' // Hide default close button
                )}
            >
                {/* Header with content type and close button */}
                <DialogHeader className="flex flex-row items-center justify-between p-4 border-b border-border space-y-0">
                    <DialogTitle className="flex items-center gap-2 text-sm font-medium">
                        {getContentTypeIcon(contentType)}
                        <span>{contentTypeLabel}</span>
                    </DialogTitle>
                    <DialogClose asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-muted">
                            <X className="w-4 h-4" />
                            <span className="sr-only">{t('preview.close')}</span>
                        </Button>
                    </DialogClose>
                </DialogHeader>
                {/* Content */}
                <ScrollArea className="max-h-[calc(88vh-64px)] p-5">{renderContent()}</ScrollArea>
            </DialogContent>
        </Dialog>
    );
};
