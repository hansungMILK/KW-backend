import type { WorkflowPackBlockCatalogEntry, WorkflowPackManifest, WorkflowRecipeManifest } from './types';

export interface WorkflowPackRegistry {
    packs: WorkflowPackManifest[];
    httpBlocks: WorkflowPackManifest['blocks'][number]['http'][];
    orchestratorBlocks: Record<string, WorkflowPackBlockCatalogEntry>;
    recipes: WorkflowRecipeManifest[];
    getPack(packId: string): WorkflowPackManifest | undefined;
    getBlock(blockType: string): WorkflowPackManifest['blocks'][number] | undefined;
    getRecipe(recipeId: string): WorkflowRecipeManifest | undefined;
}

export function createWorkflowPackRegistry(packs: WorkflowPackManifest[]): WorkflowPackRegistry {
    const httpBlocks: WorkflowPackManifest['blocks'][number]['http'][] = [];
    const orchestratorBlocks: Record<string, WorkflowPackBlockCatalogEntry> = {};
    const blockContributions: Record<string, WorkflowPackManifest['blocks'][number]> = {};
    const recipes: WorkflowRecipeManifest[] = [];
    const seenBlockTypes = new Set<string>();
    const seenRecipeIds = new Set<string>();

    for (const pack of packs) {
        for (const contribution of pack.blocks) {
            const blockType = contribution.http.$definition.type;
            if (seenBlockTypes.has(blockType)) {
                throw new Error(`Duplicate block type: ${blockType}`);
            }
            seenBlockTypes.add(blockType);
            httpBlocks.push(contribution.http);
            orchestratorBlocks[blockType] = contribution.orchestrator;
            blockContributions[blockType] = contribution;
        }

        for (const recipe of pack.recipes ?? []) {
            if (seenRecipeIds.has(recipe.recipeId)) {
                throw new Error(`Duplicate recipe id: ${recipe.recipeId}`);
            }
            seenRecipeIds.add(recipe.recipeId);
            recipes.push(recipe);
        }
    }

    return {
        packs,
        httpBlocks,
        orchestratorBlocks,
        recipes,
        getPack(packId) {
            return packs.find(pack => pack.packId === packId);
        },
        getBlock(blockType) {
            return blockContributions[blockType];
        },
        getRecipe(recipeId) {
            return recipes.find(recipe => recipe.recipeId === recipeId);
        },
    };
}
