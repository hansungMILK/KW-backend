/**
 * Shorts-pack manifest — metadata for the shorts domain pack.
 */

import type { BlockCatalogMeta } from '../../blocks/block-registry';

export const SHORTS_PACK_MANIFEST = {
    name: 'shorts-pack',
    description: '입시정보 쇼츠 자동 생성 8단계 파이프라인',
    version: '1.0.0',
    blockTypes: ['search', 'content', 'data', 'analysis', 'media-image', 'media-tts', 'media-video', 'integration'],
    defaultTemplate: 'shorts-8step',
} as const;

/**
 * Block catalog metadata — TYPE-KEYED.
 * category = functional classification (for planner capability reasoning)
 * stereo = UI positioning (input/process/output on canvas)
 */
export const SHORTS_BLOCK_META: Record<string, BlockCatalogMeta> = {
    search: {
        label: '트렌드 수집',
        description: '입시 트렌드/키워드 수집 (Search Agent)',
        stereo: 'process',
        inputs: [],
        outputs: [{ id: 'out', label: 'Keywords + Articles', type: 'json' }],
        configSchema: [],
    },
    content: {
        label: '스크립트 생성',
        description: '7-scene 쇼츠 스크립트 생성 (Content Agent)',
        stereo: 'process',
        inputs: [{ id: 'in', label: 'Keywords', type: 'json' }],
        outputs: [{ id: 'out', label: 'Script', type: 'json' }],
        configSchema: [],
    },
    data: {
        label: '데이터 정규화',
        description: '씬별 프롬프트 구조화 (Data Agent)',
        stereo: 'process',
        inputs: [{ id: 'in', label: 'Script', type: 'json' }],
        outputs: [{ id: 'out', label: 'Normalized', type: 'json' }],
        configSchema: [],
    },
    analysis: {
        label: '품질 검수',
        description: '안전성/품질 검증 (Analysis Agent)',
        stereo: 'process',
        inputs: [{ id: 'in', label: 'Data', type: 'json' }],
        outputs: [{ id: 'out', label: 'Result', type: 'json' }],
        configSchema: [],
    },
    'media-image': {
        label: '이미지 생성',
        description: '씬별 이미지 ×7장 (Media Agent)',
        stereo: 'process',
        inputs: [{ id: 'in', label: 'Prompts', type: 'json' }],
        outputs: [{ id: 'out', label: 'Images', type: 'json' }],
        configSchema: [{ key: 'imageStyle', label: 'Image Style', type: 'text', default: 'realistic' }],
    },
    'media-tts': {
        label: '음성 생성',
        description: 'TTS 음성 합성 (Media Agent)',
        stereo: 'process',
        inputs: [{ id: 'in', label: 'Script', type: 'json' }],
        outputs: [{ id: 'out', label: 'Audio', type: 'json' }],
        configSchema: [{ key: 'voiceId', label: 'Voice ID', type: 'text', default: '' }],
    },
    'media-video': {
        label: '영상 합성',
        description: 'FFmpeg 영상 합성 (Media Agent)',
        stereo: 'process',
        inputs: [{ id: 'in', label: 'Assets', type: 'json' }],
        outputs: [{ id: 'out', label: 'Video', type: 'json' }],
        configSchema: [],
    },
    integration: {
        label: '메타데이터 생성',
        description: 'SEO 메타 + CloudFront URL (Integration Agent)',
        stereo: 'output',
        inputs: [{ id: 'in', label: 'Video', type: 'json' }],
        outputs: [{ id: 'out', label: 'Final', type: 'json' }],
        configSchema: [],
    },
};

/**
 * Functional category mapping — planner uses this to reason about capabilities.
 * Separate from stereo (UI positioning).
 */
export const SHORTS_BLOCK_CATEGORIES: Record<string, string> = {
    search: 'search',
    content: 'content',
    data: 'transform',
    analysis: 'analysis',
    'media-image': 'media',
    'media-tts': 'media',
    'media-video': 'media',
    integration: 'integration',
};

/**
 * Rich PortableSchema definitions — planner can understand block capabilities.
 * These approximate the actual output shapes from types.ts output schemas.
 */
