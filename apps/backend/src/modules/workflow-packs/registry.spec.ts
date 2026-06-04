import { describe, expect, it } from 'vitest';

import { createDefaultWorkflowPackRegistry, createWorkflowPackRegistry } from './index';
import { BLOCK_TYPES } from '../blocks/types';
import { ALLOWED_BLOCK_TYPES } from '../orchestrator/response-parser';

import type { WorkflowPackManifest } from './types';

const block = (type: string) => ({
    http: {
        $definition: {
            id: `blk-${type}`,
            type,
            label: type,
            description: `${type} block`,
            inputs: [],
            outputs: [{ id: 'out', label: 'Output', type: 'json' }],
            configSchema: [],
        },
        isFrontend: 0 as const,
        stereo: 'process' as const,
        isRunnable: true,
    },
    orchestrator: {
        blockType: type,
        label: type,
        capabilities: ['test.capability'],
        input: 'json',
        output: 'json',
        whenToUse: 'test',
        whenNotToUse: 'test',
    },
});

const pack = (packId: string, type: string): WorkflowPackManifest => ({
    packId,
    kind: 'capability',
    displayName: packId,
    description: packId,
    capabilities: ['test.capability'],
    blocks: [block(type)],
});

describe('workflow pack registry', () => {
    it('rejects duplicate block types across packs', () => {
        expect(() => createWorkflowPackRegistry([pack('a', 'search'), pack('b', 'search')])).toThrow(
            /Duplicate block type: search/
        );
    });

    it('exposes reusable capability blocks separately from Shorts and Longform recipes', () => {
        const registry = createDefaultWorkflowPackRegistry();

        expect(registry.packs.map(item => item.packId)).toEqual([
            'utility',
            'research',
            'text',
            'media',
            'shorts',
            'countryball-shorts',
            'longform',
            'blog',
        ]);
        expect(registry.getPack('media')?.kind).toBe('capability');
        expect(registry.getPack('shorts')?.kind).toBe('recipe');
        expect(registry.getPack('countryball-shorts')?.kind).toBe('recipe');
        expect(registry.getPack('longform')?.kind).toBe('recipe');
        expect(registry.getPack('blog')?.kind).toBe('recipe');

        expect(registry.getBlock('media-image')?.orchestrator.capabilities).toContain('image.generate');
        expect(registry.getBlock('media-video')?.orchestrator.capabilities).toContain('video.compose');
        expect(registry.getBlock('search')?.orchestrator.capabilities).toContain('source.collect');
    });

    it('registers a Shorts recipe that composes reusable capability blocks', () => {
        const registry = createDefaultWorkflowPackRegistry();
        const recipe = registry.getRecipe('shorts.info.v1');

        expect(recipe?.requiredCapabilities).toEqual(
            expect.arrayContaining([
                'source.collect',
                'text.generate',
                'data.structure',
                'quality.review',
                'image.generate',
                'audio.tts',
                'video.compose',
                'metadata.generate',
            ])
        );
        expect(recipe?.defaultBlocks.map(item => item.blockType)).toEqual([
            'search',
            'content',
            'data',
            'analysis',
            'media-image',
            'media-tts',
            'media-video',
            'integration',
        ]);
    });

    it('registers Countryball Shorts as an isolated recipe pack', () => {
        const registry = createDefaultWorkflowPackRegistry();
        const recipe = registry.getRecipe('countryball.shorts.v1');

        expect(recipe?.defaultBlocks.map(item => item.blockType)).toEqual([
            'search',
            'countryball-brief',
            'countryball-angle-lab',
            'countryball-writer-brain',
            'countryball-script',
            'countryball-data',
            'countryball-analysis',
            'countryball-image',
            'countryball-tts',
            'countryball-video',
            'integration',
        ]);
        expect(recipe?.defaultBlocks.map(item => item.blockType)).not.toContain('content');
        expect(recipe?.defaultBlocks.map(item => item.blockType)).not.toContain('media-tts');
        expect(recipe?.defaultBlocks.map(item => item.blockType)).not.toContain('media-video');
    });

    it('registers standalone image and blog writing recipes without video blocks', () => {
        const registry = createDefaultWorkflowPackRegistry();

        expect(registry.getRecipe('image.single.v1')?.defaultBlocks.map(item => item.blockType)).toEqual([
            'content',
            'media-image',
        ]);
        expect(registry.getRecipe('text.blog.v1')?.defaultBlocks.map(item => item.blockType)).toEqual([
            'content',
            'output-preview',
        ]);
        expect(registry.getRecipe('text.url-explainer.v1')?.defaultBlocks.map(item => item.blockType)).toEqual([
            'search',
            'content',
            'output-preview',
        ]);
    });

    it('registers Longform as a recipe pack with longform-specific production blocks', () => {
        const registry = createDefaultWorkflowPackRegistry();
        const recipe = registry.getRecipe('longform.explainer.v1');

        expect(recipe?.defaultBlocks.map(item => item.blockType)).toEqual([
            'longform-source',
            'longform-brief',
            'longform-script',
            'longform-storyboard',
            'longform-scene-json',
            'longform-review',
            'longform-tts',
            'longform-srt-align',
            'longform-motion-compose',
            'longform-render',
            'longform-qa',
            'longform-package',
        ]);
    });

    it('registers Blog v2 as an isolated recipe pack with blog-specific blocks', () => {
        const registry = createDefaultWorkflowPackRegistry();
        const recipe = registry.getRecipe('text.blog.v2');

        expect(recipe?.defaultBlocks.map(item => item.blockType)).toEqual([
            'blog-brief',
            'blog-research',
            'blog-outline',
            'blog-draft',
            'blog-image-plan',
            'blog-images',
            'blog-seo',
            'blog-assemble',
            'blog-export',
        ]);
        // text.blog.v1 must be preserved unchanged alongside v2.
        expect(registry.getRecipe('text.blog.v1')?.defaultBlocks.map(item => item.blockType)).toEqual([
            'content',
            'output-preview',
        ]);
        expect(recipe?.defaultBlocks.map(item => item.blockType)).not.toContain('content');
        expect(recipe?.defaultBlocks.map(item => item.blockType)).not.toContain('media-video');
    });

    it('keeps static block type enums in sync with pack manifests', () => {
        const registry = createDefaultWorkflowPackRegistry();
        const manifestBlockTypes = registry.httpBlocks.map(block => block.$definition.type).sort();

        expect(manifestBlockTypes).toEqual([...ALLOWED_BLOCK_TYPES].sort());
        expect(manifestBlockTypes).toEqual([...BLOCK_TYPES].sort());
    });
});
