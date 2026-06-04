import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { Copy, Download, FileCode } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@flows/ui-kit';

/**
 * BlogExportBar — copy/download actions for a blog-export output.
 *   1. "네이버용 복사" — writes naverHtml to the clipboard as BOTH text/html and
 *      text/plain (ClipboardItem), so pasting into the Naver editor keeps structure.
 *      Falls back to writeText(naverHtml) + toast when the rich write is unavailable.
 *   2. "마크다운 복사" — writeText(markdown).
 *   3. "이미지 ZIP 다운로드" — fetches imageManifest urls and zips them (jszip).
 *      Falls back to opening each url in a new tab + a guidance toast on failure.
 *
 * Deterministic: no random / no current time; the zip filename is fixed.
 */

export interface BlogImageManifestEntry {
    slotId: string;
    url: string;
    caption?: string;
    alt?: string;
}

export interface BlogExportBarProps {
    naverHtml: string;
    markdown: string;
    imageManifest: BlogImageManifestEntry[];
    /** Injected for tests; defaults to a dynamic import of jszip in the browser. */
    loadJsZip?: () => Promise<JsZipLike>;
    className?: string;
}

/** Minimal structural type for the slice of jszip we use. */
export interface JsZipLike {
    file(name: string, data: Blob | ArrayBuffer | Uint8Array): unknown;
    generateAsync(options: { type: 'blob' }): Promise<Blob>;
}

const ZIP_FILENAME = 'blog-images.zip';

const triggerDownload = (href: string, filename: string): void => {
    const link = document.createElement('a');
    link.href = href;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

const fileNameForEntry = (entry: BlogImageManifestEntry, index: number): string => {
    const fromUrl = entry.url.split('?')[0]?.split('/').pop() ?? '';
    const hasExt = /\.[a-z0-9]{2,4}$/i.test(fromUrl);
    const base = entry.slotId || `image-${index + 1}`;
    return hasExt ? `${base}-${fromUrl}` : `${base}.png`;
};

export const BlogExportBar: React.FC<BlogExportBarProps> = ({
    naverHtml,
    markdown,
    imageManifest,
    loadJsZip,
    className,
}) => {
    const { t } = useTranslation(['nodes']);

    const handleCopyNaver = useCallback(async () => {
        // Prefer rich copy: text/html + text/plain so the Naver editor keeps structure.
        try {
            if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
                const item = new ClipboardItem({
                    'text/html': new Blob([naverHtml], { type: 'text/html' }),
                    'text/plain': new Blob([naverHtml], { type: 'text/plain' }),
                });
                await navigator.clipboard.write([item]);
                toast.success(t('blog.export.naverCopied'));
                return;
            }
            throw new Error('ClipboardItem unavailable');
        } catch {
            try {
                await navigator.clipboard.writeText(naverHtml);
                toast.success(t('blog.export.naverCopiedPlain'));
            } catch {
                toast.error(t('blog.export.copyFailed'));
            }
        }
    }, [naverHtml, t]);

    const handleCopyMarkdown = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(markdown);
            toast.success(t('blog.export.markdownCopied'));
        } catch {
            toast.error(t('blog.export.copyFailed'));
        }
    }, [markdown, t]);

    const handleDownloadZip = useCallback(async () => {
        const entries = imageManifest.filter(entry => entry.url && entry.url.trim().length > 0);
        if (entries.length === 0) {
            toast.error(t('blog.export.noImages'));
            return;
        }

        try {
            const importJsZip =
                loadJsZip ??
                (async () => {
                    const mod = (await import('jszip')) as { default: new () => JsZipLike };
                    return new mod.default();
                });
            const zip = await importJsZip();
            const blobs = await Promise.all(
                entries.map(async entry => {
                    const response = await fetch(entry.url);
                    if (!response.ok) throw new Error(`fetch failed: ${entry.url}`);
                    return response.blob();
                })
            );
            entries.forEach((entry, index) => {
                zip.file(fileNameForEntry(entry, index), blobs[index]);
            });
            const archive = await zip.generateAsync({ type: 'blob' });
            const objectUrl = URL.createObjectURL(archive);
            triggerDownload(objectUrl, ZIP_FILENAME);
            URL.revokeObjectURL(objectUrl);
            toast.success(t('blog.export.zipReady'));
        } catch {
            // Fallback: open each image so the user can save them manually.
            entries.forEach((entry, index) => triggerDownload(entry.url, fileNameForEntry(entry, index)));
            toast.message(t('blog.export.zipFallback'));
        }
    }, [imageManifest, loadJsZip, t]);

    return (
        <div className={['flex flex-wrap items-center gap-2', className].filter(Boolean).join(' ')}>
            <Button type="button" size="sm" variant="default" className="h-8 gap-1.5 text-xs" onClick={handleCopyNaver}>
                <Copy className="h-3.5 w-3.5" />
                {t('blog.export.copyNaver')}
            </Button>
            <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 text-xs"
                onClick={handleCopyMarkdown}
            >
                <FileCode className="h-3.5 w-3.5" />
                {t('blog.export.copyMarkdown')}
            </Button>
            <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 text-xs"
                onClick={handleDownloadZip}
            >
                <Download className="h-3.5 w-3.5" />
                {t('blog.export.downloadZip')}
            </Button>
        </div>
    );
};

export default BlogExportBar;
