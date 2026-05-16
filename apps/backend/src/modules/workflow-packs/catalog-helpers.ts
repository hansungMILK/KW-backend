import { BLOCK_CATALOG } from './http-block-catalog';
import { ORCHESTRATOR_BLOCK_CATALOG } from './orchestrator-block-catalog';

import type { BlockCatalogContribution } from './types';
import type { AllowedBlockType } from '../orchestrator/response-parser';

export const contributionFor = (blockType: AllowedBlockType): BlockCatalogContribution => {
    const http = BLOCK_CATALOG.find(block => block.$definition.type === blockType);
    const orchestrator = ORCHESTRATOR_BLOCK_CATALOG[blockType];
    if (!http || !orchestrator) {
        throw new Error(`Missing catalog metadata for block type: ${blockType}`);
    }
    return { http, orchestrator };
};
