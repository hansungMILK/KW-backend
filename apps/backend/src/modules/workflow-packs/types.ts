import type { BlockDef } from './http-block-catalog';
import type { WorkflowCapability } from './orchestrator-block-catalog';

export type WorkflowPackKind = 'capability' | 'recipe';

export type WorkflowOutputKind = 'text' | 'data' | 'image' | 'audio' | 'video' | 'automation' | 'mixed';

export interface WorkflowPackBlockCatalogEntry {
    blockType: string;
    label: string;
    capabilities: string[];
    input: string;
    output: string;
    whenToUse: string;
    whenNotToUse: string;
}

export interface BlockCatalogContribution {
    http: BlockDef;
    orchestrator: WorkflowPackBlockCatalogEntry;
}

export interface WorkflowRecipeManifest {
    recipeId: string;
    displayName: string;
    description: string;
    triggerHints: string[];
    outputType: WorkflowOutputKind;
    requiredCapabilities: WorkflowCapability[];
    defaultBlocks: Array<{
        blockType: string;
        label: string;
        config?: Record<string, unknown>;
    }>;
    defaultEdges: Array<{ from: number; to: number }>;
    costPolicy?: {
        estimatedCostUsd?: number;
        hardCapUsd?: number;
        requiresApproval?: boolean;
    };
}

export interface WorkflowPackManifest {
    packId: string;
    kind: WorkflowPackKind;
    displayName: string;
    description: string;
    capabilities: string[];
    blocks: BlockCatalogContribution[];
    recipes?: WorkflowRecipeManifest[];
    rulepacks?: Array<{ id: string; path: string }>;
    qaRules?: Array<{ id: string; description: string }>;
    renderers?: Array<{ id: string; outputKind: string }>;
    uiExtensions?: Array<{ id: string; outputKind: string }>;
}
