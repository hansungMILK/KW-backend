# Longform Production Factory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a longform-only production factory path that generates visible Gate A planning artifacts, blocks paid Gate B execution until approval, and produces QA-backed MP4 preview/download output without changing the Shorts pipeline.

**Architecture:** Introduce `longform-*` block types and map longform requests to a dedicated production DAG. Reuse existing source/content/TTS/video internals where appropriate, but keep the orchestration contract, UI labels, output previews, cost gates, and QA gates separate from Shorts. Gate A produces source/brief/script/storyboard/scene-json/review artifacts; Gate B consumes an approved Gate A artifact to run TTS, SRT alignment, motion composition, render, QA, and package.

**Tech Stack:** TypeScript, Zod, Vitest, Nx, React, existing block executor engine, OpenAI text planning, ElevenLabs TTS, FFmpeg QA, local HyperFrames-compatible motion contract.

## Current Implementation Status

Updated: 2026-05-13

- Longform requests now produce one visible 12-node production factory on the canvas.
- The first run uses `executionMode: "step"` while `longform-review` is not approved, so Gate A artifacts run and Gate B paid nodes remain blocked.
- Longform proposal UI hides Shorts-only image scene count, image style, and image quality controls.
- Longform node outputs render friendly previews for source digest, brief, script, storyboard, scene contract, review, and package-like outputs.
- `longform-render` is included in the `$5.00` longform HTML/HyperFrames render cost guard.
- Saved `longform-review` output now becomes an approved Gate A artifact and allows the next run to enter Gate B.
- Gate B approval propagates through node payloads into TTS/SRT/motion/render, instead of relying on a hardcoded downstream node flag.
- `longform-render` no longer requires OpenAI provider preflight because the current B render path is local HyperFrames/FFmpeg, not an OpenAI image/video call.
- If no image assets are supplied, `longform-render` creates internal motion-board visual inputs from scene JSON, subtitle cues, and motion cues.
- Browser evidence: `/tmp/eureka-longform-e2e-1778646563641` confirmed 12 nodes, 11 edges, `$0.82` visible estimate, `executionMode: step`, no failed requests, and visible Gate A outputs.
- The design spec now includes a Gate B node blueprint, data propagation line, live progress UI states, review UI contract, result UI contract, failure matrix, and B verification matrix.

Known remaining production work:

- Actual approved Gate B is now connected through saved `reviewedOutput`; the next UX slice is a clearer “검수 승인 후 영상 제작 실행” control instead of relying on the current review-save button semantics.
- High-quality HyperFrames renderer output is still not at the final creative bar. Current Gate B can produce local motion-board MP4 inputs without image generation, but the premium HyperFrames motion adapter and visual QA still need a dedicated production pass.
- The current mock Gate A outputs prove wiring and previews, not final editorial/script quality.

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
    - Build one visible 12-node longform production factory, with Gate B nodes blocked until review approval.
- Modify: `apps/backend/src/modules/orchestrator/prompt-templates.ts`
    - Explain longform-specific block types and forbid generic Shorts/media blocks in longform recipes.
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

- [x] Add failing tests proving `compileWorkflowPlan` accepts a longform production DAG with `longform-*` block types and rejects unknown block types.
- [x] Extend backend block type unions and orchestrator parser allowed block types.
- [x] Add block catalog entries for `longform-source`, `longform-brief`, `longform-script`, `longform-storyboard`, `longform-scene-json`, `longform-review`, `longform-tts`, `longform-srt-align`, `longform-motion-compose`, `longform-render`, `longform-qa`, and `longform-package`.
- [x] Run:

```bash
npx nx run @flows/backend:test --skip-nx-cache -- --run src/modules/orchestrator/workflow-compiler.spec.ts
```

## Task 2: Build longform executor wrappers

- [x] Add failing tests for Gate A executor behavior:
    - `longform-source` returns `sourceDigest` and never raw XML/HTML dumps.
    - `longform-brief` returns `viewerPromise`, `angle`, `structure`, and `estimatedDurationSec`.
    - `longform-script` returns `fullScriptDraft`, `sections`, and `sourceMap`.
    - `longform-storyboard` returns visual chapters, not one scene per subtitle cue.
    - `longform-scene-json` returns `renderer: "hyperframes"`, `2560x1440`, and `perCueActivity`.
    - `longform-review` returns `reviewStatus: "draft"` and blocks media execution by default.
