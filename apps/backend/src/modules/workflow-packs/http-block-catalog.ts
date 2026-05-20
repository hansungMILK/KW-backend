/**
 * Shared block catalog for /blocks/* handlers.
 *
 * Two response shapes are produced from the same source:
 * 1. Legacy `{ list: [{ $definition, isFrontend, stereo, isRunnable }] }`
 *    — retained as an internal compatibility shape for frontend adapters.
 * 2. Spec `{ items: [{ blockType, name, description, category, ... }] }`
 *    — consumed by `GET /blocks` and `GET /blocks/{blockType}` (new spec).
 *
 * Field mapping (legacy → spec):
 *   $definition.type        → blockType
 *   $definition.label       → name
 *   $definition.description → description
 *   stereo                  → category
 *   $definition.inputs      → inputSchema
 *   $definition.outputs     → outputSchema
 *   $definition.configSchema→ configFields (detail only)
 *
 * estimatedCost defaults to 0 — accuracy work is owned by 강연경 (audit #33, P2).
 */

export interface BlockDef {
    $definition: {
        id: string;
        type: string;
        label: string;
        description: string;
        inputs: Array<{ id: string; label: string; type: string }>;
        outputs: Array<{ id: string; label: string; type: string }>;
        configSchema: unknown[];
    };
    isFrontend: 0 | 1;
    stereo: 'input' | 'process' | 'output';
    isRunnable: boolean;
}

