/**
 * Shared block catalog for /blocks/* handlers.
 *
 * Two response shapes are produced from the same source:
 * 1. Legacy `{ list: [{ $definition, isFrontend, stereo, isRunnable }] }`
 *    — consumed by `GET /blocks/0/list` (existing frontend).
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
            description: '입시 트렌드/키워드 수집 (Search Agent)',
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
            description: '10~15장 이미지 기반 1분 쇼츠 스크립트 (Content Agent)',
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
            description: '씬별 세로 이미지 10~15장 생성 (Media Agent)',
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
