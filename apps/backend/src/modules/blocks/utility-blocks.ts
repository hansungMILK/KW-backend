import type { BlockExecutor, BlockExecutorResult } from './types';

const now = () => Date.now();

const textPacket = (value: string) => ({
    value,
    type: 'text',
    timestamp: now(),
});

const imagePacket = (value: string) => ({
    value,
    type: 'image',
    timestamp: now(),
});

const pickText = (config?: Record<string, unknown>): string => {
    const value = config?.['text'] ?? config?.['value'] ?? config?.['content'] ?? '';
    return typeof value === 'string' ? value : String(value);
};

const pickImage = (config?: Record<string, unknown>): string => {
    const value = config?.['imageData'] ?? config?.['imageUrl'] ?? config?.['value'] ?? '';
    return typeof value === 'string' ? value : String(value);
};

export const inputTextBlock: BlockExecutor = {
    blockType: 'input-text',

    async execute(_input: unknown, config?: Record<string, unknown>): Promise<BlockExecutorResult> {
        const start = Date.now();
        const text = pickText(config);
        const out = textPacket(text);
        return {
            output: {
                text,
                content: text,
                value: text,
                out,
            },
            durationMs: Date.now() - start,
        };
    },
};

export const inputImageBlock: BlockExecutor = {
    blockType: 'input-image',

    async execute(_input: unknown, config?: Record<string, unknown>): Promise<BlockExecutorResult> {
        const start = Date.now();
        const imageData = pickImage(config);
        if (!imageData) throw new Error('input-image requires imageData or imageUrl');
        const out = imagePacket(imageData);
        return {
            output: {
                imageData,
                value: imageData,
                out,
            },
            durationMs: Date.now() - start,
        };
    },
};

export const outputPreviewBlock: BlockExecutor = {
    blockType: 'output-preview',

    async execute(input: unknown): Promise<BlockExecutorResult> {
        const start = Date.now();
        const output =
            input && typeof input === 'object' && !Array.isArray(input)
                ? (input as Record<string, unknown>)
                : { value: input };
        return {
            output,
            durationMs: Date.now() - start,
        };
    },
};
