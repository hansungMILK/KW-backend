# Longform Production Factory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a longform-only production factory path that generates visible Gate A planning artifacts, blocks paid Gate B execution until approval, and produces QA-backed MP4 preview/download output without changing the Shorts pipeline.

**Architecture:** Introduce `longform-*` block types and map longform requests to a dedicated production DAG. Reuse existing source/content/TTS/video internals where appropriate, but keep the orchestration contract, UI labels, output previews, cost gates, and QA gates separate from Shorts. Gate A produces source/brief/script/storyboard/scene-json/review artifacts; Gate B consumes an approved Gate A artifact to run TTS, SRT alignment, motion composition, render, QA, and package.

**Tech Stack:** TypeScript, Zod, Vitest, Nx, React, existing block executor engine, OpenAI text planning, ElevenLabs TTS, FFmpeg QA, local HyperFrames-compatible motion contract.

---

## Working Rules

- Do not modify Shorts behavior except where shared type registries must list new longform block types.
- Do not add image scene count, image style, or image quality controls to longform.
- Do not mark a placeholder MP4 as complete.
- Write tests before production code for each behavior.
- Run `git diff --check` after every implementation batch.
- Run targeted backend tests after backend changes and frontend typecheck after frontend changes.

## File Map

### Contracts and block registration

- Modify: `apps/backend/src/modules/blocks/types.ts`
    - Add `longform-*` block types and longform output schemas.
- Modify: `apps/backend/src/modules/orchestrator/response-parser.ts`
    - Allow the new block types in orchestrator JSON.
- Modify: `apps/backend/src/modules/orchestrator/block-catalog.ts`
    - Add longform capabilities and catalog entries.
- Modify: `apps/backend/src/handlers/http/blocks/_catalog.ts`
    - Add block definitions so the frontend can render longform nodes.
- Modify: `apps/backend/src/modules/content-profile/content-profile.ts`
    - Propagate content profile metadata to longform blocks.

### Longform executors

- Create: `apps/backend/src/modules/blocks/longform-blocks.ts`
    - `longform-source`
    - `longform-brief`
    - `longform-script`
    - `longform-storyboard`
    - `longform-scene-json`
    - `longform-review`
    - `longform-tts`
    - `longform-srt-align`
    - `longform-motion-compose`
    - `longform-render`
    - `longform-qa`
    - `longform-package`
- Modify: `apps/backend/src/modules/blocks/block-registry.ts`
    - Register all longform executors.

### Orchestration

- Modify: `apps/backend/src/modules/orchestrator/longform-gate-a.ts`
    - Build Gate A with `longform-source -> longform-brief -> longform-script -> longform-storyboard -> longform-scene-json -> longform-review`.
- Modify: `apps/backend/src/modules/orchestrator/prompt-templates.ts`
    - Explain longform-specific block types and forbid Shorts/media blocks before approval.
- Tests:
    - `apps/backend/src/modules/orchestrator/mock-orchestrator.spec.ts`
    - `apps/backend/src/modules/orchestrator/openai-orchestrator.spec.ts`
    - `apps/backend/src/modules/orchestrator/workflow-compiler.spec.ts`

### Execution and QA

- Modify: `apps/backend/src/services/run-service.ts`
    - Include `longform-render` in the existing $5 render cost guard.
- Modify: `apps/backend/src/services/execution-engine.ts`
    - Treat `longform-review` as a review stopping point in step mode.
- Tests:
    - `apps/backend/src/services/run-service.spec.ts`
    - `apps/backend/src/services/execution-engine.spec.ts`
    - `apps/backend/src/modules/blocks/longform-blocks.spec.ts`

### Frontend preview

- Modify: `apps/web/src/app/features/flows/components/FlowAgentPanel.tsx`
    - Hide image style/scene count controls for longform proposals.
- Modify: `apps/web/src/app/features/flows/components/NodeBlock.tsx`
    - Add longform-specific friendly previews for source, brief, storyboard, scene JSON, QA, and package.
- Tests:
    - `apps/web/src/app/features/flows/components/FlowAgentPanel.spec.tsx`
    - Browser E2E after implementation.

## Task 1: Register longform block types

