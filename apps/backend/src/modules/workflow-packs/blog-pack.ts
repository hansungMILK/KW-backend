import { contributionFor } from './catalog-helpers';

import type { WorkflowPackManifest } from './types';

const blogBlockTypes = [
    'blog-brief',
    'blog-research',
    'blog-outline',
    'blog-draft',
    'blog-image-plan',
    'blog-images',
    'blog-seo',
    'blog-assemble',
    'blog-export',
] as const;

/**
 * Blog v2 — "네이버 복붙 완성형" recipe pack (additive, isolated like countryball/longform).
 * Pipeline: brief → research → outline(⏸ 선택 체크포인트) → draft → image-plan → images →
 * seo → assemble → export. Produces a structured BlogDocument plus Naver-oriented export
 * strings (naverHtml/markdown/imageManifest). text.blog.v1 is preserved separately.
 */
export const blogPack: WorkflowPackManifest = {
    packId: 'blog',
    kind: 'recipe',
    displayName: 'Blog',
    description:
        'Naver-ready blog production: brief, research, outline checkpoint, section drafting, image-slot planning and generation, SEO/AEO, document assembly, and copy-paste export.',
    capabilities: [
        'blog.brief',
        'blog.research',
        'source.collect',
        'blog.outline',
        'blog.draft',
        'text.generate',
        'blog.image-plan',
        'blog.images',
        'image.generate',
        'blog.seo',
        'metadata.generate',
        'blog.assemble',
        'blog.export',
    ],
    blocks: blogBlockTypes.map(contributionFor),
    recipes: [
        {
            recipeId: 'text.blog.v2',
            displayName: '네이버 블로그 완성형',
            description:
                'Topic to a structured BlogDocument with in-body image placement and Naver-ready copy-paste export (HTML + markdown + image manifest).',
            triggerHints: ['네이버 블로그', '블로그 완성', '복붙 블로그', '블로그 글', 'naver blog', 'blog post'],
            outputType: 'text',
            requiredCapabilities: ['blog.brief', 'blog.outline', 'blog.draft', 'blog.assemble', 'blog.export'],
            defaultBlocks: blogBlockTypes.map(blockType => ({
                blockType,
                label: contributionFor(blockType).orchestrator.label,
            })),
            defaultEdges: blogBlockTypes.slice(1).map((_, index) => ({ from: index, to: index + 1 })),
            costPolicy: { estimatedCostUsd: 0.18, hardCapUsd: 2, requiresApproval: false },
        },
    ],
};
