import { describe, expect, it } from 'vitest';

import { mergeIncomingCanvasNodesWithExistingMetadata } from './flow-repository';

describe('mergeIncomingCanvasNodesWithExistingMetadata', () => {
    it('preserves execution config when a canvas save omits node metadata', () => {
        const existing = [
            {
                id: 'search-1',
                type: 'search',
                blockType: 'search',
                blockId: 'blk-search',
                name: '링크 내용 수집',
                config: { query: 'https://tikongs.tistory.com/1463', sourceType: 'url' },
                position: { x: 300, y: 100 },
            },
        ];

        const incoming = [
            {
                id: 'search-1',
                type: 'search',
                position: { x: 120, y: 80 },
            },
        ];

        expect(mergeIncomingCanvasNodesWithExistingMetadata(incoming, existing)).toEqual([
            {
                id: 'search-1',
                type: 'search',
                blockType: 'search',
                blockId: 'blk-search',
                name: '링크 내용 수집',
                config: { query: 'https://tikongs.tistory.com/1463', sourceType: 'url' },
                position: { x: 120, y: 80 },
            },
        ]);
    });

    it('uses an explicit incoming config when the user changed node settings', () => {
        const existing = [
            {
                id: 'search-1',
                type: 'search',
                blockType: 'search',
                config: { query: 'old topic' },
            },
        ];

        const incoming = [
            {
                id: 'search-1',
                type: 'search',
                config: { query: 'new topic' },
            },
        ];

        expect(mergeIncomingCanvasNodesWithExistingMetadata(incoming, existing)).toEqual([
            {
                id: 'search-1',
                type: 'search',
                blockType: 'search',
                config: { query: 'new topic' },
            },
        ]);
    });

    it('does not copy metadata across different block types', () => {
        const existing = [
            {
                id: 'node-1',
                type: 'search',
                blockType: 'search',
                config: { query: 'old topic' },
            },
        ];

        const incoming = [
            {
                id: 'node-1',
                type: 'content',
            },
        ];

        expect(mergeIncomingCanvasNodesWithExistingMetadata(incoming, existing)).toEqual([
            {
                id: 'node-1',
                type: 'content',
            },
        ]);
    });
});