- [ ] Add failing tests proving `compileWorkflowPlan` accepts a longform Gate A DAG with `longform-*` block types and rejects unknown block types.
- [ ] Extend backend block type unions and orchestrator parser allowed block types.
- [ ] Add block catalog entries for `longform-source`, `longform-brief`, `longform-script`, `longform-storyboard`, `longform-scene-json`, `longform-review`, `longform-tts`, `longform-srt-align`, `longform-motion-compose`, `longform-render`, `longform-qa`, and `longform-package`.
- [ ] Run:

```bash
npx nx run @flows/backend:test --skip-nx-cache -- --run src/modules/orchestrator/workflow-compiler.spec.ts
```

## Task 2: Build longform executor wrappers

- [ ] Add failing tests for Gate A executor behavior:
    - `longform-source` returns `sourceDigest` and never raw XML/HTML dumps.
    - `longform-brief` returns `viewerPromise`, `angle`, `structure`, and `estimatedDurationSec`.
    - `longform-script` returns `fullScriptDraft`, `sections`, and `sourceMap`.
    - `longform-storyboard` returns visual chapters, not one scene per subtitle cue.
    - `longform-scene-json` returns `renderer: "hyperframes"`, `2560x1440`, and `perCueActivity`.
    - `longform-review` returns `reviewStatus: "draft"` and blocks media execution by default.
- [ ] Implement `apps/backend/src/modules/blocks/longform-blocks.ts`.
- [ ] Register the blocks.
- [ ] Run:

```bash
npx nx run @flows/backend:test --skip-nx-cache -- --run src/modules/blocks/longform-blocks.spec.ts
```

## Task 3: Switch longform Gate A orchestration to longform blocks

- [ ] Update existing longform orchestrator tests to expect only `longform-*` Gate A nodes.
- [ ] Update `buildLongformGateAWorkflow`.
- [ ] Verify rejected blocks include Shorts media blocks before review.
- [ ] Run:

```bash
npx nx run @flows/backend:test --skip-nx-cache -- --run src/modules/orchestrator/mock-orchestrator.spec.ts src/modules/orchestrator/openai-orchestrator.spec.ts
```

## Task 4: Gate B cost and approval guards

- [ ] Add failing tests that `longform-render` is blocked when compose+render estimate exceeds `$5.00`.
- [ ] Add failing tests that `longform-render` refuses execution without approved Gate A artifact.
- [ ] Extend existing cost guard to include `longform-render`.
- [ ] Run:

```bash
npx nx run @flows/backend:test --skip-nx-cache -- --run src/services/run-service.spec.ts src/modules/blocks/longform-blocks.spec.ts
```

## Task 5: Review stopping behavior

- [ ] Add failing test that step execution stops after `longform-review`.
- [ ] Update execution engine review-node detection.
- [ ] Run:

```bash
npx nx run @flows/backend:test --skip-nx-cache -- --run src/services/execution-engine.spec.ts
```

## Task 6: Frontend longform proposal and node previews

- [ ] Add failing test that longform proposal cards do not render scene count/image style/image quality controls.
- [ ] Update `FlowAgentPanel.tsx`.
- [ ] Add longform-friendly output previews in `NodeBlock.tsx`.
- [ ] Run:

```bash
npx nx run @flows/web:test --skip-nx-cache -- --run FlowAgentPanel.spec.tsx
npx nx run @flows/web:typecheck --skip-nx-cache
```

## Task 7: Full verification and code review

- [ ] Run backend targeted tests.
- [ ] Run backend typecheck.
- [ ] Run frontend typecheck.
- [ ] Run lint for touched packages.
- [ ] Run browser/E2E flow if local server starts cleanly.
- [ ] Perform code review against the spec:
    - no Shorts behavior drift
    - no longform scene count/style controls
    - Gate A before paid execution
    - Gate B $5 cap
    - MP4 preview/download output path
    - no placeholder completion

## Completion Checklist

- [ ] `docs/superpowers/specs/2026-05-13-longform-production-factory-design.md` exists and matches this plan.
- [ ] Longform request compiles to `longform-*` nodes.
- [ ] Shorts tests still pass.
- [ ] Longform Gate A produces visible planning artifacts.
- [ ] Longform Gate B refuses unapproved or over-cap execution.
- [ ] Longform render path returns preview/download URLs only after QA.
- [ ] Browser E2E evidence is saved or a real blocker is documented.
