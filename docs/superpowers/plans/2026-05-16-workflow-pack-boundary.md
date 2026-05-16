# Workflow Pack Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Eureka Flow a general-purpose workflow engine by separating core execution from capability packs and recipe packs, without breaking the existing Shorts and Longform production flows.

**Architecture:** Add a pack manifest and registry layer first, then route the HTTP block catalog, orchestrator block catalog, planner prompt, and compiler through that registry. Do not move executor files in the first pass; establish dependency direction first so core can stop knowing Shorts/Longform details directly.

**Tech Stack:** TypeScript, Zod, Vitest, Nx, existing backend block executors, existing HTTP block catalog, existing OpenAI/mock orchestrators, React frontend catalog consumers.

---

## Product Rule

Eureka Flow is not a Shorts-only or Longform-only app. Shorts and Longform are first-party production packs. Research, text/data/quality, utility, and media blocks are reusable capability packs. Core owns execution, graph validation, run state, trace, cost gates, approval gates, asset policy, and generic preview.

## Non-Negotiable Guardrails

- No production behavior should be removed while introducing the pack boundary.
- Existing block IDs must stay stable: `search`, `content`, `data`, `analysis`, `media-image`, `media-tts`, `media-video`, `integration`, and all `longform-*`.
- Do not move files into `packs/` before registry tests prove the boundary.
- Core catalog and compiler may read pack manifests, but core must not import domain recipe internals directly.
- `media-image`, `media-tts`, and `media-video` are generic media capabilities, not Shorts blocks.
- `search` is a generic research capability, not Shorts or Longform-only.
- The generic preview renderer may know only broad output kinds: text, markdown, json, image, image-gallery, audio, video, table. Domain-specific viewers must be pack extensions.
- A normal URL explanation request must not compile to video blocks unless the user asks for Shorts, Longform, MP4, video, Reels, TikTok, or similar final media.

## Current Evidence

- `apps/backend/src/modules/orchestrator/block-catalog.ts` contains a hardcoded orchestrator catalog with utility, research, generic media, Shorts pipeline, and Longform block knowledge in one core file.
- `apps/backend/src/handlers/http/blocks/_catalog.ts` contains a hardcoded HTTP block catalog used by the frontend.
- `apps/backend/src/modules/orchestrator/prompt-templates.ts` embeds Shorts and Longform recipes directly in the core system prompt.
- `apps/backend/src/modules/orchestrator/workflow-compiler.ts` validates against `ORCHESTRATOR_BLOCK_CATALOG` directly.
- `apps/backend/src/modules/blocks/block-registry.ts` imports and registers every executor directly.
- `apps/backend/src/modules/orchestrator/response-parser.ts` and `apps/backend/src/modules/blocks/types.ts` both maintain fixed block type arrays.

## File Map

### New Pack Boundary

- Create: `apps/backend/src/modules/workflow-packs/types.ts`
    - Shared manifest types for capability packs and recipe packs.
- Create: `apps/backend/src/modules/workflow-packs/registry.ts`
    - Loads enabled pack manifests, validates duplicate block IDs, merges HTTP catalog entries, orchestrator entries, recipes, and UI preview descriptors.
- Create: `apps/backend/src/modules/workflow-packs/registry.spec.ts`
    - Unit tests for duplicate detection, disabled packs, block lookup, and recipe lookup.
- Create: `apps/backend/src/modules/workflow-packs/utility-pack.ts`
    - Owns frontend utility block catalog entries.
- Create: `apps/backend/src/modules/workflow-packs/research-pack.ts`
    - Owns `search` capability metadata.
- Create: `apps/backend/src/modules/workflow-packs/text-pack.ts`
    - Owns `content`, `data`, `analysis`, `integration` generic text/data/quality/metadata capability metadata.
- Create: `apps/backend/src/modules/workflow-packs/media-pack.ts`
    - Owns `media-image`, `media-tts`, `media-video` generic media capability metadata.
- Create: `apps/backend/src/modules/workflow-packs/shorts-pack.ts`
    - Owns Shorts recipe metadata and Shorts rulepack references; does not own media executors.
- Create: `apps/backend/src/modules/workflow-packs/longform-pack.ts`
    - Owns Longform recipe metadata and Longform-specific `longform-*` block metadata.
- Create: `apps/backend/src/modules/workflow-packs/index.ts`
    - Public pack registry entry point.

### Existing Backend Files To Modify

- Modify: `apps/backend/src/handlers/http/blocks/_catalog.ts`
    - Replace hardcoded `BLOCK_CATALOG` array with registry-backed `createDefaultWorkflowPackRegistry().httpBlocks`.
- Modify: `apps/backend/src/modules/orchestrator/block-catalog.ts`
    - Replace hardcoded `ORCHESTRATOR_BLOCK_CATALOG` object with registry-backed aggregation.
- Modify: `apps/backend/src/modules/orchestrator/workflow-compiler.ts`
    - Validate block capabilities and recipe compatibility through the registry.
- Modify: `apps/backend/src/modules/orchestrator/prompt-templates.ts`
    - Generate available blocks and available recipes from the registry.
- Modify: `apps/backend/src/modules/orchestrator/response-parser.ts`
    - Keep static Zod enum for now, but add a registry consistency test so it cannot drift from manifests.
