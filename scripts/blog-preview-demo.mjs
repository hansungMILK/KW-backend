/* eslint-disable */
/**
 * Visual-check demo generator (not part of the app build).
 *
 * Produces two self-contained HTML files for manual screenshot review:
 *   - out/blog-preview-demo.html  — BlogPreview rendered (renderToStaticMarkup) from a
 *     fixed sample previewModel (4 sections + 2 image slots + highlight box).
 *   - out/naver-html-demo.html    — blog-export buildNaverHtml output for the same doc.
 *
 * Deterministic: the sample document is a fixed literal; no random / no current time
 * is used in the rendered output. Run with:  node scripts/blog-preview-demo.mjs
 *
 * Strategy: esbuild bundles a tiny TS entry (which imports the react-only BlogPreview
 * and the backend blogExportBlock) to a temp ESM file, then we import + execute it.
 */
import { build } from 'esbuild';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const outDir = resolve(repoRoot, 'out');
const tmpEntry = resolve(repoRoot, 'out', '.blog-demo-entry.mjs');

const ENTRY_SOURCE = `
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BlogPreview } from '${resolve(
    repoRoot,
    'apps/web/src/app/features/flows/components/blog/BlogPreview.tsx'
).replace(/\\\\/g, '/')}';
import { blogExportBlock } from '${resolve(
    repoRoot,
    'apps/backend/src/modules/blocks/blog/blog-export-block.ts'
).replace(/\\\\/g, '/')}';

export const sampleDocument = {
    title: '제로웨이스트 입문 가이드: 오늘부터 할 수 있는 5가지',
    hero: { imageSlotId: 'hero', caption: '작은 실천이 모여 큰 변화를 만듭니다.' },
    seo: {
        title: '제로웨이스트 입문 가이드',
        description: '쓰레기를 줄이는 생활은 거창하지 않습니다. 오늘 바로 시작할 수 있는 다섯 가지를 핵심만 정리했습니다.',
        keywords: ['제로웨이스트', '친환경', '분리수거'],
    },
    facts: [],
    sections: [
        {
            id: 'h2-1', level: 2, heading: '왜 지금 시작해야 할까',
            paragraphs: [
                '하루에 버려지는 일회용품은 생각보다 많습니다. 작은 변화부터 시작하면 부담 없이 습관을 만들 수 있습니다.',
                '제로웨이스트는 완벽함이 아니라 방향입니다. 80%만 실천해도 충분히 의미가 있습니다.',
            ],
            imageSlots: ['inline-1'],
        },
        {
            id: 'h2-2', level: 2, heading: '오늘부터 할 수 있는 5가지',
            paragraphs: [
                '첫째, 텀블러를 챙기세요. 둘째, 장바구니를 휴대하세요. 셋째, 다회용 용기를 사용하세요.',
            ],
            imageSlots: [],
        },
        {
            id: 'h3-1', level: 3, heading: '분리수거 제대로 하기',
            paragraphs: [
                '라벨을 제거하고 내용물을 비운 뒤 헹구면 재활용률이 크게 올라갑니다.',
            ],
            imageSlots: [],
        },
        {
            id: 'h2-3', level: 2, heading: '꾸준함을 위한 팁',
            paragraphs: [
                '눈에 보이는 곳에 다회용품을 두면 실천이 쉬워집니다. 가족과 함께하면 더 오래 갑니다.',
            ],
            imageSlots: [],
        },
    ],
    imageSlots: [
        {
            slotId: 'hero', placement: 'afterTitle', purpose: '대표 이미지',
            promptSource: '재사용 가능한 텀블러와 장바구니',
            caption: '작은 실천이 모여 큰 변화를 만듭니다.', alt: '텀블러와 장바구니',
            imageUrl: 'https://images.unsplash.com/photo-1542601906990-b4d3fb778b09?w=1200',
        },
        {
            slotId: 'inline-1', placement: 'afterParagraph', sectionId: 'h2-1', paragraphIndex: 0,
            purpose: '본문 시각화', promptSource: '분리수거함',
            caption: '분리수거함은 라벨로 구분하면 편리합니다.', alt: '색깔별 분리수거함',
            imageUrl: 'https://images.unsplash.com/photo-1532996122724-e3c354a0b15b?w=1200',
        },
    ],
};

export const samplePreviewModel = {
    title: sampleDocument.title,
    blocks: [
        { kind: 'title', text: sampleDocument.title },
        { kind: 'image', imageUrl: sampleDocument.imageSlots[0].imageUrl, caption: sampleDocument.imageSlots[0].caption, alt: sampleDocument.imageSlots[0].alt, slotId: 'hero' },
        { kind: 'highlight', text: sampleDocument.seo.description },
        { kind: 'heading', level: 2, text: sampleDocument.sections[0].heading },
        { kind: 'paragraph', text: sampleDocument.sections[0].paragraphs[0] },
        { kind: 'image', imageUrl: sampleDocument.imageSlots[1].imageUrl, caption: sampleDocument.imageSlots[1].caption, alt: sampleDocument.imageSlots[1].alt, slotId: 'inline-1' },
        { kind: 'paragraph', text: sampleDocument.sections[0].paragraphs[1] },
        { kind: 'heading', level: 2, text: sampleDocument.sections[1].heading },
        { kind: 'paragraph', text: sampleDocument.sections[1].paragraphs[0] },
        { kind: 'heading', level: 3, text: sampleDocument.sections[2].heading },
        { kind: 'paragraph', text: sampleDocument.sections[2].paragraphs[0] },
        { kind: 'heading', level: 2, text: sampleDocument.sections[3].heading },
        { kind: 'paragraph', text: sampleDocument.sections[3].paragraphs[0] },
    ],
};

export function renderPreviewHtml() {
    return renderToStaticMarkup(React.createElement(BlogPreview, { previewModel: samplePreviewModel }));
}

export async function renderNaverHtml() {
    const { output } = await blogExportBlock.execute({ document: sampleDocument });
    return output.naverHtml;
}
`;

