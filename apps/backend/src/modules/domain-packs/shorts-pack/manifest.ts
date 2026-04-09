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
 * Block catalog metadata — TYPE-KEYED (not array-indexed).
 * Lookup by blockType, not array position. Order-independent.
 */
export const SHORTS_BLOCK_META: Record<string, BlockCatalogMeta> = {
    search: {
        label: '트렌드 수집',
        description: '입시 트렌드/키워드 수집 (Search Agent)',
        stereo: 'process',
        inputs: [],
        outputs: [{ id: 'out', label: 'Keywords', type: 'json' }],
        configSchema: [],
    },
    content: {
        label: '스크립트 생성',
        description: '7-scene 쇼츠 스크립트 (Content Agent)',
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