- Modify: `apps/backend/src/modules/blocks/types.ts`
    - Keep static Zod enum for now, but add a registry consistency test so executor declarations cannot drift from manifests.
- Modify: `apps/backend/src/modules/blocks/block-registry.ts`
    - Keep executor imports in place for pass one, but add an assertion that executor types match registered executable pack block IDs.

### Frontend Files To Modify

- Modify: `apps/web/src/app/features/flows/components/FlowAgentPanel.tsx`
    - Render proposal settings by content profile/recipe metadata, not by ad hoc Shorts/Longform conditions.
- Modify: `apps/web/src/app/features/flows/components/ContentPreviewModal.tsx`
    - Keep generic preview broad and domain-neutral.
- Modify: `apps/web/src/app/features/flows/components/NodeBlock.tsx`
    - Show only stage-specific compact previews from generic output descriptors.
- Modify: `apps/web/src/app/features/flows/components/DetailPanel.tsx`
    - Keep guide rendering generic; pack-specific help text should come from catalog metadata.

## Pack Model

Use this model as the implementation target:

```ts
export type WorkflowPackKind = 'capability' | 'recipe';

export type WorkflowOutputKind =
    | 'text'
    | 'markdown'
    | 'json'
    | 'table'
    | 'image'
    | 'image-gallery'
    | 'audio'
    | 'video'
    | 'package';

export interface WorkflowRecipeManifest {
    recipeId: string;
    displayName: string;
    description: string;
    triggerHints: string[];
    outputType: 'text' | 'data' | 'image' | 'audio' | 'video' | 'automation' | 'mixed';
    requiredCapabilities: string[];
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
    renderers?: Array<{ id: string; outputKind: WorkflowOutputKind }>;
    uiExtensions?: Array<{ id: string; outputKind: WorkflowOutputKind }>;
}
```

## Task 1: Add Pack Manifest Contract And Registry Tests

**Files:**

- Create: `apps/backend/src/modules/workflow-packs/types.ts`
- Create: `apps/backend/src/modules/workflow-packs/registry.ts`
- Create: `apps/backend/src/modules/workflow-packs/registry.spec.ts`

- [ ] **Step 1: Write failing duplicate block test**

Create `apps/backend/src/modules/workflow-packs/registry.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { createWorkflowPackRegistry } from './registry';

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
});
```

- [ ] **Step 2: Run test and confirm RED**

Run:

```bash
npx nx run @flows/backend:test --skip-nx-cache -- --run src/modules/workflow-packs/registry.spec.ts
```

Expected: FAIL because `workflow-packs/registry.ts` does not exist.

- [ ] **Step 3: Implement minimal manifest types**

Create `apps/backend/src/modules/workflow-packs/types.ts`:

```ts
import type { BlockDef } from '../../handlers/http/blocks/_catalog';
import type { BlockCatalogEntry } from '../orchestrator/block-catalog';

export type WorkflowPackKind = 'capability' | 'recipe';

export interface BlockCatalogContribution {
    http: BlockDef;
    orchestrator: BlockCatalogEntry;
}

export interface WorkflowRecipeManifest {
    recipeId: string;
    displayName: string;
    description: string;
    triggerHints: string[];
    outputType: 'text' | 'data' | 'image' | 'audio' | 'video' | 'automation' | 'mixed';
    requiredCapabilities: string[];
    defaultBlocks: Array<{ blockType: string; label: string; config?: Record<string, unknown> }>;
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
```

- [ ] **Step 4: Export `BlockCatalogEntry`**

Modify `apps/backend/src/modules/orchestrator/block-catalog.ts`:

```ts
export interface BlockCatalogEntry {
    blockType: AllowedBlockType;
    label: string;
    capabilities: WorkflowCapability[];
    input: string;
    output: string;
    whenToUse: string;
    whenNotToUse: string;
}
```

- [ ] **Step 5: Implement minimal registry**

Create `apps/backend/src/modules/workflow-packs/registry.ts`:

```ts
import type { BlockDef } from '../../handlers/http/blocks/_catalog';
import type { AllowedBlockType } from '../orchestrator/response-parser';
import type { BlockCatalogEntry } from '../orchestrator/block-catalog';
import type { WorkflowPackManifest, WorkflowRecipeManifest } from './types';

export interface WorkflowPackRegistry {
    packs: WorkflowPackManifest[];
    httpBlocks: BlockDef[];
    orchestratorBlocks: Record<AllowedBlockType, BlockCatalogEntry>;
    recipes: WorkflowRecipeManifest[];
    getBlock(blockType: string): BlockCatalogEntry | undefined;
    getRecipe(recipeId: string): WorkflowRecipeManifest | undefined;
}

export function createWorkflowPackRegistry(packs: WorkflowPackManifest[]): WorkflowPackRegistry {
    const httpBlocks: BlockDef[] = [];
    const orchestratorBlocks = {} as Record<AllowedBlockType, BlockCatalogEntry>;
    const recipes: WorkflowRecipeManifest[] = [];
    const seenBlockTypes = new Set<string>();
    const seenRecipes = new Set<string>();

    for (const pack of packs) {
        for (const contribution of pack.blocks) {
            const blockType = contribution.http.$definition.type;
            if (seenBlockTypes.has(blockType)) {
                throw new Error(`Duplicate block type: ${blockType}`);
            }
            seenBlockTypes.add(blockType);
            httpBlocks.push(contribution.http);
            orchestratorBlocks[blockType as AllowedBlockType] = contribution.orchestrator;
        }

        for (const recipe of pack.recipes ?? []) {
            if (seenRecipes.has(recipe.recipeId)) {
                throw new Error(`Duplicate recipe id: ${recipe.recipeId}`);
            }
            seenRecipes.add(recipe.recipeId);
            recipes.push(recipe);
        }
    }

    return {
        packs,
        httpBlocks,
        orchestratorBlocks,
        recipes,
        getBlock(blockType) {
            return orchestratorBlocks[blockType as AllowedBlockType];
        },
        getRecipe(recipeId) {
            return recipes.find(recipe => recipe.recipeId === recipeId);
        },
    };
}
```

