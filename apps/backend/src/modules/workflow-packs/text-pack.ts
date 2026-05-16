import { contributionFor } from './catalog-helpers';

import type { WorkflowPackManifest } from './types';

export const textPack: WorkflowPackManifest = {
    packId: 'text',
    kind: 'capability',
    displayName: 'Text and Data',
    description: 'Text generation, data normalization, quality review, and metadata output.',
    capabilities: ['text.generate', 'data.structure', 'quality.review', 'metadata.generate'],
    blocks: [
        contributionFor('content'),
        contributionFor('data'),
        contributionFor('analysis'),
        contributionFor('integration'),
    ],
    recipes: [
        {
            recipeId: 'text.blog.v1',
            displayName: '블로그 글 작성',
            description: 'User-provided topic or source material to a readable Markdown article.',
            triggerHints: ['블로그', '글', '본문', '문서', '아티클', '포스트', 'blog', 'article', 'post'],
            outputType: 'text',
            requiredCapabilities: ['text.generate', 'output.preview'],
            defaultBlocks: [
                { blockType: 'content', label: '블로그 글 작성', config: { mode: 'blog-article' } },
                { blockType: 'output-preview', label: '글 미리보기', config: { outputKind: 'markdown' } },
            ],
            defaultEdges: [{ from: 0, to: 1 }],
            costPolicy: { estimatedCostUsd: 0.03, requiresApproval: false },
        },
        {
            recipeId: 'text.url-explainer.v1',
            displayName: 'URL 설명문 작성',
            description: 'URL-first source collection followed by a readable explanation or blog article.',
            triggerHints: ['링크 설명', 'url explain', '기사 요약', '원문 정리'],
            outputType: 'text',
            requiredCapabilities: ['source.collect', 'text.generate', 'output.preview'],
            defaultBlocks: [
                { blockType: 'search', label: 'URL 원문 수집' },
                { blockType: 'content', label: '문서 작성', config: { mode: 'article' } },
                { blockType: 'output-preview', label: '글 미리보기', config: { outputKind: 'markdown' } },
            ],
            defaultEdges: [
                { from: 0, to: 1 },
                { from: 1, to: 2 },
            ],
            costPolicy: { estimatedCostUsd: 0.05, requiresApproval: false },
        },
    ],
};
