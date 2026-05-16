import type { WorkflowPackManifest } from './types';

const shortsBlocks = [
    { blockType: 'search', label: '링크 및 최신 정보 수집' },
    { blockType: 'content', label: '쇼츠 대본 및 장면 구성' },
    { blockType: 'data', label: '장면 데이터 정규화' },
    { blockType: 'analysis', label: '사실성 및 형식 검수' },
    { blockType: 'media-image', label: '장면 이미지 생성' },
    { blockType: 'media-tts', label: '나레이션 음성 생성' },
    { blockType: 'media-video', label: '쇼츠 영상 합성' },
    { blockType: 'integration', label: '메타데이터 생성' },
];

const shortsEdges = [
    { from: 0, to: 1 },
    { from: 1, to: 2 },
    { from: 2, to: 3 },
    { from: 3, to: 4 },
    { from: 3, to: 5 },
    { from: 4, to: 6 },
    { from: 5, to: 6 },
    { from: 6, to: 7 },
];

export const shortsPack: WorkflowPackManifest = {
    packId: 'shorts',
    kind: 'recipe',
    displayName: 'Shorts',
    description: 'Short-form video recipes that compose research, text, media, and metadata capabilities.',
    capabilities: [
        'source.collect',
        'text.generate',
        'data.structure',
        'quality.review',
        'image.generate',
        'audio.tts',
        'video.compose',
        'metadata.generate',
    ],
    blocks: [],
    recipes: [
        {
            recipeId: 'shorts.info.v1',
            displayName: '정보전달 쇼츠',
            description: 'Source-grounded short-form explainer video.',
            triggerHints: ['쇼츠', '정보전달', 'shorts', 'reels', 'tiktok'],
            outputType: 'video',
            requiredCapabilities: [
                'source.collect',
                'text.generate',
                'data.structure',
                'quality.review',
                'image.generate',
                'audio.tts',
                'video.compose',
                'metadata.generate',
            ],
            defaultBlocks: shortsBlocks,
            defaultEdges: shortsEdges,
            costPolicy: { estimatedCostUsd: 0.9, hardCapUsd: 2, requiresApproval: true },
        },
    ],
};