- [ ] **Step 6: Run registry test and confirm GREEN**

Run:

```bash
npx nx run @flows/backend:test --skip-nx-cache -- --run src/modules/workflow-packs/registry.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/modules/workflow-packs apps/backend/src/modules/orchestrator/block-catalog.ts
git commit -m "refactor: add workflow pack registry contract"
```

## Task 2: Extract Capability Pack Manifests Without Behavior Change

**Files:**

- Create: `apps/backend/src/modules/workflow-packs/utility-pack.ts`
- Create: `apps/backend/src/modules/workflow-packs/research-pack.ts`
- Create: `apps/backend/src/modules/workflow-packs/text-pack.ts`
- Create: `apps/backend/src/modules/workflow-packs/media-pack.ts`
- Test: `apps/backend/src/modules/workflow-packs/registry.spec.ts`

- [ ] **Step 1: Add catalog parity test**

Append to `registry.spec.ts`:

```ts
import { createDefaultWorkflowPackRegistry } from './index';
import { ALLOWED_BLOCK_TYPES } from '../orchestrator/response-parser';

it('default capability manifests expose all non-longform reusable block ids', () => {
    const registry = createDefaultWorkflowPackRegistry();
    const reusableTypes = [
        'input-text',
        'input-image',
        'output-preview',
        'buffer-delay',
        'text-transform',
        'search',
        'content',
        'data',
        'analysis',
        'media-image',
        'media-tts',
        'media-video',
        'integration',
    ];

    expect(registry.httpBlocks.map(block => block.$definition.type)).toEqual(expect.arrayContaining(reusableTypes));
    expect(Object.keys(registry.orchestratorBlocks)).toEqual(expect.arrayContaining(reusableTypes));
    expect(ALLOWED_BLOCK_TYPES).toEqual(expect.arrayContaining(reusableTypes));
});
```

- [ ] **Step 2: Run and confirm RED**

```bash
npx nx run @flows/backend:test --skip-nx-cache -- --run src/modules/workflow-packs/registry.spec.ts
```

Expected: FAIL because pack manifests and `index.ts` do not exist.

- [ ] **Step 3: Move utility block metadata into `utility-pack.ts`**

Create `apps/backend/src/modules/workflow-packs/utility-pack.ts` with the five utility block contributions copied from `_catalog.ts` and `block-catalog.ts`:

```ts
import type { WorkflowPackManifest } from './types';

export const utilityPack: WorkflowPackManifest = {
    packId: 'utility',
    kind: 'capability',
    displayName: 'Utility',
    description: 'Manual input, preview, delay, and simple text transformation blocks.',
    capabilities: ['input.text', 'input.image', 'output.preview', 'utility.delay', 'text.transform'],
    blocks: [
        inputTextContribution,
        inputImageContribution,
        outputPreviewContribution,
        bufferDelayContribution,
        textTransformContribution,
    ],
};
```

In the same file, define `inputTextContribution`, `inputImageContribution`, `outputPreviewContribution`, `bufferDelayContribution`, and `textTransformContribution` by moving the exact existing HTTP and orchestrator metadata for those block types. Do not rename labels in this task.

- [ ] **Step 4: Move research block metadata into `research-pack.ts`**

Create `apps/backend/src/modules/workflow-packs/research-pack.ts` with:

```ts
import type { WorkflowPackManifest } from './types';

export const researchPack: WorkflowPackManifest = {
    packId: 'research',
    kind: 'capability',
    displayName: 'Research',
    description: 'URL extraction, web search, and source collection capability.',
    capabilities: ['source.collect'],
    blocks: [searchContribution],
};
```

In the same file, define `searchContribution` by moving the exact existing HTTP and orchestrator metadata for `search`.

- [ ] **Step 5: Move text/data/quality block metadata into `text-pack.ts`**

Create `apps/backend/src/modules/workflow-packs/text-pack.ts` with:

```ts
import type { WorkflowPackManifest } from './types';

export const textPack: WorkflowPackManifest = {
    packId: 'text',
    kind: 'capability',
    displayName: 'Text and Data',
    description: 'Text generation, data normalization, quality review, and metadata output.',
    capabilities: ['text.generate', 'data.structure', 'quality.review', 'metadata.generate'],
    blocks: [contentContribution, dataContribution, analysisContribution, integrationContribution],
};
```

