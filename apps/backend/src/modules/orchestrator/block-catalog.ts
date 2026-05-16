import { DEFAULT_WORKFLOW_PACK_REGISTRY, getWorkflowPackCatalogPrompt } from '../workflow-packs';

import type { AllowedBlockType } from './response-parser';
import type { BlockCatalogEntry, WorkflowCapability } from '../workflow-packs/orchestrator-block-catalog';

export type { WorkflowCapability };
export type { BlockCatalogEntry };

export const ORCHESTRATOR_BLOCK_CATALOG = DEFAULT_WORKFLOW_PACK_REGISTRY.orchestratorBlocks as Record<
    AllowedBlockType,
    BlockCatalogEntry
>;

export const getBlockCatalogPrompt = getWorkflowPackCatalogPrompt;
