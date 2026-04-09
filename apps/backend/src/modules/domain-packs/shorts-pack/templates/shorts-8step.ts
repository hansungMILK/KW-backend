/**
 * Shorts 8-step pipeline template.
 * Defines the canonical block sequence and DAG edges for the shorts pipeline.
 * Moved from mock-orchestrator.ts.
 */

export const SHORTS_8STEP_BLOCKS = [
    { type: 'search', label: '트렌드 수집' },
    { type: 'content', label: '스크립트 생성' },
    { type: 'data', label: '데이터 정규화' },
    { type: 'analysis', label: '품질 검수' },
    { type: 'media-image', label: '이미지 생성' },
    { type: 'media-tts', label: '음성 생성' },
    { type: 'media-video', label: '영상 합성' },
    { type: 'integration', label: '메타데이터 생성' },
] as const;

export type Shorts8StepBlock = (typeof SHORTS_8STEP_BLOCKS)[number];

export const SHORTS_COST_PER_BLOCK: Record<string, number> = {
    search: 0.02,
    content: 0.15,
    data: 0.01,
    analysis: 0.05,
    'media-image': 0.7,
    'media-tts': 0.1,
    'media-video': 0.2,
    integration: 0.02,
};

/**
 * Build the DAG edges for the 8-step shorts pipeline.
 * Nodes are assumed to be indexed in the same order as SHORTS_8STEP_BLOCKS.
 *
 * Topology:
 *   search(0) → content(1) → data(2) → analysis(3)
 *   analysis(3) → media-image(4)  (parallel)
 *   analysis(3) → media-tts(5)    (parallel)
 *   media-image(4) → media-video(6)
 *   media-tts(5)   → media-video(6)
 *   media-video(6) → integration(7)
 */
export const SHORTS_8STEP_EDGE_PAIRS: Array<[number, number]> = [
    [0, 1], // search → content
    [1, 2], // content → data
    [2, 3], // data → analysis
    [3, 4], // analysis → media-image (parallel 1)
    [3, 5], // analysis → media-tts   (parallel 2)
    [4, 6], // media-image → media-video
    [5, 6], // media-tts   → media-video
    [6, 7], // media-video → integration
];