In the same file, define `contentContribution`, `dataContribution`, `analysisContribution`, and `integrationContribution` by moving the exact existing HTTP and orchestrator metadata for those block types.

- [ ] **Step 6: Move media block metadata into `media-pack.ts`**

Create `apps/backend/src/modules/workflow-packs/media-pack.ts` with:

```ts
import type { WorkflowPackManifest } from './types';

export const mediaPack: WorkflowPackManifest = {
    packId: 'media',
    kind: 'capability',
    displayName: 'Media',
    description: 'Generic image, speech, and video composition capabilities shared by multiple recipes.',
    capabilities: ['image.generate', 'audio.tts', 'video.compose'],
    blocks: [mediaImageContribution, mediaTtsContribution, mediaVideoContribution],
};
```

In the same file, define `mediaImageContribution`, `mediaTtsContribution`, and `mediaVideoContribution` by moving the exact existing HTTP and orchestrator metadata for those block types.

- [ ] **Step 7: Create default registry index**

Create `apps/backend/src/modules/workflow-packs/index.ts`:

```ts
import { mediaPack } from './media-pack';
import { researchPack } from './research-pack';
import { textPack } from './text-pack';
import { utilityPack } from './utility-pack';
import { createWorkflowPackRegistry } from './registry';

export const DEFAULT_WORKFLOW_PACKS = [utilityPack, researchPack, textPack, mediaPack];

export function createDefaultWorkflowPackRegistry() {
    return createWorkflowPackRegistry(DEFAULT_WORKFLOW_PACKS);
}

export { createWorkflowPackRegistry } from './registry';
export type { WorkflowPackManifest, WorkflowRecipeManifest } from './types';
```

- [ ] **Step 8: Run test and confirm GREEN**