const PAGE = (title, bodyHtml) => `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<script src="https://cdn.tailwindcss.com"></script>
<style>
  /*
   * Self-contained fallback CSS so the screenshot renders styled even if the
   * Tailwind CDN is blocked/offline. Targets BOTH the previewModel path
   * ([data-testid=blog-preview] tag selectors) and the naverHtml path
   * (.blog-preview-html). Tailwind CDN, when reachable, simply refines this.
   */
  body { margin: 0; background: #f1f3f5; font-family: 'Noto Sans KR', system-ui, -apple-system, sans-serif; }
  .demo-shell { padding: 32px 16px; }
  .demo-card { box-shadow: 0 1px 8px rgba(0,0,0,.08); border-radius: 12px; overflow: hidden; }
  [data-testid="blog-preview"], .blog-preview-html { margin: 0 auto; max-width: 680px; background: #fff; padding: 32px 24px; text-align: left; }
  [data-testid="blog-preview"] h1, .blog-preview-html h1 { font-size: 28px; font-weight: 700; line-height: 1.35; margin: 0 0 24px; color: #212529; }
  [data-testid="blog-preview"] h2, .blog-preview-html h2 { font-size: 22px; font-weight: 700; line-height: 1.35; margin: 36px 0 12px; border-left: 4px solid #10b981; padding-left: 12px; color: #212529; }
  [data-testid="blog-preview"] h3, .blog-preview-html h3 { font-size: 19px; font-weight: 600; line-height: 1.35; margin: 28px 0 12px; color: #212529; }
  [data-testid="blog-preview"] p, .blog-preview-html p { font-size: 16px; line-height: 1.9; margin: 0 0 16px; color: #343a40; }
  [data-testid="blog-preview"] figure, .blog-preview-html figure { margin: 20px 0; }
  [data-testid="blog-preview"] img, .blog-preview-html img { display: block; width: 100%; max-height: 520px; object-fit: cover; border-radius: 8px; }
  [data-testid="blog-preview"] figcaption, .blog-preview-html figcaption { text-align: center; font-size: 13px; line-height: 1.6; color: #868e96; margin-top: 8px; }
  [data-testid="blog-preview"] aside { margin: 24px 0; border: 1px solid #a7f3d0; background: #ecfdf5; border-radius: 12px; padding: 16px 20px; font-size: 15px; line-height: 1.8; color: #064e3b; }
</style>
</head>
<body>
<div class="demo-shell">
  <div class="demo-card">${bodyHtml}</div>
</div>
</body>
</html>`;

async function main() {
    await mkdir(outDir, { recursive: true });
    await writeFile(tmpEntry + '.ts', ENTRY_SOURCE, 'utf8');

    const bundled = resolve(outDir, '.blog-demo-bundle.mjs');
    await build({
        entryPoints: [tmpEntry + '.ts'],
        bundle: true,
        format: 'esm',
        platform: 'node',
        target: 'node18',
        outfile: bundled,
        logLevel: 'error',
        jsx: 'automatic',
        // Let Node resolve React (CJS) natively; bundling its CJS into ESM breaks require().
        external: ['react', 'react-dom', 'react-dom/server'],
    });

    const mod = await import(pathToFileURL(bundled).href);
    const previewHtml = mod.renderPreviewHtml();
    const naverHtml = await mod.renderNaverHtml();

    await writeFile(resolve(outDir, 'blog-preview-demo.html'), PAGE('BlogPreview demo', previewHtml), 'utf8');
    await writeFile(
        resolve(outDir, 'naver-html-demo.html'),
        PAGE(
            'blog-export naverHtml demo',
            `<div class="blog-preview-html mx-auto max-w-[680px] bg-white px-6 py-8">${naverHtml}</div>`
        ),
        'utf8'
    );

    await rm(tmpEntry + '.ts', { force: true });
    await rm(bundled, { force: true });

    console.log('Wrote out/blog-preview-demo.html and out/naver-html-demo.html');
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
