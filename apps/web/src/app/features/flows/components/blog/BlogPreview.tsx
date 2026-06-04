import React from 'react';

/**
 * BlogPreview — renders a blog document the way Naver blog shows it:
 * title, hero image, H2/H3 sub-headings, paragraphs, inline images + captions,
 * highlight boxes. Reads-only / deterministic: no random, no current time.
 *
 * Two input shapes are accepted (the two blog nodes carry disjoint data):
 *   - previewModel ({ title, blocks[] }) from blog-assemble.
 *   - naverHtml (string, body order preserved) from blog-export — rendered as-is.
 *
 * Intentionally dependency-light (plain React + Tailwind classes, plain <img>)
 * so it renders cleanly under renderToStaticMarkup for the visual-check demo and
 * is trivial to unit test. All i18n / toasts live in BlogExportBar, not here.
 */

export type BlogPreviewBlockKind = 'title' | 'image' | 'heading' | 'paragraph' | 'highlight';

export interface BlogPreviewBlock {
    kind: BlogPreviewBlockKind;
    level?: 2 | 3;
    text?: string;
    imageUrl?: string;
    caption?: string;
    alt?: string;
    slotId?: string;
}

export interface BlogPreviewModel {
    title: string;
    blocks: BlogPreviewBlock[];
}

export interface BlogPreviewProps {
    /** Structured preview model from blog-assemble. Takes precedence over naverHtml. */
    previewModel?: BlogPreviewModel | null;
    /** Pre-rendered, backend-escaped body HTML from blog-export (fallback source). */
    naverHtml?: string | null;
    className?: string;
}

const figureFrom = (block: BlogPreviewBlock, key: React.Key): React.ReactNode => {
    // No usable image url -> render nothing (keeps a text-only flow natural).
    if (!block.imageUrl) return null;
    return (
        <figure key={key} className="my-5">
            <img
                src={block.imageUrl}
                alt={block.alt ?? ''}
                className="mx-auto block max-h-[520px] w-full rounded-lg object-cover"
            />
            {block.caption ? (
                <figcaption className="mt-2 text-center text-[13px] leading-relaxed text-neutral-500">
                    {block.caption}
                </figcaption>
            ) : null}
        </figure>
    );
};

const BlocksRenderer: React.FC<{ blocks: BlogPreviewBlock[] }> = ({ blocks }) => (
    <>
        {blocks.map((block, index) => {
            const key = block.slotId ?? `${block.kind}-${index}`;
            switch (block.kind) {
                case 'title':
                    return (
                        <h1
                            key={key}
                            className="mb-6 text-[28px] font-bold leading-snug tracking-tight text-neutral-900"
                        >
                            {block.text}
                        </h1>
                    );
                case 'image':
                    return figureFrom(block, key);
                case 'heading':
                    return block.level === 3 ? (
                        <h3 key={key} className="mb-3 mt-7 text-[19px] font-semibold leading-snug text-neutral-900">
                            {block.text}
                        </h3>
                    ) : (
                        <h2
                            key={key}
                            className="mb-3 mt-9 border-l-4 border-emerald-500 pl-3 text-[22px] font-bold leading-snug text-neutral-900"
                        >
                            {block.text}
                        </h2>
                    );
                case 'paragraph':
                    return (
                        <p key={key} className="mb-4 text-[16px] leading-[1.9] text-neutral-800">
                            {block.text}
                        </p>
                    );
                case 'highlight':
                    return (
                        <aside
                            key={key}
                            className="my-6 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-[15px] leading-[1.8] text-emerald-900"
                        >
                            {block.text}
                        </aside>
                    );
                default:
                    return null;
            }
        })}
    </>
);

export const BlogPreview: React.FC<BlogPreviewProps> = ({ previewModel, naverHtml, className }) => {
    const wrapperClass = ['mx-auto max-w-[680px] bg-white px-6 py-8 text-left', className].filter(Boolean).join(' ');

    if (previewModel && previewModel.blocks.length > 0) {
        return (
            <article className={wrapperClass} data-testid="blog-preview">
                <BlocksRenderer blocks={previewModel.blocks} />
            </article>
        );
    }

    if (naverHtml && naverHtml.trim().length > 0) {
        // naverHtml is assembled by the backend with escapeHtml on every text node,
        // so the only tags present are the structural ones blog-export emits.
        return (
            <article
                className={`${wrapperClass} blog-preview-html`}
                data-testid="blog-preview"
                dangerouslySetInnerHTML={{ __html: naverHtml }}
            />
        );
    }

    return null;
};

export default BlogPreview;
