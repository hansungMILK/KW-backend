import type { NodeData } from '../types';

type RecordItem = Record<string, unknown>;

const isRecord = (value: unknown): value is RecordItem =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const firstString = (...values: unknown[]): string | undefined => {
    for (const value of values) {
        if (typeof value === 'string' && value.trim().length > 0) return value;
    }
    return undefined;
};

export const normalizeNodeData = (node: unknown): NodeData => {
    if (!isRecord(node)) return node as NodeData;

    const type = firstString(node.type, node.blockType, node.processType);
    const name = firstString(node.name, node.label);

    return {
        ...node,
        ...(type ? { type } : {}),
        ...(name && !node.name ? { name } : {}),
    } as NodeData;
};

export const normalizeNodeList = (nodes: unknown): NodeData[] =>
    Array.isArray(nodes) ? nodes.map(normalizeNodeData) : [];
