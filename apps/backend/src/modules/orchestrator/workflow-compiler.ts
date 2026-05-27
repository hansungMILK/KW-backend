import { DEFAULT_WORKFLOW_PACK_REGISTRY } from '../workflow-packs';

import type { ClaudeProposalOutput } from './response-parser';

export type CompileWorkflowPlanResult = { ok: true; data: ClaudeProposalOutput } | { ok: false; error: string };

const VIDEO_OUTPUT_TYPES = new Set(['video', 'mixed']);
const IMAGE_OUTPUT_TYPES = new Set(['image', 'video', 'mixed']);
const AUDIO_OUTPUT_TYPES = new Set(['audio', 'video', 'mixed']);

export function compileWorkflowPlan(data: ClaudeProposalOutput): CompileWorkflowPlanResult {
    const selectedBlocks = new Set(data.plan.selectedBlocks.map(block => block.blockType));
    const requiredCapabilities = new Set(data.plan.requiredCapabilities);

    for (const block of data.blocks) {
        if (!selectedBlocks.has(block.type)) {
            return fail(`${block.type} block is present but not declared in plan.selectedBlocks`);
        }
    }

    for (const edge of data.edges) {
        if (!data.blocks[edge.from] || !data.blocks[edge.to]) {
            return fail(`edge ${edge.from}->${edge.to} points outside blocks array`);
        }
    }

    for (const block of data.blocks) {
        const catalog = DEFAULT_WORKFLOW_PACK_REGISTRY.orchestratorBlocks[block.type];
        if (!catalog) return fail(`unknown block type: ${block.type}`);

        if (
            (block.type === 'media-video' || block.type === 'countryball-video') &&
            !VIDEO_OUTPUT_TYPES.has(data.plan.outputType)
        ) {
            return fail(`${block.type} requires outputType video/mixed`);
        }

        if (
            (block.type === 'media-image' || block.type === 'countryball-image') &&
            !IMAGE_OUTPUT_TYPES.has(data.plan.outputType) &&
            !requiredCapabilities.has('image.generate') &&
            !requiredCapabilities.has('countryball.image')
        ) {
            return fail(`${block.type} requires image.generate capability or image/video/mixed outputType`);
        }

        if (
            (block.type === 'media-tts' || block.type === 'countryball-tts') &&
            !AUDIO_OUTPUT_TYPES.has(data.plan.outputType) &&
            !requiredCapabilities.has('audio.tts') &&
            !requiredCapabilities.has('countryball.tts')
        ) {
            return fail(`${block.type} requires audio.tts capability or audio/video/mixed outputType`);
        }
    }

    if (data.plan.outputType === 'video' && data.blocks.some(block => block.type === 'media-video')) {
        const videoIndex = data.blocks.findIndex(block => block.type === 'media-video');
        const imageIndex = data.blocks.findIndex(block => block.type === 'media-image');
        const ttsIndex = data.blocks.findIndex(block => block.type === 'media-tts');
        const videoParents = new Set(data.edges.filter(edge => edge.to === videoIndex).map(edge => edge.from));

        if (imageIndex < 0 || ttsIndex < 0 || !videoParents.has(imageIndex) || !videoParents.has(ttsIndex)) {
            return fail('media-video requires upstream media-image and media-tts edges');
        }
    }

    if (data.plan.outputType === 'video' && data.blocks.some(block => block.type === 'countryball-video')) {
        const videoIndex = data.blocks.findIndex(block => block.type === 'countryball-video');
        const imageIndex = data.blocks.findIndex(block => block.type === 'countryball-image');
        const ttsIndex = data.blocks.findIndex(block => block.type === 'countryball-tts');
        const videoParents = new Set(data.edges.filter(edge => edge.to === videoIndex).map(edge => edge.from));

        if (imageIndex < 0 || ttsIndex < 0 || !videoParents.has(imageIndex) || !videoParents.has(ttsIndex)) {
            return fail('countryball-video requires upstream countryball-image and countryball-tts edges');
        }
    }

    return { ok: true, data };
}

export function seedRootBlockInputs(data: ClaudeProposalOutput, userMessage: string): ClaudeProposalOutput {
    const trimmedMessage = userMessage.trim();
    if (!trimmedMessage) return data;

    const nodesWithParents = new Set(data.edges.map(edge => edge.to));
    const blocks = data.blocks.map((block, index) => {
        if (nodesWithParents.has(index)) return block;

        if (block.type === 'search' && !hasSeedInput(block.config)) {
            return {
                ...block,
                config: {
                    ...block.config,
                    query: trimmedMessage,
                },
            };
        }

        if ((block.type === 'content' || block.type === 'countryball-script') && !hasSeedInput(block.config)) {
            return {
                ...block,
                config: {
                    ...block.config,
                    topic: trimmedMessage,
                },
            };
        }

        return block;
    });

    return { ...data, blocks };
}

function fail(error: string): CompileWorkflowPlanResult {
    return { ok: false, error };
}

function hasSeedInput(config: Record<string, unknown> | undefined): boolean {
    if (!config) return false;

    for (const key of ['query', 'topic', 'content', 'text']) {
        const value = config[key];
        if (typeof value === 'string' && value.trim().length > 0) return true;
    }

    return Array.isArray(config['keywords']) && config['keywords'].length > 0;
}
