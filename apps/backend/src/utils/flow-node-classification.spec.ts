import { describe, expect, it } from 'vitest';

import {
    getFlowNodeBlockType,
    isExecutableFlowNode,
    isPortLikeFlowNode,
    sanitizeCanvasNodesForStorage,
} from './flow-node-classification';

describe('flow node classification', () => {
    it('treats port_ pseudo nodes as non-executable even when stereo is missing', () => {
        const malformedPort = {
            id: 'port_node-1_out_out',
            position: { x: 20, y: 40 },
        };

        expect(isPortLikeFlowNode(malformedPort)).toBe(true);
        expect(isExecutableFlowNode(malformedPort)).toBe(false);
    });

    it('keeps only real runnable canvas nodes for storage and run snapshots', () => {
        const nodes = [
            { id: 'node-search', type: 'search', position: { x: 0, y: 0 } },
            { id: 'port_node-search_out_out', position: { x: 0, y: 120 } },
            {
                id: 'port_node-search_out_out',
                stereo: 'port',
                parentId: 'node-search',
                direction: 'out',
                name: 'out',
            },
            { id: 'node-content', data: { blockType: 'content' }, position: { x: 260, y: 0 } },
        ];

        expect(sanitizeCanvasNodesForStorage(nodes)).toEqual([
            { id: 'node-search', type: 'search', position: { x: 0, y: 0 } },
            { id: 'node-content', data: { blockType: 'content' }, position: { x: 260, y: 0 } },
        ]);
        expect(nodes.filter(isExecutableFlowNode).map(getFlowNodeBlockType)).toEqual(['search', 'content']);
    });
});
