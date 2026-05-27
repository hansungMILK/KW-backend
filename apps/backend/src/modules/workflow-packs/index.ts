import { countryballShortsPack } from './countryball-shorts-pack';
import { longformPack } from './longform-pack';
import { mediaPack } from './media-pack';
import { createWorkflowPackRegistry } from './registry';
import { researchPack } from './research-pack';
import { shortsPack } from './shorts-pack';
import { textPack } from './text-pack';
import { utilityPack } from './utility-pack';

import type { WorkflowPackManifest } from './types';

export const DEFAULT_WORKFLOW_PACKS: WorkflowPackManifest[] = [
    utilityPack,
    researchPack,
    textPack,
    mediaPack,
    shortsPack,
    countryballShortsPack,
    longformPack,
];

export const DEFAULT_WORKFLOW_PACK_REGISTRY = createWorkflowPackRegistry(DEFAULT_WORKFLOW_PACKS);

export const createDefaultWorkflowPackRegistry = () => DEFAULT_WORKFLOW_PACK_REGISTRY;

export const getWorkflowPackCatalogPrompt = (): string =>
    Object.values(DEFAULT_WORKFLOW_PACK_REGISTRY.orchestratorBlocks)
        .map(
            block =>
                `- ${block.blockType}: ${block.label} | capabilities=${block.capabilities.join(
                    ', '
                )} | input=${block.input} | output=${block.output} | use=${block.whenToUse} | avoid=${block.whenNotToUse}`
        )
        .join('\n');

export { createWorkflowPackRegistry } from './registry';
export type {
    BlockCatalogContribution,
    WorkflowOutputKind,
    WorkflowPackBlockCatalogEntry,
    WorkflowPackKind,
    WorkflowPackManifest,
    WorkflowRecipeManifest,
} from './types';
