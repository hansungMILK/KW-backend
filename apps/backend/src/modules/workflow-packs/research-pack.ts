import { contributionFor } from './catalog-helpers';

import type { WorkflowPackManifest } from './types';

export const researchPack: WorkflowPackManifest = {
    packId: 'research',
    kind: 'capability',
    displayName: 'Research',
    description: 'URL extraction, web search, and source collection capability.',
    capabilities: ['source.collect'],
    blocks: [contributionFor('search')],
};
