import { contributionFor } from './catalog-helpers';

import type { WorkflowPackManifest } from './types';

export const mediaPack: WorkflowPackManifest = {
    packId: 'media',
    kind: 'capability',
    displayName: 'Media',
    description: 'Reusable image, TTS, and video composition capabilities.',
    capabilities: ['image.generate', 'audio.tts', 'video.compose'],
    blocks: [contributionFor('media-image'), contributionFor('media-tts'), contributionFor('media-video')],
    recipes: [
        {
            recipeId: 'image.single.v1',
            displayName: '단일 이미지 생성',
            description: 'Prompt planning followed by one generated image.',
            triggerHints: ['이미지 생성', '그림 생성', '사진 만들어줘', 'single image'],
            outputType: 'image',
            requiredCapabilities: ['text.generate', 'image.generate'],
            defaultBlocks: [
                { blockType: 'content', label: '이미지 프롬프트 구성', config: { mode: 'single-image' } },
                { blockType: 'media-image', label: '이미지 생성', config: { count: 1, style: 'single-image' } },
            ],
            defaultEdges: [{ from: 0, to: 1 }],
            costPolicy: { estimatedCostUsd: 0.08, requiresApproval: true },
        },
    ],
};
