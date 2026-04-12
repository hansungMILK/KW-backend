/**
 * Shared block catalog for product APIs.
 * Single source of truth for GET /blocks, GET /blocks/{blockType}, GET /initial-data.
 *
 * Each block belongs to one or more scenarios.
 * Supported scenarios:
 *  - 'admission-shorts' — 대학 입시 쇼츠 자동 제작 (full 8-block pipeline)
 *  - 'news-shorts'      — 뉴스 요약 쇼츠 자동 제작 (subset, reuses shared blocks)
 * New scenarios should tag relevant entries with their scenario key, OR add
 * scenario-specific entries here.
 */

export interface ProductBlockEntry {
    blockType: string;
    name: string;
    description: string;
    category: string;
    stereo: string;
    scenarios: string[]; // which scenarios this block belongs to
    inputs: Array<{ id: string; label: string; type: string }>;
    outputs: Array<{ id: string; label: string; type: string }>;
    configFields: unknown[];
    estimatedCost: Record<string, unknown> | null;
}

export const PRODUCT_BLOCK_CATALOG: ProductBlockEntry[] = [
    {
        blockType: 'search',
        name: '트렌드 수집',
        description: '입시 트렌드/키워드 수집 (Search Agent)',
        category: 'search',
        stereo: 'process',
        scenarios: ['admission-shorts'],
        inputs: [],
        outputs: [{ id: 'out', label: 'Keywords', type: 'json' }],
        configFields: [{ key: 'apiKeyOverride', label: 'API Key Override', type: 'password', default: '' }],
        estimatedCost: { currency: 'USD', amount: 0.02 },
    },
    {
        blockType: 'content',
        name: '스크립트 생성',
        description: '7-scene 쇼츠 스크립트 (Content Agent)',
        category: 'content',
        stereo: 'process',
        scenarios: ['admission-shorts', 'news-shorts'],
        inputs: [{ id: 'in', label: 'Keywords', type: 'json' }],
        outputs: [{ id: 'out', label: 'Script', type: 'json' }],
        configFields: [{ key: 'apiKeyOverride', label: 'API Key Override', type: 'password', default: '' }],
        estimatedCost: { currency: 'USD', amount: 0.15 },
    },
    {
        blockType: 'data',
        name: '데이터 정규화',
        description: '씬별 프롬프트 구조화 (Data Agent)',
        category: 'data',
        stereo: 'process',
        scenarios: ['admission-shorts'],
        inputs: [{ id: 'in', label: 'Script', type: 'json' }],
        outputs: [{ id: 'out', label: 'Normalized', type: 'json' }],
        configFields: [],
        estimatedCost: { currency: 'USD', amount: 0.01 },
    },
    {
        blockType: 'analysis',
        name: '품질 검수',
        description: '안전성/품질 검증 (Analysis Agent)',
        category: 'analysis',
        stereo: 'process',
        scenarios: ['admission-shorts'],
        inputs: [{ id: 'in', label: 'Data', type: 'json' }],
        outputs: [{ id: 'out', label: 'Result', type: 'json' }],
        configFields: [{ key: 'apiKeyOverride', label: 'API Key Override', type: 'password', default: '' }],
        estimatedCost: { currency: 'USD', amount: 0.05 },
    },
    {
        blockType: 'media-image',
        name: '이미지 생성',
        description: '씬별 이미지 ×7장 (Media Agent)',
        category: 'media',
        stereo: 'process',
        scenarios: ['admission-shorts'],
        inputs: [{ id: 'in', label: 'Prompts', type: 'json' }],
        outputs: [{ id: 'out', label: 'Images', type: 'json' }],
        configFields: [{ key: 'apiKeyOverride', label: 'API Key Override', type: 'password', default: '' }],
        estimatedCost: { currency: 'USD', amount: 0.7 },
    },
    {
        blockType: 'media-tts',
        name: '음성 생성',
        description: 'TTS 음성 합성 (Media Agent)',
        category: 'media',
        stereo: 'process',
        scenarios: ['admission-shorts', 'news-shorts'],
        inputs: [{ id: 'in', label: 'Script', type: 'json' }],
        outputs: [{ id: 'out', label: 'Audio', type: 'json' }],
        configFields: [{ key: 'apiKeyOverride', label: 'API Key Override', type: 'password', default: '' }],
        estimatedCost: { currency: 'USD', amount: 0.1 },
    },
    {
        blockType: 'media-video',
        name: '영상 합성',
        description: 'FFmpeg 영상 합성 (Media Agent)',
        category: 'media',
        stereo: 'process',
        scenarios: ['admission-shorts'],
        inputs: [{ id: 'in', label: 'Assets', type: 'json' }],
        outputs: [{ id: 'out', label: 'Video', type: 'json' }],
        configFields: [],
        estimatedCost: { currency: 'USD', amount: 0.2 },
    },
    {
        blockType: 'integration',
        name: '메타데이터 생성',
        description: 'SEO 메타 + CloudFront URL (Integration Agent)',
        category: 'integration',
        stereo: 'output',
        scenarios: ['admission-shorts', 'news-shorts'],
        inputs: [{ id: 'in', label: 'Video', type: 'json' }],
        outputs: [{ id: 'out', label: 'Final', type: 'json' }],
        configFields: [{ key: 'apiKeyOverride', label: 'API Key Override', type: 'password', default: '' }],
        estimatedCost: { currency: 'USD', amount: 0.02 },
    },

    // ────────────────────────────────────────────────────────────────
    // news-shorts scenario — news summarization shorts pipeline
    // ────────────────────────────────────────────────────────────────
    {
        blockType: 'news-source',
        name: '뉴스 수집',
        description: 'RSS/뉴스 피드에서 최근 기사 수집 (News Collector)',
        category: 'search',
        stereo: 'input',
        scenarios: ['news-shorts'],
        inputs: [],
        outputs: [{ id: 'out', label: 'Articles', type: 'json' }],
        configFields: [
            { key: 'feedUrl', label: 'RSS Feed URL', type: 'text', default: '' },
            { key: 'apiKeyOverride', label: 'API Key Override', type: 'password', default: '' },
        ],
        estimatedCost: { currency: 'USD', amount: 0.01 },
    },
    {
        blockType: 'news-summary',
        name: '뉴스 요약',
        description: '기사 본문을 15초 쇼츠 분량으로 요약 (Summary Agent)',
        category: 'content',
        stereo: 'process',
        scenarios: ['news-shorts'],
        inputs: [{ id: 'in', label: 'Articles', type: 'json' }],
        outputs: [{ id: 'out', label: 'Summary', type: 'json' }],
        configFields: [
            {
                key: 'tone',
                label: 'Tone',
                type: 'select',
                options: ['neutral', 'casual', 'serious'],
                default: 'neutral',
            },
            { key: 'apiKeyOverride', label: 'API Key Override', type: 'password', default: '' },
        ],
        estimatedCost: { currency: 'USD', amount: 0.08 },
    },
    {
        blockType: 'news-caption',
        name: '자막 생성',
        description: '요약 기반 하드자막 이미지 생성 (Caption Agent)',
        category: 'media',
        stereo: 'process',
        scenarios: ['news-shorts'],
        inputs: [{ id: 'in', label: 'Summary', type: 'json' }],
        outputs: [{ id: 'out', label: 'CaptionTrack', type: 'json' }],
        configFields: [{ key: 'fontSize', label: 'Font Size', type: 'number', default: 48 }],
        estimatedCost: { currency: 'USD', amount: 0.02 },
    },
];

/** Get blocks filtered by scenario */
export const getBlocksByScenario = (scenario: string): ProductBlockEntry[] =>
    PRODUCT_BLOCK_CATALOG.filter(b => b.scenarios.includes(scenario));

/** Lookup by blockType */
export const PRODUCT_BLOCK_MAP = Object.fromEntries(PRODUCT_BLOCK_CATALOG.map(b => [b.blockType, b]));

/** Format block for product API response */
export const formatBlockForApi = (b: ProductBlockEntry) => ({
    blockType: b.blockType,
    name: b.name,
    description: b.description,
    category: b.category,
    configFields: b.configFields,
    inputSchema: { type: 'object', properties: Object.fromEntries(b.inputs.map(i => [i.id, { type: i.type }])) },
    outputSchema: { type: 'object', properties: Object.fromEntries(b.outputs.map(o => [o.id, { type: o.type }])) },
    estimatedCost: b.estimatedCost,
});
