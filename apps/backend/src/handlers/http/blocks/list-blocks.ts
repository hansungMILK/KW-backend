import { blockCatalogService } from '../../../services/block-catalog-service';
import { withMiddleware } from '../../../utils/middleware';
import { ok } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * GET /blocks/0/list?cores=1&limit=-1
 * Caller: libs/flows/src/api/blocks.ts → listBlocks()
 *
 * Returns: { list: BlockViewWithFrontend[] }
 *
 * Utility blocks (frontend-only) are hardcoded here.
 * Backend blocks come from the block CATALOG (shorts-pack registers there at startup).
 * block-executor still reads from REGISTRY (separate concern).
 */

interface BlockDef {
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

// ── Frontend utility blocks (never change — frontend-only, no executor) ───────

const UTILITY_BLOCKS: BlockDef[] = [
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
];

// ── Handler ───────────────────────────────────────────────────────────────────

const handler = async (_event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    // Build backend block list from the catalog (registered at startup by domain packs)
    const catalogDefs = await blockCatalogService.listAvailable();

    const backendBlocks: BlockDef[] = catalogDefs.map(def => {
        // Derive port arrays from PortableSchema properties
        const inputProps = def.inputSchema.properties ?? {};
        const outputProps = def.outputSchema.properties ?? {};
        const configProps = def.configSchema.properties ?? {};

        const inputs = Object.entries(inputProps).map(([id, field]) => ({
            id,
            label: (field as { description?: string }).description ?? id,
            type: (field as { type?: string }).type ?? 'any',
        }));
        const outputs = Object.entries(outputProps).map(([id, field]) => ({
            id,
            label: (field as { description?: string }).description ?? id,
            type: (field as { type?: string }).type ?? 'any',
        }));
        const configSchema = Object.entries(configProps).map(([key, field]) => ({
            key,
            label: (field as { description?: string }).description ?? key,
            type: (field as { type?: string }).type ?? 'text',
            default: (field as { default?: unknown }).default ?? '',
        }));

        return {
            $definition: {
                id: def.id,
                type: def.type,
                label: def.name,
                description: def.description,
                inputs,
                outputs,
                configSchema,
            },
            isFrontend: 0,
            stereo: def.category as 'input' | 'process' | 'output',
            isRunnable: true,
        };
    });

    return ok({ list: [...UTILITY_BLOCKS, ...backendBlocks] });
};

export const main = withMiddleware(handler);
