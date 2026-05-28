import { contributionFor } from './catalog-helpers';

import type { WorkflowPackManifest } from './types';

const countryballBlocks = [
    { blockType: 'search', label: '컨트리볼 자료 수집' },
    { blockType: 'countryball-brief', label: '컨트리볼 기획 브리프' },
    { blockType: 'countryball-angle-lab', label: '컨트리볼 앵글 선택' },
    { blockType: 'countryball-writer-brain', label: '컨트리볼 작가 설계' },
    { blockType: 'countryball-script', label: '컨트리볼 대본 생성' },
    { blockType: 'countryball-data', label: '컨트리볼 데이터 정규화' },
    { blockType: 'countryball-analysis', label: '컨트리볼 품질 검수' },
    { blockType: 'countryball-image', label: '컨트리볼 이미지 생성' },
    { blockType: 'countryball-tts', label: '컨트리볼 음성 생성' },
    { blockType: 'countryball-video', label: '컨트리볼 영상 합성' },
    { blockType: 'integration', label: '메타데이터 생성' },
];

const countryballEdges = [
    { from: 0, to: 1 },
    { from: 1, to: 2 },
    { from: 2, to: 3 },
    { from: 3, to: 4 },
    { from: 4, to: 5 },
    { from: 5, to: 6 },
    { from: 6, to: 7 },
    { from: 6, to: 8 },
    { from: 7, to: 9 },
    { from: 8, to: 9 },
    { from: 9, to: 10 },
];

export const countryballShortsPack: WorkflowPackManifest = {
    packId: 'countryball-shorts',
    kind: 'recipe',
    displayName: 'Countryball Shorts',
    description:
        'Countryball Shorts production flow with dedicated brief, script, data, QA, image, TTS, and video contracts.',
    capabilities: [
        'source.collect',
        'countryball.brief',
        'countryball.angle-lab',
        'countryball.writer-brain',
        'countryball.script',
        'countryball.data',
        'countryball.analysis',
        'countryball.image',
        'countryball.tts',
        'countryball.video',
        'metadata.generate',
    ],
    blocks: [
        contributionFor('countryball-brief'),
        contributionFor('countryball-angle-lab'),
        contributionFor('countryball-writer-brain'),
        contributionFor('countryball-script'),
        contributionFor('countryball-data'),
        contributionFor('countryball-analysis'),
        contributionFor('countryball-image'),
        contributionFor('countryball-tts'),
        contributionFor('countryball-video'),
    ],
    recipes: [
        {
            recipeId: 'countryball.shorts.v1',
            displayName: '컨트리볼 쇼츠 제작',
            description:
                '컨트리볼/국가볼/폴란드볼 요청을 별도 product flow로 처리합니다. 일반 쇼츠 content/media 블록을 사용하지 않습니다.',
            triggerHints: ['컨트리볼', '국가볼', 'countryball', 'polandball', '폴란드볼'],
            outputType: 'video',
            requiredCapabilities: [
                'source.collect',
                'countryball.brief',
                'countryball.angle-lab',
                'countryball.writer-brain',
                'countryball.script',
                'countryball.data',
                'countryball.analysis',
                'countryball.image',
                'countryball.tts',
                'countryball.video',
                'metadata.generate',
            ],
            defaultBlocks: countryballBlocks,
            defaultEdges: countryballEdges,
            costPolicy: { estimatedCostUsd: 1.01, hardCapUsd: 2, requiresApproval: true },
        },
    ],
};