```bash
npx nx run @flows/backend:test --skip-nx-cache -- --run src/modules/workflow-packs/registry.spec.ts
```

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/modules/workflow-packs
git commit -m "refactor: extract reusable capability packs"
```

## Task 3: Extract Shorts And Longform Recipe Packs

**Files:**

- Create: `apps/backend/src/modules/workflow-packs/shorts-pack.ts`
- Create: `apps/backend/src/modules/workflow-packs/longform-pack.ts`
- Modify: `apps/backend/src/modules/workflow-packs/index.ts`
- Test: `apps/backend/src/modules/workflow-packs/registry.spec.ts`

- [ ] **Step 1: Add recipe selection tests**

Append to `registry.spec.ts`:

```ts
it('registers shorts as a recipe pack that depends on reusable capabilities', () => {
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
    expect(recipe?.defaultBlocks.map(block => block.blockType)).toEqual([
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

it('registers longform as a recipe pack with longform-specific blocks', () => {
    const registry = createDefaultWorkflowPackRegistry();
    const recipe = registry.getRecipe('longform.explainer.v1');

    expect(recipe?.defaultBlocks.map(block => block.blockType)).toEqual([
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
```

- [ ] **Step 2: Run and confirm RED**

```bash
npx nx run @flows/backend:test --skip-nx-cache -- --run src/modules/workflow-packs/registry.spec.ts
```

- [ ] **Step 3: Create `shorts-pack.ts`**

Create `apps/backend/src/modules/workflow-packs/shorts-pack.ts`:

```ts
import type { WorkflowPackManifest } from './types';

export const shortsPack: WorkflowPackManifest = {
    packId: 'shorts',
    kind: 'recipe',
    displayName: 'Shorts Production',
    description: 'Korean short-form video recipe using research, script, image, TTS, video, and metadata capabilities.',
    capabilities: [],
    blocks: [],
    recipes: [
        {
            recipeId: 'shorts.info.v1',
            displayName: '정보전달 쇼츠',
            description: 'Source-backed informational Shorts production flow.',
            triggerHints: ['쇼츠', 'shorts', 'reels', '틱톡', '유튜브 쇼츠', '1분 영상'],
            outputType: 'video',
            requiredCapabilities: [
                'source.collect',
                'text.generate',
                'data.structure',
                'quality.review',
                'image.generate',
                'audio.tts',
                'video.compose',
                'metadata.generate',
            ],
            defaultBlocks: [
                { blockType: 'search', label: '자료 수집' },
                {
                    blockType: 'content',
                    label: '스크립트 생성',
                    config: { format: 'shorts', scenes: 12, durationSec: 60 },
                },
                { blockType: 'data', label: '데이터 정규화' },
                { blockType: 'analysis', label: '품질 검수', config: { mode: 'safety' } },
                { blockType: 'media-image', label: '이미지 생성', config: { count: 12, imageQuality: 'medium' } },
                { blockType: 'media-tts', label: '음성 생성', config: { lang: 'ko' } },
                { blockType: 'media-video', label: '영상 합성', config: { format: '9:16', backgroundMusic: true } },
                { blockType: 'integration', label: '메타데이터 생성' },
            ],
            defaultEdges: [
                { from: 0, to: 1 },
                { from: 1, to: 2 },
                { from: 2, to: 3 },
                { from: 3, to: 4 },
                { from: 3, to: 5 },
                { from: 4, to: 6 },
                { from: 5, to: 6 },
                { from: 6, to: 7 },
            ],
            costPolicy: { estimatedCostUsd: 0.9, hardCapUsd: 2, requiresApproval: true },
        },
    ],
    rulepacks: [
        { id: 'base-shorts', path: 'apps/backend/src/modules/shorts/rulepacks/base-shorts-rulepack.ts' },
        { id: 'script-tone', path: 'apps/backend/src/modules/shorts/rulepacks/script-tone-rulepack.ts' },
    ],
};
```

- [ ] **Step 4: Create `longform-pack.ts`**

Create `apps/backend/src/modules/workflow-packs/longform-pack.ts` by moving the `longform-*` block metadata from existing catalogs and adding:

```ts
export const longformPack: WorkflowPackManifest = {
    packId: 'longform',
    kind: 'recipe',
    displayName: 'Longform Production',
    description:
        'Gate A/B longform production with source digest, review, ElevenLabs TTS, SRT alignment, Hyperframes motion, render, QA, and package.',
    capabilities: [
        'longform.source',
        'longform.brief',
        'longform.script',
        'longform.storyboard',
        'longform.scene-json',
        'longform.review',
        'longform.srt-align',
        'longform.motion-compose',
        'longform.render',
        'longform.qa',
        'longform.package',
    ],
    blocks: [
        longformSourceContribution,
        longformBriefContribution,
        longformScriptContribution,
        longformStoryboardContribution,
        longformSceneJsonContribution,
        longformReviewContribution,
        longformTtsContribution,
        longformSrtAlignContribution,
        longformMotionComposeContribution,
        longformRenderContribution,
        longformQaContribution,
        longformPackageContribution,
    ],
    recipes: [
        {
            recipeId: 'longform.explainer.v1',
            displayName: '롱폼 해설',
            description: 'Reviewed longform explainer production flow.',
            triggerHints: ['롱폼', 'longform', '긴 영상', '5분 영상', '유튜브 롱폼'],
            outputType: 'video',
            requiredCapabilities: [
                'longform.source',
                'longform.brief',
                'longform.script',
                'longform.storyboard',
                'longform.scene-json',
                'longform.review',
                'audio.tts',
                'longform.srt-align',
                'longform.motion-compose',
                'longform.render',
                'longform.qa',
                'longform.package',
            ],
            defaultBlocks: [
                { blockType: 'longform-source', label: '롱폼 자료 수집', config: { mode: 'longform-gate-a' } },
                { blockType: 'longform-brief', label: '롱폼 관점 설계', config: { mode: 'longform-gate-a' } },
                { blockType: 'longform-script', label: '롱폼 대본 작성', config: { mode: 'longform-gate-a' } },
                { blockType: 'longform-storyboard', label: '롱폼 스토리보드', config: { mode: 'longform-gate-a' } },
                {
                    blockType: 'longform-scene-json',
                    label: '롱폼 장면 계약',
                    config: { mode: 'longform-gate-a', renderer: 'hyperframes' },
                },
                { blockType: 'longform-review', label: '롱폼 사용자 검수', config: { mode: 'longform-gate-a' } },
                {
                    blockType: 'longform-tts',
                    label: '롱폼 음성 생성',
                    config: { mode: 'longform-gate-b', approvalRequired: true, mediaExecutionAllowed: false },
                },
                {
                    blockType: 'longform-srt-align',
                    label: '롱폼 자막 정렬',
                    config: { mode: 'longform-gate-b', approvalRequired: true, mediaExecutionAllowed: false },
                },
                {
                    blockType: 'longform-motion-compose',
                    label: '롱폼 모션 설계',
                    config: { mode: 'longform-gate-b', approvalRequired: true, mediaExecutionAllowed: false },
                },
                {
                    blockType: 'longform-render',
                    label: '롱폼 2K 렌더',
                    config: {
                        mode: 'longform-gate-b',
                        renderer: 'hyperframes',
                        approvalRequired: true,
                        mediaExecutionAllowed: false,
                    },
                },
                {
                    blockType: 'longform-qa',
                    label: '롱폼 QA',
                    config: { mode: 'longform-gate-b', approvalRequired: true, mediaExecutionAllowed: false },
                },
                {
                    blockType: 'longform-package',
                    label: '롱폼 패키지',
                    config: { mode: 'longform-gate-b', approvalRequired: true, mediaExecutionAllowed: false },
                },
            ],
            defaultEdges: [
                { from: 0, to: 1 },
                { from: 1, to: 2 },
                { from: 2, to: 3 },
                { from: 3, to: 4 },
                { from: 4, to: 5 },
                { from: 5, to: 6 },
                { from: 6, to: 7 },
                { from: 7, to: 8 },
                { from: 8, to: 9 },
                { from: 9, to: 10 },
                { from: 10, to: 11 },
            ],
            costPolicy: { estimatedCostUsd: 0.82, hardCapUsd: 5, requiresApproval: true },
        },
    ],
};
```

In the same file, define each `longform*Contribution` by moving the exact existing HTTP and orchestrator metadata for its matching `longform-*` block type.

- [ ] **Step 5: Add recipe packs to default registry**

Modify `apps/backend/src/modules/workflow-packs/index.ts`:

```ts
import { longformPack } from './longform-pack';
import { shortsPack } from './shorts-pack';

export const DEFAULT_WORKFLOW_PACKS = [utilityPack, researchPack, textPack, mediaPack, shortsPack, longformPack];
```

- [ ] **Step 6: Run test and confirm GREEN**

```bash
npx nx run @flows/backend:test --skip-nx-cache -- --run src/modules/workflow-packs/registry.spec.ts
```

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/modules/workflow-packs
git commit -m "refactor: register shorts and longform recipe packs"
```

## Task 4: Route HTTP And Orchestrator Catalogs Through Packs

**Files:**

- Modify: `apps/backend/src/handlers/http/blocks/_catalog.ts`
- Modify: `apps/backend/src/modules/orchestrator/block-catalog.ts`
- Test: `apps/backend/src/handlers/http/blocks/_catalog.spec.ts`
- Test: `apps/backend/src/modules/orchestrator/workflow-compiler.spec.ts`

- [ ] **Step 1: Add catalog parity tests**

Add to `_catalog.spec.ts`:

```ts
it('serves the block catalog from workflow packs', () => {
    const blockTypes = BLOCK_CATALOG.map(block => block.$definition.type);

    expect(blockTypes).toContain('search');
    expect(blockTypes).toContain('media-image');
    expect(blockTypes).toContain('longform-source');
    expect(new Set(blockTypes).size).toBe(blockTypes.length);
});
```

Add to `workflow-compiler.spec.ts`:

```ts
it('keeps generic URL explanation text-oriented instead of attaching video blocks', () => {
    const result = compileWorkflowPlan({
        plan: {
            goal: '링크 내용을 설명한다',
            outputType: 'text',
            planType: 'pipeline',
            requiredCapabilities: ['source.collect', 'text.generate'],
            selectedBlocks: [
                { blockType: 'search', reason: 'URL을 수집한다' },
                { blockType: 'content', reason: '설명문을 작성한다' },
            ],
            rejectedBlocks: [{ blockType: 'media-video', reason: '영상 요청이 아니다' }],
            assumptions: [],
        },
        blocks: [
            { type: 'search', label: '링크 수집', config: {} },
            { type: 'content', label: '설명 작성', config: { mode: 'explain' } },
        ],
        edges: [{ from: 0, to: 1 }],
        estimatedCostUsd: 0.04,
        summary: '링크 설명',
    });

    expect(result.ok).toBe(true);
});
```

- [ ] **Step 2: Run and confirm current behavior**

```bash
npx nx run @flows/backend:test --skip-nx-cache -- --run src/handlers/http/blocks/_catalog.spec.ts src/modules/orchestrator/workflow-compiler.spec.ts
```

- [ ] **Step 3: Replace HTTP catalog literal with registry output**

Modify `apps/backend/src/handlers/http/blocks/_catalog.ts`:

```ts
import { createDefaultWorkflowPackRegistry } from '../../../modules/workflow-packs';

export const BLOCK_CATALOG: BlockDef[] = createDefaultWorkflowPackRegistry().httpBlocks;
```

Remove only the literal array after all definitions have been copied to pack manifests.

- [ ] **Step 4: Replace orchestrator catalog literal with registry output**

Modify `apps/backend/src/modules/orchestrator/block-catalog.ts`:

```ts
import { createDefaultWorkflowPackRegistry } from '../workflow-packs';

export const ORCHESTRATOR_BLOCK_CATALOG = createDefaultWorkflowPackRegistry().orchestratorBlocks;
```

Keep `getBlockCatalogPrompt()` unchanged except that it now reads the registry-backed object.

- [ ] **Step 5: Run catalog tests**

```bash
npx nx run @flows/backend:test --skip-nx-cache -- --run src/handlers/http/blocks/_catalog.spec.ts src/modules/orchestrator/workflow-compiler.spec.ts src/modules/workflow-packs/registry.spec.ts
```

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/handlers/http/blocks/_catalog.ts apps/backend/src/modules/orchestrator/block-catalog.ts apps/backend/src/modules/workflow-packs apps/backend/src/handlers/http/blocks/_catalog.spec.ts apps/backend/src/modules/orchestrator/workflow-compiler.spec.ts
git commit -m "refactor: source block catalogs from workflow packs"
```

## Task 5: Make Planner Prompt Recipe-Aware

**Files:**

- Modify: `apps/backend/src/modules/orchestrator/prompt-templates.ts`
- Modify: `apps/backend/src/modules/orchestrator/block-catalog.ts`
- Test: `apps/backend/src/modules/orchestrator/prompt-templates.spec.ts`

- [ ] **Step 1: Add prompt test that recipes are described separately from blocks**

Create or extend `prompt-templates.spec.ts`:

```ts
import { ORCHESTRATOR_SYSTEM_PROMPT } from './prompt-templates';

describe('orchestrator prompt pack boundary', () => {
    it('describes recipes separately from reusable blocks', () => {
        expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain('Available Recipes');
        expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain('shorts.info.v1');
        expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain('longform.explainer.v1');
        expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain('Reusable Capability Blocks');
    });
});
```

- [ ] **Step 2: Run and confirm RED**

```bash
npx nx run @flows/backend:test --skip-nx-cache -- --run src/modules/orchestrator/prompt-templates.spec.ts
```

- [ ] **Step 3: Add recipe prompt generator**

Add to `apps/backend/src/modules/orchestrator/block-catalog.ts`:

```ts
export const getRecipeCatalogPrompt = (): string =>
    createDefaultWorkflowPackRegistry()
        .recipes.map(
            recipe =>
                `- ${recipe.recipeId}: ${recipe.displayName} | outputType=${recipe.outputType} | triggers=${recipe.triggerHints.join(
                    ', '
                )} | capabilities=${recipe.requiredCapabilities.join(', ')}`
        )
        .join('\n');
```

- [ ] **Step 4: Update prompt sections**

Modify `apps/backend/src/modules/orchestrator/prompt-templates.ts`:

```ts
import { getBlockCatalogPrompt, getRecipeCatalogPrompt } from './block-catalog';
```

Then split:

```ts
## Available Recipes

${getRecipeCatalogPrompt()}

## Reusable Capability Blocks

${getBlockCatalogPrompt()}
```

Keep existing few-shot examples until Task 6; this task only changes source of truth.

- [ ] **Step 5: Run prompt tests**

```bash
npx nx run @flows/backend:test --skip-nx-cache -- --run src/modules/orchestrator/prompt-templates.spec.ts
```

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/modules/orchestrator/block-catalog.ts apps/backend/src/modules/orchestrator/prompt-templates.ts apps/backend/src/modules/orchestrator/prompt-templates.spec.ts
git commit -m "refactor: expose recipes in orchestrator prompt"
```

## Task 6: Add Import Boundary Tests

**Files:**

- Create: `apps/backend/src/modules/workflow-packs/pack-boundary.spec.ts`

- [ ] **Step 1: Add a test that core files do not import domain internals**

Create `apps/backend/src/modules/workflow-packs/pack-boundary.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = join(__dirname, '../../../../../..');

const coreFiles = [
    'apps/backend/src/modules/orchestrator/prompt-templates.ts',
    'apps/backend/src/modules/orchestrator/workflow-compiler.ts',
    'apps/backend/src/modules/orchestrator/block-catalog.ts',
    'apps/backend/src/handlers/http/blocks/_catalog.ts',
];

describe('workflow pack import boundaries', () => {
    it('keeps core catalog and compiler from importing domain internals directly', () => {
        for (const relativePath of coreFiles) {
            const source = readFileSync(join(repoRoot, relativePath), 'utf8');
            expect(source).not.toMatch(/from ['"].*modules\/shorts\//);
            expect(source).not.toMatch(/from ['"].*longform-blocks/);
            expect(source).not.toMatch(/from ['"].*longform-gate-a/);
        }
    });
});
```

- [ ] **Step 2: Run boundary test**

```bash
npx nx run @flows/backend:test --skip-nx-cache -- --run src/modules/workflow-packs/pack-boundary.spec.ts
```

- [ ] **Step 3: Fix any direct import violations**

Only fix files listed in the failing assertion. Acceptable imports:

```ts
import { createDefaultWorkflowPackRegistry } from '../workflow-packs';
```

Unacceptable imports from core:

```ts
import { buildLongformGateAWorkflow } from './longform-gate-a';
import { getBaseShortsRulepack } from '../shorts/rulepacks/base-shorts-rulepack';
```

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/modules/workflow-packs/pack-boundary.spec.ts apps/backend/src/modules/orchestrator apps/backend/src/handlers/http/blocks/_catalog.ts
git commit -m "test: enforce workflow pack boundaries"
```

## Task 7: Route Compiler Through Recipe Compatibility

**Files:**

- Modify: `apps/backend/src/modules/orchestrator/workflow-compiler.ts`
- Test: `apps/backend/src/modules/orchestrator/workflow-compiler.spec.ts`

- [ ] **Step 1: Add tests for accidental recipe mixing**

Add to `workflow-compiler.spec.ts`:

```ts
it('rejects a text-only request that includes media-video without video output', () => {
    const result = compileWorkflowPlan({
        plan: {
            goal: '링크 설명',
            outputType: 'text',
            planType: 'pipeline',
            requiredCapabilities: ['source.collect', 'text.generate'],
            selectedBlocks: [
                { blockType: 'search', reason: '수집' },
                { blockType: 'content', reason: '작성' },
                { blockType: 'media-video', reason: '잘못 추가됨' },
            ],
            rejectedBlocks: [],
            assumptions: [],
        },
        blocks: [
            { type: 'search', label: '수집', config: {} },
            { type: 'content', label: '작성', config: {} },
            { type: 'media-video', label: '영상', config: {} },
        ],
        edges: [
            { from: 0, to: 1 },
            { from: 1, to: 2 },
        ],
        estimatedCostUsd: 0.1,
        summary: 'bad',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('media-video requires outputType video/mixed');
});
```

- [ ] **Step 2: Run compiler tests**

```bash
npx nx run @flows/backend:test --skip-nx-cache -- --run src/modules/orchestrator/workflow-compiler.spec.ts
```

- [ ] **Step 3: Replace direct catalog read with registry lookup**

In `workflow-compiler.ts`, replace:

```ts
const catalog = ORCHESTRATOR_BLOCK_CATALOG[block.type];
```

with:

```ts
const catalog = createDefaultWorkflowPackRegistry().getBlock(block.type);
```

Import:

```ts
import { createDefaultWorkflowPackRegistry } from '../workflow-packs';
```

- [ ] **Step 4: Run compiler tests again**

```bash
npx nx run @flows/backend:test --skip-nx-cache -- --run src/modules/orchestrator/workflow-compiler.spec.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/orchestrator/workflow-compiler.ts apps/backend/src/modules/orchestrator/workflow-compiler.spec.ts
git commit -m "refactor: validate workflow plans through pack registry"
```

## Task 8: Frontend Catalog And Preview Boundary

**Files:**

- Modify: `apps/web/src/app/features/flows/components/FlowAgentPanel.tsx`
- Modify: `apps/web/src/app/features/flows/components/NodeBlock.tsx`
- Modify: `apps/web/src/app/features/flows/components/ContentPreviewModal.tsx`
- Modify: `apps/web/src/app/features/flows/components/DetailPanel.tsx`
- Test: existing frontend typecheck and any available component tests.

- [ ] **Step 1: Add a frontend behavior note in code comments only where metadata enters**

In `FlowAgentPanel.tsx`, add a short comment near proposal option rendering:

```ts
// Proposal controls must be driven by content profile and pack metadata, not by assuming every video is Shorts.
```

- [ ] **Step 2: Replace ad hoc content type branching if it assumes Shorts/Longform**

Search:

```bash
rg -n "shorts|longform|media-image|sceneCount|imageStyle" apps/web/src/app/features/flows/components
```

Allowed in generic components:

- Reading a value from proposal metadata.
- Rendering a generic video/audio/image/text/json/table preview.

Not allowed in generic components:

- Assuming `media-image` means Shorts.
- Assuming Longform always has 12 fixed nodes in generic canvas components.

- [ ] **Step 3: Run frontend checks**

```bash
npx nx run @flows/web:typecheck --skip-nx-cache
npx nx run @flows/web:lint --skip-nx-cache
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/features/flows/components
git commit -m "refactor: keep frontend previews pack-neutral"
```

## Task 9: Full Verification

**Files:** No code changes unless checks reveal a defect.

- [ ] **Step 1: Run backend pack and compiler tests**

```bash
npx nx run @flows/backend:test --skip-nx-cache -- --run src/modules/workflow-packs/registry.spec.ts src/modules/workflow-packs/pack-boundary.spec.ts src/modules/orchestrator/workflow-compiler.spec.ts src/handlers/http/blocks/_catalog.spec.ts
```

- [ ] **Step 2: Run backend typecheck and lint**

```bash
npx nx run @flows/backend:typecheck --skip-nx-cache
npx nx run @flows/backend:lint --skip-nx-cache
```

- [ ] **Step 3: Run frontend typecheck and lint**

```bash
npx nx run @flows/web:typecheck --skip-nx-cache
npx nx run @flows/web:lint --skip-nx-cache
```

- [ ] **Step 4: Run contracts/flows checks**

```bash
npx nx run @flows/flows:typecheck --skip-nx-cache
```

- [ ] **Step 5: Browser smoke**

Run local servers, then verify in browser:

1. `링크 설명해줘: https://example.com/post` creates a text-oriented flow without `media-video`.
2. `쇼츠 만들어줘. 주제는 토트넘 강등위기` creates the Shorts recipe with reusable research/text/media blocks.
3. `롱폼 만들어줘. 주제는 이 링크 설명해주기 https://knightk.tistory.com/946` creates the Longform recipe, not a Shorts fallback.
4. The node catalog and detail panel still show block descriptions.
5. Video/image/audio/text outputs open in the generic preview modal.

- [ ] **Step 6: Final code review**

Review changed files for:

- Core importing pack registry only, not domain internals.
- Packs importing core types is allowed.
- No topic-specific hardcoding.
- No removal of existing Shorts/Longform behavior.
- Existing block IDs unchanged.
- Generic URL explanation does not become a video recipe.

- [ ] **Step 7: Commit final fixes if needed**

```bash
git add <only-fixed-files>
git commit -m "fix: stabilize workflow pack boundary"
```

## Completion Criteria

- `git diff --check` passes.
- Backend targeted pack/compiler/catalog tests pass.
- Backend typecheck and lint pass.
- Web typecheck and lint pass.
- `@flows/flows` typecheck passes.
- Core catalog/compiler/prompt reads manifests or registry, not hardcoded domain lists.
- Shorts flow still creates existing Shorts node chain.
- Longform flow still creates existing Longform Gate A/B chain.
- URL explanation flow does not include video blocks.
- Media blocks remain generic capability blocks.
- The plan leaves file movement to a later cleanup pass after behavior is verified.

## Deferred Cleanup After This Plan

Do not do these in the first implementation pass:

- Physically moving existing executor files into `packs/`.
- Dynamically generating Zod enums from manifests.
- Rewriting the whole orchestrator into a new planner.
- Changing public block IDs.
- Redesigning all frontend preview UI again.

Those become safe only after the registry boundary and tests are green.