- [x] Implement `apps/backend/src/modules/blocks/longform-blocks.ts`.
- [x] Register the blocks.
- [x] Run:

```bash
npx nx run @flows/backend:test --skip-nx-cache -- --run src/modules/blocks/longform-blocks.spec.ts
```

## Task 3: Switch longform Gate A orchestration to longform blocks

- [x] Update existing longform orchestrator tests to expect only `longform-*` production factory nodes.
- [x] Update `buildLongformGateAWorkflow`.
- [x] Verify rejected blocks include generic/Shorts media blocks.
- [x] Run:

```bash
npx nx run @flows/backend:test --skip-nx-cache -- --run src/modules/orchestrator/mock-orchestrator.spec.ts src/modules/orchestrator/openai-orchestrator.spec.ts
```

## Task 4: Gate B cost and approval guards

- [x] Add failing tests that `longform-render` is blocked when compose+render estimate exceeds `$5.00`.
- [x] Add failing tests that Gate B refuses execution without approved Gate A artifact.
- [x] Extend existing cost guard to include `longform-render`.
- [x] Allow initial step runs to queue with future unapproved Gate B nodes while preflight checks only Gate A.
- [x] Run:

```bash
npx nx run @flows/backend:test --skip-nx-cache -- --run src/services/run-service.spec.ts src/modules/blocks/longform-blocks.spec.ts
```

## Task 5: Review stopping behavior

- [x] Add failing test that step execution stops after `longform-review`.
- [x] Update execution engine review-node detection.
- [x] Run:

```bash
npx nx run @flows/backend:test --skip-nx-cache -- --run src/services/execution-engine.spec.ts
```

## Task 6: Frontend longform proposal and node previews

- [x] Add failing test that longform proposal cards do not render scene count/image style/image quality controls.
- [x] Update `FlowAgentPanel.tsx`.
- [x] Add longform-friendly output previews in `NodeBlock.tsx`.
- [x] Normalize backend `blockType` to frontend `type` so approved nodes are not saved as zero executable nodes.
- [x] Run:

```bash
npx nx run @flows/web:test --skip-nx-cache -- --run FlowAgentPanel.spec.tsx
npx nx run @flows/web:typecheck --skip-nx-cache
```

## Task 7: Full verification and code review

- [x] Run backend targeted tests.
- [x] Run backend typecheck.
- [x] Run frontend typecheck.
- [x] Run lint for touched packages.
- [x] Run browser/E2E flow if local server starts cleanly.
- [x] Perform code review against the spec:
    - no Shorts behavior drift
    - no longform scene count/style controls
    - Gate A before paid execution
    - Gate B $5 cap
    - MP4 preview/download output path
    - no placeholder completion

## Task 8: B node blueprint and UX contract

- [x] Add a user-facing/internal split so A/B remains one product flow for the user.
- [x] Document all 12 longform nodes with Gate, role, input, output, frontend display, and failure behavior.
- [x] Document the approved artifact propagation line from `longform-review` through `longform-package`.
- [x] Document live Gate B progress labels for TTS, SRT, motion, render, QA, and package.
- [x] Document review UI requirements so the user can inspect/edit script output before paid execution.
- [x] Document final result UI requirements for audio, SRT, motion summary, video preview, MP4 download, QA, and package.
- [x] Document Gate B failure matrix and retry policy.
- [x] Document B verification matrix tying each claim to a test or browser evidence.

## Completion Checklist

- [x] `docs/superpowers/specs/2026-05-13-longform-production-factory-design.md` exists and matches this plan.
- [x] Longform request compiles to `longform-*` nodes.
- [x] Shorts tests still pass.
- [x] Longform Gate A produces visible planning artifacts.
- [x] Longform Gate B refuses unapproved or over-cap execution.
- [x] Longform render path returns preview/download URLs only after QA.
- [x] Saved longform review output allows the next full Gate B run.
- [x] Longform Gate B can render without image-generation assets by creating internal motion-board visuals.
- [x] Browser E2E evidence is saved or a real blocker is documented.
- [x] B node design and user-visible execution blueprint are captured in the spec.
