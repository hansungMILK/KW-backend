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

const dataPacket = (value: unknown, type = 'json') => ({
    value,
    type,
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

const pickInputValue = (input: unknown): unknown => {
    if (input && typeof input === 'object' && !Array.isArray(input)) {
        const record = input as Record<string, unknown>;
        return record['in'] ?? record['input'] ?? record['value'] ?? record['text'] ?? record;
    }
    return input;
};

const pickInputText = (input: unknown, config?: Record<string, unknown>): string => {
    const configured = pickText(config);
    if (configured) return configured;

    const value = pickInputValue(input);
    if (typeof value === 'string') return value;
    if (value == null) return '';
    return String(value);
};

const readDelayMs = (config?: Record<string, unknown>): number => {
    const parsed = Number(config?.['delayMs'] ?? 1000);
    if (!Number.isFinite(parsed)) return 1000;
    return Math.min(Math.max(Math.floor(parsed), 0), 10_000);
};

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

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

export const bufferDelayBlock: BlockExecutor = {
    blockType: 'buffer-delay',

    async execute(input: unknown, config?: Record<string, unknown>): Promise<BlockExecutorResult> {
        const start = Date.now();
        const delayMs = readDelayMs(config);
        if (delayMs > 0) await sleep(delayMs);
        const value = pickInputValue(input);
        return {
            output: {
                value,
                out: dataPacket(value),
                delayMs,
            },
            durationMs: Date.now() - start,
        };
    },
};

export const textTransformBlock: BlockExecutor = {
    blockType: 'text-transform',

    async execute(input: unknown, config?: Record<string, unknown>): Promise<BlockExecutorResult> {
        const start = Date.now();
        const mode = String(config?.['mode'] ?? 'uppercase').toLowerCase();
        const text = pickInputText(input, config);
        let transformed = text;

        if (mode === 'lowercase') transformed = text.toLowerCase();
        else if (mode === 'trim') transformed = text.trim();
        else if (mode === 'capitalize') transformed = text.replace(/\b\p{L}/gu, char => char.toUpperCase());
        else transformed = text.toUpperCase();

        return {
            output: {
                text: transformed,
                content: transformed,
                value: transformed,
                out: textPacket(transformed),
            },
            durationMs: Date.now() - start,
        };
    },
};
