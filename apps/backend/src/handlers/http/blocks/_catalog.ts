import { DEFAULT_WORKFLOW_PACK_REGISTRY } from '../../../modules/workflow-packs';
import { toSpecBlock, toSpecBlockDetail } from '../../../modules/workflow-packs/http-block-catalog';

export type { BlockDef, SpecBlockDetail, SpecBlockSummary } from '../../../modules/workflow-packs/http-block-catalog';

export { toSpecBlock, toSpecBlockDetail };

export const BLOCK_CATALOG = DEFAULT_WORKFLOW_PACK_REGISTRY.httpBlocks;

export const findBlockByType = (blockType: string) => DEFAULT_WORKFLOW_PACK_REGISTRY.getBlock(blockType)?.http;
