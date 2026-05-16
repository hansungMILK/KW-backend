import { contributionFor } from './catalog-helpers';

import type { WorkflowPackManifest } from './types';

const longformBlockTypes = [
    'longform-source',
    'longform-brief',
    'longform-script',
    'longform-storyboard',
    'longform-scene-json',
    'longform-review',
    'longform-tts',
    'longform-srt-align',
    'longform-motion-compose',
    'longform-render',
    'longform-qa',
    'longform-package',
] as const;

export const longformPack: WorkflowPackManifest = {
    packId: 'longform',
    kind: 'recipe',
    displayName: 'Longform',
    description:
        'Longform production recipes with source review, Gate A approval, TTS/SRT, motion render, QA, and package output.',
    capabilities: [
        'source.collect',
        'text.generate',
        'longform.source',
        'longform.brief',
        'longform.script',
        'longform.storyboard',
        'longform.scene-json',
        'longform.review',
        'audio.tts',
        'longform.srt-align',
        'longform.motion-compose',
        'longform.render',
        'longform.qa',
        'longform.package',
    ],
    blocks: longformBlockTypes.map(contributionFor),
    recipes: [
        {
            recipeId: 'longform.explainer.v1',
            displayName: '롱폼 설명 영상',
            description: 'Topic or URL to reviewed longform script, motion graphic MP4, QA report, and package.',
            triggerHints: ['롱폼', 'longform', '긴 영상', '유튜브 롱폼'],
            outputType: 'video',
            requiredCapabilities: [
                'source.collect',
                'text.generate',
                'longform.review',
                'audio.tts',
                'longform.motion-compose',
                'longform.render',
                'longform.qa',
                'longform.package',
            ],
            defaultBlocks: longformBlockTypes.map(blockType => ({
                blockType,
                label: contributionFor(blockType).orchestrator.label,
            })),
            defaultEdges: longformBlockTypes.slice(1).map((_, index) => ({ from: index, to: index + 1 })),
            costPolicy: { estimatedCostUsd: 0.82, hardCapUsd: 5, requiresApproval: true },
        },
    ],
};
