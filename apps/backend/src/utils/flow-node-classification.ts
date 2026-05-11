const isRecord = (value: unknown): value is Record<string, unknown> =>
    value != null && typeof value === 'object' && !Array.isArray(value);

export const getFlowNodeId = (node: unknown): string => {
    if (!isRecord(node)) return '';
    return String(node['id'] ?? node['nodeId'] ?? '');
};

export const getFlowNodeBlockType = (node: unknown): string => {
    if (!isRecord(node)) return '';
    const data = node['data'] as Record<string, unknown> | undefined;
    return String(node['blockType'] ?? data?.['blockType'] ?? node['type'] ?? '');
};

export const isStoredPortNode = (node: unknown): node is Record<string, unknown> =>
    isRecord(node) && node['stereo'] === 'port';

export const isPortLikeFlowNode = (node: unknown): boolean => {
    if (!isRecord(node)) return false;
    const id = getFlowNodeId(node);
    return node['stereo'] === 'port' || id.startsWith('port_');
};

export const isExecutableFlowNode = (node: unknown): node is Record<string, unknown> =>
    isRecord(node) &&
    !isPortLikeFlowNode(node) &&
    getFlowNodeId(node).length > 0 &&
    getFlowNodeBlockType(node).trim().length > 0;

export const sanitizeCanvasNodesForStorage = (nodes: unknown[]): unknown[] =>
    nodes.filter(node => !isPortLikeFlowNode(node));