export const BLOCK_CATALOG: BlockDef[] = [
    // ── Frontend utility blocks ──
    {
        $definition: {
            id: 'blk-input-text',
            type: 'input-text',
            label: 'Text Input',
            description: 'Provide text input',
            inputs: [],
            outputs: [{ id: 'out', label: 'Output', type: 'text' }],
            configSchema: [{ key: 'text', label: 'Text', type: 'text', default: '' }],
        },
        isFrontend: 1,
        stereo: 'input',
        isRunnable: true,
    },
    {
        $definition: {
            id: 'blk-input-image',
            type: 'input-image',
            label: 'Image Input',
            description: 'Provide image input',
            inputs: [],
            outputs: [{ id: 'out', label: 'Output', type: 'image' }],
            configSchema: [{ key: 'imageData', label: 'Image Data', type: 'text', default: '' }],
        },
        isFrontend: 1,
        stereo: 'input',
        isRunnable: true,
    },
    {
        $definition: {
            id: 'blk-output-preview',
            type: 'output-preview',
            label: 'Preview',
            description: 'Preview output data',
            inputs: [{ id: 'in', label: 'Input', type: 'any' }],
            outputs: [{ id: 'out', label: 'Output', type: 'any' }],
            configSchema: [],
        },
        isFrontend: 1,
        stereo: 'output',
        isRunnable: true,
    },
    {
        $definition: {
            id: 'blk-buffer-delay',
            type: 'buffer-delay',
            label: 'Delay',
            description: 'Add delay between blocks',
            inputs: [{ id: 'in', label: 'Input', type: 'any' }],
            outputs: [{ id: 'out', label: 'Output', type: 'any' }],
            configSchema: [{ key: 'delayMs', label: 'Delay (ms)', type: 'number', default: '1000' }],
        },
        isFrontend: 1,
        stereo: 'process',
        isRunnable: true,
    },
    {
        $definition: {
            id: 'blk-text-transform',
            type: 'text-transform',
            label: 'Text Transform',
            description: 'Transform text',
            inputs: [{ id: 'in', label: 'Input', type: 'text' }],
            outputs: [{ id: 'out', label: 'Output', type: 'text' }],
            configSchema: [{ key: 'mode', label: 'Mode', type: 'text', default: 'uppercase' }],
        },
        isFrontend: 1,
        stereo: 'process',
        isRunnable: true,
    },
    // ── Backend (Shorts pipeline) blocks ──
    {
        $definition: {
            id: 'blk-search',
            type: 'search',
            label: '트렌드 수집',
            description: 'URL 원문 또는 웹 근거 수집 (Search Agent)',
            inputs: [{ id: 'in', label: 'Topic', type: 'text' }],
            outputs: [{ id: 'out', label: 'Keywords', type: 'json' }],
            configSchema: [],
        },
        isFrontend: 0,
        stereo: 'process',
        isRunnable: true,
    },
    {
        $definition: {
            id: 'blk-content',
            type: 'content',
            label: '스크립트 생성',
            description: '기본 12장, 선택 시 8/12/16장 기반 1분 쇼츠 스크립트 (Content Agent)',
            inputs: [{ id: 'in', label: 'Keywords', type: 'json' }],
            outputs: [{ id: 'out', label: 'Script', type: 'json' }],
            configSchema: [],
        },
        isFrontend: 0,
        stereo: 'process',
        isRunnable: true,
    },
    {
        $definition: {
            id: 'blk-data',
            type: 'data',
            label: '데이터 정규화',
            description: '씬별 프롬프트 구조화 (Data Agent)',
            inputs: [{ id: 'in', label: 'Script', type: 'json' }],
            outputs: [{ id: 'out', label: 'Normalized', type: 'json' }],
            configSchema: [],
        },
        isFrontend: 0,
        stereo: 'process',
        isRunnable: true,
    },
    {
        $definition: {
            id: 'blk-analysis',
            type: 'analysis',
            label: '품질 검수',
            description: '안전성/품질 검증 (Analysis Agent)',
            inputs: [{ id: 'in', label: 'Data', type: 'json' }],
            outputs: [{ id: 'out', label: 'Result', type: 'json' }],
            configSchema: [],
        },
        isFrontend: 0,
        stereo: 'process',
        isRunnable: true,
    },
    {
        $definition: {
            id: 'blk-media-image',
            type: 'media-image',
            label: '이미지 생성',
            description: '씬별 세로 이미지 생성: 기본 12장, 선택 시 8/12/16장 (Media Agent)',
            inputs: [{ id: 'in', label: 'Prompts', type: 'json' }],
            outputs: [{ id: 'out', label: 'Images', type: 'json' }],
            configSchema: [],
        },
        isFrontend: 0,
        stereo: 'process',
        isRunnable: true,
    },
    {
        $definition: {
            id: 'blk-media-tts',
            type: 'media-tts',
            label: '음성 생성',
            description: 'TTS 음성 합성 (Media Agent)',
            inputs: [{ id: 'in', label: 'Script', type: 'json' }],
            outputs: [{ id: 'out', label: 'Audio', type: 'json' }],
            configSchema: [],
        },
        isFrontend: 0,
        stereo: 'process',
        isRunnable: true,
    },
    {
        $definition: {
            id: 'blk-media-video',
            type: 'media-video',
            label: '영상 합성',
            description: 'FFmpeg 영상 합성 (Media Agent)',
            inputs: [{ id: 'in', label: 'Assets', type: 'json' }],
            outputs: [{ id: 'out', label: 'Video', type: 'json' }],
            configSchema: [],
        },
        isFrontend: 0,
        stereo: 'process',
        isRunnable: true,
    },
    {
        $definition: {
            id: 'blk-integration',
            type: 'integration',
            label: '메타데이터 생성',
            description: 'SEO 메타 + CloudFront URL (Integration Agent)',
            inputs: [{ id: 'in', label: 'Video', type: 'json' }],
            outputs: [{ id: 'out', label: 'Final', type: 'json' }],
            configSchema: [],
        },
        isFrontend: 0,
        stereo: 'output',
        isRunnable: true,
    },
    // ── Backend (Longform production) blocks ──
    {
        $definition: {
            id: 'blk-longform-source',
            type: 'longform-source',
            label: '롱폼 자료 수집',
            description: '원문 URL과 보조 자료를 정리해 롱폼 제작용 source digest를 만듭니다.',
            inputs: [{ id: 'in', label: 'Request', type: 'text' }],
            outputs: [{ id: 'out', label: 'Sources', type: 'json' }],
            configSchema: [],
        },
        isFrontend: 0,
        stereo: 'process',
        isRunnable: true,
    },
    {
        $definition: {
            id: 'blk-longform-brief',
            type: 'longform-brief',
            label: '롱폼 관점 설계',
            description: '시청자 약속, 관점, 구조, 근거 사용 계획을 설계합니다.',
            inputs: [{ id: 'in', label: 'Sources', type: 'json' }],
            outputs: [{ id: 'out', label: 'Brief', type: 'json' }],
            configSchema: [],
        },
        isFrontend: 0,
        stereo: 'process',
        isRunnable: true,
    },
    {
        $definition: {
            id: 'blk-longform-script',
            type: 'longform-script',
            label: '롱폼 대본 작성',
            description: '검수 가능한 롱폼 내레이션 초안과 section/source map을 작성합니다.',
            inputs: [{ id: 'in', label: 'Brief', type: 'json' }],
            outputs: [{ id: 'out', label: 'Script', type: 'json' }],
            configSchema: [],
        },
        isFrontend: 0,
        stereo: 'process',
        isRunnable: true,
    },
    {
        $definition: {
            id: 'blk-longform-storyboard',
            type: 'longform-storyboard',
            label: '롱폼 스토리보드',
            description: '대본 section을 모션그래픽 visual chapter로 변환합니다.',
            inputs: [{ id: 'in', label: 'Script', type: 'json' }],
            outputs: [{ id: 'out', label: 'Storyboard', type: 'json' }],
            configSchema: [],
        },
        isFrontend: 0,
        stereo: 'process',
        isRunnable: true,
    },
    {
        $definition: {
            id: 'blk-longform-scene-json',
            type: 'longform-scene-json',
            label: '롱폼 장면 계약',
            description: 'HyperFrames가 읽을 2K 장면/모션 계약 JSON을 만듭니다.',
            inputs: [{ id: 'in', label: 'Storyboard', type: 'json' }],
            outputs: [{ id: 'out', label: 'Scene JSON', type: 'json' }],
            configSchema: [],
        },
        isFrontend: 0,
        stereo: 'process',
        isRunnable: true,
    },
    {
        $definition: {
            id: 'blk-longform-review',
            type: 'longform-review',
            label: '롱폼 사용자 검수',
            description: '유료 제작 전 대본과 장면 계약을 사용자가 확인하는 검수 지점입니다.',
            inputs: [{ id: 'in', label: 'Draft Artifacts', type: 'json' }],
            outputs: [{ id: 'out', label: 'Review', type: 'json' }],
            configSchema: [],
        },
        isFrontend: 0,
        stereo: 'process',
        isRunnable: true,
    },
    {
        $definition: {
            id: 'blk-longform-tts',
            type: 'longform-tts',
            label: '롱폼 음성 생성',
            description: '승인된 롱폼 대본으로 내레이션 TTS를 생성합니다.',
            inputs: [{ id: 'in', label: 'Approved Script', type: 'json' }],
            outputs: [{ id: 'out', label: 'Audio', type: 'json' }],
            configSchema: [],
        },
        isFrontend: 0,
        stereo: 'process',
        isRunnable: true,
    },
    {
        $definition: {
            id: 'blk-longform-srt-align',
            type: 'longform-srt-align',
            label: '롱폼 자막 정렬',
            description: '음성 기준 자막 타이밍과 display subtitle cue를 만듭니다.',
            inputs: [{ id: 'in', label: 'Audio + Script', type: 'json' }],
            outputs: [{ id: 'out', label: 'Timed Subtitles', type: 'json' }],
            configSchema: [],
        },
        isFrontend: 0,
        stereo: 'process',
        isRunnable: true,
    },
    {
        $definition: {
            id: 'blk-longform-motion-compose',
            type: 'longform-motion-compose',
            label: '롱폼 모션 설계',
            description: 'Scene JSON과 자막 cue를 HyperFrames composition 산출물로 구성합니다.',
            inputs: [{ id: 'in', label: 'Scene JSON + SRT', type: 'json' }],
            outputs: [{ id: 'out', label: 'Composition', type: 'json' }],
            configSchema: [],
        },
        isFrontend: 0,
        stereo: 'process',
        isRunnable: true,
    },
    {
        $definition: {
            id: 'blk-longform-render',
            type: 'longform-render',
            label: '롱폼 2K 렌더',
            description: '승인된 composition을 2K MP4 미리보기/다운로드 산출물로 렌더합니다.',
            inputs: [{ id: 'in', label: 'Composition', type: 'json' }],
            outputs: [{ id: 'out', label: 'Video', type: 'json' }],
            configSchema: [
                { key: 'rendererRoute', label: 'Renderer', type: 'text', default: 'hyperframes' },
                {
                    key: 'longformHtmlRenderEstimatedCostUsd',
                    label: 'Estimated Cost USD',
                    type: 'number',
                    default: '0',
                },
            ],
        },
        isFrontend: 0,
        stereo: 'process',
        isRunnable: true,
    },
    {
        $definition: {
            id: 'blk-longform-qa',
            type: 'longform-qa',
            label: '롱폼 QA',
            description: 'MP4 stream, 해상도, 자막/음성 타이밍, 다운로드 가능 여부를 검증합니다.',
            inputs: [{ id: 'in', label: 'Video', type: 'json' }],
            outputs: [{ id: 'out', label: 'QA Report', type: 'json' }],
            configSchema: [],
        },
        isFrontend: 0,
        stereo: 'process',
        isRunnable: true,
    },
    {
        $definition: {
            id: 'blk-longform-package',
            type: 'longform-package',
            label: '롱폼 패키지',
            description: '검증된 MP4, SRT, 대본, source digest를 다운로드 가능한 패키지로 묶습니다.',
            inputs: [{ id: 'in', label: 'QA Report', type: 'json' }],
            outputs: [{ id: 'out', label: 'Package', type: 'json' }],
            configSchema: [],
        },
        isFrontend: 0,
        stereo: 'output',
        isRunnable: true,
    },
];

export interface SpecBlockSummary {
    blockType: string;
    name: string;
    description: string;
    category: 'input' | 'process' | 'output';
    inputSchema: unknown[];
    outputSchema: unknown[];
    estimatedCost: number;
}

export interface SpecBlockDetail extends SpecBlockSummary {
    configFields: unknown[];
}

export const toSpecBlock = (b: BlockDef): SpecBlockSummary => ({
    blockType: b.$definition.type,
    name: b.$definition.label,
    description: b.$definition.description,
    category: b.stereo,
    inputSchema: b.$definition.inputs,
    outputSchema: b.$definition.outputs,
    estimatedCost: 0,
});

export const toSpecBlockDetail = (b: BlockDef): SpecBlockDetail => ({
    ...toSpecBlock(b),
    configFields: b.$definition.configSchema,
});

export const findBlockByType = (blockType: string): BlockDef | undefined =>
    BLOCK_CATALOG.find(b => b.$definition.type === blockType);
