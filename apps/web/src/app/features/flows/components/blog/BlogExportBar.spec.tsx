import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BlogExportBar } from './BlogExportBar';

import type { JsZipLike } from './BlogExportBar';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastMessage = vi.fn();
vi.mock('sonner', () => ({
    toast: {
        success: (...args: unknown[]) => toastSuccess(...args),
        error: (...args: unknown[]) => toastError(...args),
        message: (...args: unknown[]) => toastMessage(...args),
    },
}));

vi.mock('@flows/ui-kit', () => ({
    Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
        <button {...props}>{children}</button>
    ),
}));

const naverHtml = '<h1>제목</h1>\n<p>문단</p>';
const markdown = '# 제목\n\n문단';
const imageManifest = [
    { slotId: 'hero', url: 'https://img.example/hero.jpg', caption: 'c', alt: 'a' },
    { slotId: 's1', url: 'https://img.example/inline.png', caption: '', alt: '' },
];

// Capture what ClipboardItem was constructed with so we can assert both MIME types.
class FakeClipboardItem {
    public readonly items: Record<string, Blob>;
    constructor(items: Record<string, Blob>) {
        this.items = items;
    }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('BlogExportBar', () => {
    let clipboardWrite: ReturnType<typeof vi.fn>;
    let clipboardWriteText: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        toastSuccess.mockClear();
        toastError.mockClear();
        toastMessage.mockClear();
        clipboardWrite = vi.fn().mockResolvedValue(undefined);
        clipboardWriteText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('ClipboardItem', FakeClipboardItem as unknown as typeof ClipboardItem);
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { write: clipboardWrite, writeText: clipboardWriteText },
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('copies naverHtml as BOTH text/html and text/plain via ClipboardItem', async () => {
        render(<BlogExportBar naverHtml={naverHtml} markdown={markdown} imageManifest={imageManifest} />);

        fireEvent.click(screen.getByText('blog.export.copyNaver'));
        await flush();

        expect(clipboardWrite).toHaveBeenCalledTimes(1);
        const [items] = clipboardWrite.mock.calls[0] as [FakeClipboardItem[]];
        const written = items[0] as unknown as FakeClipboardItem;
        const mimeTypes = Object.keys(written.items);
        expect(mimeTypes).toContain('text/html');
        expect(mimeTypes).toContain('text/plain');
        expect(written.items['text/html'].type).toBe('text/html');
        expect(written.items['text/plain'].type).toBe('text/plain');
        expect(toastSuccess).toHaveBeenCalledWith('blog.export.naverCopied');
    });

    it('falls back to writeText when ClipboardItem is unavailable', async () => {
        vi.stubGlobal('ClipboardItem', undefined as unknown as typeof ClipboardItem);
        render(<BlogExportBar naverHtml={naverHtml} markdown={markdown} imageManifest={imageManifest} />);

        fireEvent.click(screen.getByText('blog.export.copyNaver'));
        await flush();

        expect(clipboardWrite).not.toHaveBeenCalled();
        expect(clipboardWriteText).toHaveBeenCalledWith(naverHtml);
        expect(toastSuccess).toHaveBeenCalledWith('blog.export.naverCopiedPlain');
    });

    it('copies markdown via writeText', async () => {
        render(<BlogExportBar naverHtml={naverHtml} markdown={markdown} imageManifest={imageManifest} />);

        fireEvent.click(screen.getByText('blog.export.copyMarkdown'));
        await flush();

        expect(clipboardWriteText).toHaveBeenCalledWith(markdown);
        expect(toastSuccess).toHaveBeenCalledWith('blog.export.markdownCopied');
    });

    it('zips fetched images and triggers a download', async () => {
        const fileSpy = vi.fn();
        const generateAsync = vi.fn().mockResolvedValue(new Blob(['zip'], { type: 'application/zip' }));
        const loadJsZip = vi.fn(async (): Promise<JsZipLike> => ({ file: fileSpy, generateAsync }));

        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['img']) }) as unknown as typeof fetch
        );
        const createObjectURL = vi.fn().mockReturnValue('blob:zip');
        const revokeObjectURL = vi.fn();
        Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
        Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
        // jsdom logs "Not implemented: navigation" on a real anchor click; stub it.
        const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

        render(
            <BlogExportBar
                naverHtml={naverHtml}
                markdown={markdown}
                imageManifest={imageManifest}
                loadJsZip={loadJsZip}
            />
        );

        fireEvent.click(screen.getByText('blog.export.downloadZip'));
        await flush();

        expect(loadJsZip).toHaveBeenCalledTimes(1);
        expect(fileSpy).toHaveBeenCalledTimes(2);
        expect(generateAsync).toHaveBeenCalledWith({ type: 'blob' });
        expect(createObjectURL).toHaveBeenCalledTimes(1);
        expect(clickSpy).toHaveBeenCalledTimes(1);
        expect(toastSuccess).toHaveBeenCalledWith('blog.export.zipReady');
    });

    it('shows an error when there are no image urls to zip', async () => {
        render(<BlogExportBar naverHtml={naverHtml} markdown={markdown} imageManifest={[]} />);

        fireEvent.click(screen.getByText('blog.export.downloadZip'));
        await flush();

        expect(toastError).toHaveBeenCalledWith('blog.export.noImages');
    });
});