export const SHORTS_PORTABLE_SCHEMAS: Record<string, { input: object; output: object; config: object }> = {
    search: {
        input: { type: 'object', properties: {} },
        output: {
            type: 'object',
            properties: {
                keywords: { type: 'array', items: { type: 'string' }, description: 'Trend keywords' },
                articles: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            title: { type: 'string' },
                            url: { type: 'string' },
                            source: { type: 'string' },
                            summary: { type: 'string' },
                        },
                    },
                    description: 'Related articles',
                },
                trendScore: { type: 'number', description: 'Trend relevance score 0-100' },
            },
            required: ['keywords', 'articles'],
        },
        config: { type: 'object', properties: {} },
    },
    content: {
        input: {
            type: 'object',
            properties: {
                keywords: { type: 'array', items: { type: 'string' } },
                articles: { type: 'array', items: { type: 'object' } },
            },
        },
        output: {
            type: 'object',
            properties: {
                hook: { type: 'string', description: 'Opening hook line' },
                scenes: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            sceneNumber: { type: 'number' },
                            narration: { type: 'string' },
                            imagePrompt: { type: 'string' },
                            durationSec: { type: 'number' },
                        },
                    },
                    description: '7 scenes with narration and image prompts',
                },
                cta: { type: 'string', description: 'Call to action' },
                totalDurationSec: { type: 'number' },
            },
            required: ['hook', 'scenes', 'cta'],
        },
        config: { type: 'object', properties: {} },
    },
    data: {
        input: { type: 'object', properties: { scenes: { type: 'array', items: { type: 'object' } } } },
        output: {
            type: 'object',
            properties: {
                normalizedScenes: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            sceneNumber: { type: 'number' },
                            narration: { type: 'string' },
                            imagePrompt: { type: 'string' },
                            keywords: { type: 'array', items: { type: 'string' } },
                        },
                    },
                },
                metadata: { type: 'object', properties: {} },
            },
            required: ['normalizedScenes'],
        },
        config: { type: 'object', properties: {} },
    },
    analysis: {
        input: { type: 'object', properties: { normalizedScenes: { type: 'array', items: { type: 'object' } } } },
        output: {
            type: 'object',
            properties: {
                safetyScore: { type: 'number', description: 'Content safety score 0-100', minimum: 0, maximum: 100 },
                qualityScore: { type: 'number', description: 'Content quality score 0-100', minimum: 0, maximum: 100 },
                issues: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
                            message: { type: 'string' },
                        },
                    },
                },
                approved: { type: 'boolean', description: 'Whether content passes safety/quality thresholds' },
            },
            required: ['safetyScore', 'qualityScore', 'issues', 'approved'],
        },
        config: { type: 'object', properties: {} },
    },
    'media-image': {
        input: { type: 'object', properties: { normalizedScenes: { type: 'array', items: { type: 'object' } } } },
        output: {
            type: 'object',
            properties: {
                images: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            sceneNumber: { type: 'number' },
                            url: { type: 'string' },
                            width: { type: 'number' },
                            height: { type: 'number' },
                            prompt: { type: 'string' },
                        },
                    },
                },
            },
            required: ['images'],
        },
        config: {
            type: 'object',
            properties: { imageStyle: { type: 'string', description: 'Image generation style', default: 'realistic' } },
        },
    },
    'media-tts': {
        input: {
            type: 'object',
            properties: {
                hook: { type: 'string' },
                scenes: { type: 'array', items: { type: 'object' } },
                cta: { type: 'string' },
            },
        },
        output: {
            type: 'object',
            properties: {
                audio: {
                    type: 'object',
                    properties: {
                        url: { type: 'string' },
                        durationSec: { type: 'number' },
                        format: { type: 'string' },
                        sampleRate: { type: 'number' },
                    },
                },
            },
            required: ['audio'],
        },
        config: { type: 'object', properties: { voiceId: { type: 'string', description: 'TTS voice identifier' } } },
    },
    'media-video': {
        input: {
            type: 'object',
            properties: { images: { type: 'array', items: { type: 'object' } }, audio: { type: 'object' } },
        },
        output: {
            type: 'object',
            properties: {
                video: {
                    type: 'object',
                    properties: {
                        url: { type: 'string' },
                        durationSec: { type: 'number' },
                        width: { type: 'number' },
                        height: { type: 'number' },
                        format: { type: 'string' },
                        sizeBytes: { type: 'number' },
                    },
                },
            },
            required: ['video'],
        },
        config: { type: 'object', properties: {} },
    },
    integration: {
        input: {
            type: 'object',
            properties: { video: { type: 'object' }, audio: { type: 'object' }, images: { type: 'array' } },
        },
        output: {
            type: 'object',
            properties: {
                title: { type: 'string' },
                description: { type: 'string' },
                hashtags: { type: 'array', items: { type: 'string' } },
                publicUrl: { type: 'string' },
                artifacts: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: { type: { type: 'string' }, url: { type: 'string' }, label: { type: 'string' } },
                    },
                },
            },
            required: ['title', 'description', 'hashtags', 'publicUrl', 'artifacts'],
        },
        config: { type: 'object', properties: {} },
    },
};
