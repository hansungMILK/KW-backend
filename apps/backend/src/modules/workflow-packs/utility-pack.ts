import { contributionFor } from './catalog-helpers';

import type { WorkflowPackManifest } from './types';

export const utilityPack: WorkflowPackManifest = {
    packId: 'utility',
    kind: 'capability',
    displayName: 'Utility',
    description: 'Manual input, preview, delay, and simple text transformation blocks.',
    capabilities: ['input.text', 'input.image', 'output.preview', 'utility.delay', 'text.transform'],
    blocks: [
        contributionFor('input-text'),
        contributionFor('input-image'),
        contributionFor('output-preview'),
        contributionFor('buffer-delay'),
        contributionFor('text-transform'),
    ],
};
