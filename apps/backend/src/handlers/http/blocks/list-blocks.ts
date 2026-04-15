import { withMiddleware } from '../../../utils/middleware';
import { ok } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * GET /blocks
 * GET /blocks/0/list?cores=1&limit=-1
 *
 * Returns: { blocks: Block[], list: BlockListItem[] }
 *
 * 블록 카탈로그를 반환합니다.
 * 하위 호환성을 위해 기존 'list' 형식과 새로운 'blocks' 형식을 모두 지원합니다.
 * 'category' 쿼리 파라미터로 필터링이 가능합니다.
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
    category?: string;
}

export const BLOCK_CATALOG: BlockDef[] = [
    // ── Frontend utility blocks ──
    {
        $definition: {
            id: 'blk-input-text',
            type: 'input-text',
            label: 'Text Input',
            description: '텍스트 입력을 제공합니다.',
            inputs: [],
            outputs: [{ id: 'out', label: 'Output', type: 'text' }],
            configSchema: [{ key: 'text', label: 'Text', type: 'text', default: '' }],
        },
        isFrontend: 1,
        stereo: 'input',
        isRunnable: true,
        category: 'Utility',
    },
    {
        $definition: {
            id: 'blk-input-image',
            type: 'input-image',
            label: 'Image Input',
            description: '이미지 입력을 제공합니다.',
            inputs: [],
            outputs: [{ id: 'out', label: 'Output', type: 'image' }],
            configSchema: [{ key: 'imageData', label: 'Image Data', type: 'text', default: '' }],
        },
        isFrontend: 1,
        stereo: 'input',
        isRunnable: true,
        category: 'Utility',
    },
    {
        $definition: {
            id: 'blk-output-preview',
            type: 'output-preview',
            label: 'Preview',
            description: '출력 데이터를 미리 보여줍니다.',
            inputs: [{ id: 'in', label: 'Input', type: 'any' }],
            outputs: [{ id: 'out', label: 'Output', type: 'any' }],
            configSchema: [],
        },
        isFrontend: 1,
        stereo: 'output',
        isRunnable: true,
        category: 'Utility',
    },
    // ── Backend (Search Agent) ──
    {
        $definition: {
            id: 'blk-search',
            type: 'search',
            label: 'Search Agent',
            description: '웹 검색 및 트렌드 데이터 수집',
            inputs: [],
            outputs: [{ id: 'out', label: 'Keywords', type: 'json' }],
            configSchema: [],
        },
        isFrontend: 0,
        stereo: 'process',
        isRunnable: true,
        category: 'Search',
    },
    // ── Backend (Content Agent) ──
    {
        $definition: {
            id: 'blk-content',
            type: 'content',
            label: 'Content Agent',
            description: '7-scene 쇼츠 스크립트 생성',
            inputs: [{ id: 'in', label: 'Keywords', type: 'json' }],
            outputs: [{ id: 'out', label: 'Script', type: 'json' }],
            configSchema: [],
        },
        isFrontend: 0,
        stereo: 'process',
        isRunnable: true,
        category: 'Content',
    },
    // ── Backend (Media Agent) ──
    {
        $definition: {
            id: 'blk-media-image',
            type: 'media-image',
            label: 'Media Agent (Image)',
            description: '이미지 생성 및 에셋 관리',
            inputs: [{ id: 'in', label: 'Prompts', type: 'json' }],
            outputs: [{ id: 'out', label: 'Images', type: 'json' }],
            configSchema: [],
        },
        isFrontend: 0,
        stereo: 'process',
        isRunnable: true,
        category: 'Media',
    },
    {
        $definition: {
            id: 'blk-media-video',
            type: 'media-video',
            label: 'Media Agent (Video)',
            description: '영상 합성 및 최종 렌더링',
            inputs: [{ id: 'in', label: 'Assets', type: 'json' }],
            outputs: [{ id: 'out', label: 'Video', type: 'json' }],
            configSchema: [],
        },
        isFrontend: 0,
        stereo: 'process',
        isRunnable: true,
        category: 'Media',
    },
];

const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const categoryFilter = event.queryStringParameters?.category;

    // 카테고리 필터링이 필요한 경우 적용
    const filteredCatalog = BLOCK_CATALOG.filter(b => {
        if (!categoryFilter) return true;
        return b.category?.toLowerCase() === categoryFilter.toLowerCase();
    });

    // 신규 'blocks' 형식으로 매핑
    const blocks = filteredCatalog.map(b => ({
        id: b.$definition.id,
        name: b.$definition.label,
        description: b.$definition.description,
        input: b.$definition.inputs.reduce((acc, i) => ({ ...acc, [i.id]: i.type }), {}),
        output: b.$definition.outputs.reduce((acc, o) => ({ ...acc, [o.id]: o.type }), {}),
        category: b.category,
    }));

    return ok({
        blocks, // 신규 규격
        list: filteredCatalog, // 기존 규격 (하위 호환성)
    });
};

export const main = withMiddleware(handler);
