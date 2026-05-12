# Content Profile And Longform Production Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the full content profile system from proposal selection through Shorts tone/style execution, script review, longform Gate A, longform Gate B smoke, and browser-verified E2E.

**Architecture:** Add a shared production profile contract, persist it in proposal metadata, let the user edit profile settings in the proposal card, propagate approved settings to node configs, and route content generation/rendering through those configs. Longform work is split into Gate A planning artifacts and Gate B paid production so the product can execute real TTS/SRT/HyperFrames/MP4 QA without hiding costs.

**Tech Stack:** TypeScript, Zod contracts, Vitest, Nx, React, existing backend block engine, OpenAI/Claude orchestrators, GPT-image-2, ElevenLabs, FFmpeg, Playwright.

---

## Mandatory Working Rules

- Do not implement only the first slice and call the job done. The final target is the complete spec in `docs/superpowers/specs/2026-05-13-content-profile-and-longform-design.md`.
- Every code task must follow TDD: write failing tests, run and confirm they fail, implement, run and confirm they pass.
- After every task, run code review against the task diff before moving on.
- After every task, run `git diff --check` and the most local targeted tests.
- After UI-affecting tasks, run Playwright or browser verification and save screenshots in `test-results/`.
- Paid E2E is only allowed when explicitly requested and must respect cost cap settings.
- No hardcoded article, person, or “education shorts” fixture in production paths.

## File Map

### Contracts

- Modify: `libs/contracts/src/http/proposals.schema.ts`
    - Add `ScriptToneIdSchema`, `ScriptToneIntensitySchema`, `ContentProfileIdSchema`, `ReviewModeSchema`.
    - Add optional fields to `ProposalApproveRequestSchema`.
    - Add optional `contentProfile` metadata schema only if the current contract style can support it without over-tightening legacy rows.

### Backend Profile Logic

- Create: `apps/backend/src/modules/content-profile/content-profile.ts`
    - Normalize script tone, intensity, review mode, content profile id.
    - Infer default profile from user request and workflow output type.
    - Build metadata options for UI.
    - Apply approved profile settings to node configs.
- Test: `apps/backend/src/modules/content-profile/content-profile.spec.ts`

### Backend Orchestrators

- Modify: `apps/backend/src/modules/orchestrator/claude-orchestrator.ts`
- Modify: `apps/backend/src/modules/orchestrator/openai-orchestrator.ts`
- Modify: `apps/backend/src/modules/orchestrator/mock-orchestrator.ts`
    - Attach `contentProfile` metadata to proposal.
    - Include tone/review defaults in content node config.
    - Preserve current image-generation metadata.
- Test: `apps/backend/src/modules/orchestrator/workflow-compiler.spec.ts` or a new focused orchestrator metadata test if existing mocks make direct orchestrator tests too brittle.

### Backend Approval Propagation

- Modify: `apps/backend/src/services/proposal-service.ts`
    - Extend `ApprovalOverrides`.
    - Apply approved `scriptToneId`, `scriptToneIntensity`, `contentProfileId`, and `reviewMode` to content/data/analysis/media nodes.
    - Update proposal metadata after approval.
- Test: `apps/backend/src/services/proposal-service.spec.ts`

### HTTP Handler

- Modify: `apps/backend/src/handlers/http/proposals/approve-proposal.ts`
- Test: `apps/backend/src/handlers/http/proposals/approve-proposal.spec.ts`

### Script Tone Rulepacks

- Create: `apps/backend/src/modules/shorts/rulepacks/script-tone-rulepack.ts`
    - Export tone definitions:
        - `informative-reframe`
        - `mz-viral`
        - `news-anchor`
        - `story-dialogue`
        - `calm-explainer`
    - Export `selectScriptToneRulepack(config, input)`.
- Modify: `apps/backend/src/modules/blocks/content-block.ts`
    - Inject selected tone rules into system prompt.
    - Keep image prompt style-neutral.
    - Preserve URL-first source policy.
- Test: `apps/backend/src/modules/blocks/content-block.spec.ts`

### Frontend API And Types

- Modify: `libs/flows/src/api/messages.ts`
- Modify: `libs/flows/src/api/proposals.ts`
- Modify: `apps/web/src/app/features/flows/components/FlowAgentPanel.tsx`
    - Render tone, intensity, review mode, output profile controls in proposal card.
    - Send approved fields in `approveProposal()`.
    - Keep existing image style/quality/scene count controls.

### Script Review UX

- Modify: `apps/web/src/app/features/flows/pages/FlowEditorPage.tsx`
- Modify: `apps/web/src/app/features/flows/components/NodeBlock.tsx`
    - Ensure review mode is visible and understandable.
    - Ensure generated script is editable and saved output is used on next run.
    - Keep run status card and running node indication visible.

### Longform Gate A

- Extend existing content/data/analysis blocks first before adding many new blocks.
- Add `longform` content profile mode:
    - outline
    - script draft
    - scene plan
    - estimated duration
    - estimated cost
    - renderer route
- If a dedicated block is needed, add only `longform-outline` after proving content mode cannot remain clear.
- Tests:
    - Gate A produces planning artifacts.
    - Gate A does not trigger image/TTS/render before approval.

### Longform Gate B Smoke

- Extend media-video/render path to support a longform render contract:
    - TTS
    - SRT/timing
    - scene contract
    - renderer route
    - MP4 render
    - ffprobe QA
    - package output
- HyperFrames route may start as a local composition adapter if external CLI/API is not available, but it must produce a real MP4 and QA result. Do not mark Gate B complete with a placeholder.
- Tests:
    - Gate B requires approved Gate A artifacts.
    - QA failure blocks completion.
    - Successful smoke returns preview/download asset.

### E2E

- Modify: `tests/e2e/eureka-ui-inspection.spec.ts`
    - Add no-paid proposal UI test for tone/style/review controls.
    - Add script-review-mode browser flow.
    - Add longform Gate A browser flow.
    - Keep paid smoke opt-in with `E2E_ALLOW_PAID_RUN=1`.

---

## Task 1: Shared Content Profile Contract

**Files:**

- Modify: `libs/contracts/src/http/proposals.schema.ts`
- Create: `apps/backend/src/modules/content-profile/content-profile.ts`
- Test: `apps/backend/src/modules/content-profile/content-profile.spec.ts`

- [ ] **Step 1: Write failing tests for content profile normalization**

Create `apps/backend/src/modules/content-profile/content-profile.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { buildContentProfilePreferences, normalizeReviewMode, normalizeScriptToneId } from './content-profile';

describe('content profile preferences', () => {
    it('defaults a Shorts video request to the informative tone and script review option', () => {
        const prefs = buildContentProfilePreferences({
            userMessage: '쇼츠 만들어줘. 주제는 최신 AI 뉴스',
            outputType: 'video',
            hasMediaVideo: true,
        });

        expect(prefs.contentProfileId).toBe('shorts.info.v1');
        expect(prefs.scriptToneId).toBe('informative-reframe');
        expect(prefs.reviewMode).toBe('direct-run');
        expect(prefs.toneOptions.map(option => option.id)).toContain('news-anchor');
        expect(prefs.reviewModeOptions.map(option => option.id)).toEqual(['direct-run', 'script-first']);
    });

    it('honors explicit user tone language without hardcoding a topic', () => {
        expect(normalizeScriptToneId('뉴스앵커형으로 말해줘')).toBe('news-anchor');
        expect(normalizeScriptToneId('mz 말투로 해줘')).toBe('mz-viral');
        expect(normalizeScriptToneId('대화형 이야기처럼')).toBe('story-dialogue');
    });

    it('normalizes invalid review mode to direct-run', () => {
        expect(normalizeReviewMode('bad-value')).toBe('direct-run');
    });
});
```

- [ ] **Step 2: Run the new test and confirm RED**

Run:

```bash
npx nx run @flows/backend:test --skip-nx-cache -- --run apps/backend/src/modules/content-profile/content-profile.spec.ts
```

Expected: FAIL because `content-profile.ts` does not exist.

- [ ] **Step 3: Implement content profile helper**

Create `apps/backend/src/modules/content-profile/content-profile.ts` with:

```ts
export type ScriptToneId = 'informative-reframe' | 'mz-viral' | 'news-anchor' | 'story-dialogue' | 'calm-explainer';

export type ScriptToneIntensity = 'low' | 'medium' | 'high';
export type ReviewMode = 'direct-run' | 'script-first';
export type ContentProfileId =
    | 'text.explainer.v1'
    | 'image.single.v1'
    | 'shorts.info.v1'
    | 'shorts.story.v1'
    | 'longform.explainer.v1'
    | 'longform.documentary.v1';

export const SCRIPT_TONE_OPTIONS = [
    { id: 'informative-reframe', label: '정보전달형', description: '문제 재정의와 핵심 3가지 구조' },
    { id: 'mz-viral', label: 'MZ 바이럴형', description: '가벼운 트렌드용 빠른 말투' },
    { id: 'news-anchor', label: '뉴스앵커형', description: '공식 발표와 논란 정리용' },
    { id: 'story-dialogue', label: '이야기 진행형', description: '질문과 답변으로 이어지는 구조' },
    { id: 'calm-explainer', label: '차분한 해설형', description: '롱폼과 교육형 설명 기본값' },
] as const;

export const REVIEW_MODE_OPTIONS = [
    { id: 'direct-run', label: '바로 실행', description: '승인 후 전체 워크플로우를 실행합니다.' },
    { id: 'script-first', label: '대본 검수 후 실행', description: '대본 단계에서 멈추고 수정본으로 이어갑니다.' },
] as const;
```

Add functions `normalizeScriptToneId`, `normalizeScriptToneIntensity`, `normalizeReviewMode`, `inferContentProfileId`, and `buildContentProfilePreferences`.

- [ ] **Step 4: Extend contracts**

Modify `libs/contracts/src/http/proposals.schema.ts`:

```ts
export const ScriptToneIdSchema = z.enum([
    'informative-reframe',
    'mz-viral',
    'news-anchor',
    'story-dialogue',
    'calm-explainer',
]);
export const ScriptToneIntensitySchema = z.enum(['low', 'medium', 'high']);
export const ContentProfileIdSchema = z.enum([
    'text.explainer.v1',
    'image.single.v1',
    'shorts.info.v1',
    'shorts.story.v1',
    'longform.explainer.v1',
    'longform.documentary.v1',
]);
export const ReviewModeSchema = z.enum(['direct-run', 'script-first']);
```

Add optional fields to `ProposalApproveRequestSchema`:

```ts
scriptToneId: ScriptToneIdSchema.optional(),
scriptToneIntensity: ScriptToneIntensitySchema.optional(),
contentProfileId: ContentProfileIdSchema.optional(),
reviewMode: ReviewModeSchema.optional(),
```

- [ ] **Step 5: Run targeted tests**

Run:

```bash
npx nx run @flows/backend:test --skip-nx-cache -- --run apps/backend/src/modules/content-profile/content-profile.spec.ts
npx nx run @flows/backend:typecheck --skip-nx-cache
npx nx run @flows/flows:typecheck --skip-nx-cache
```

- [ ] **Step 6: Code review checkpoint**

Review diff from base:

```bash
git diff --check
git diff -- libs/contracts/src/http/proposals.schema.ts apps/backend/src/modules/content-profile/content-profile.ts apps/backend/src/modules/content-profile/content-profile.spec.ts
```

Findings must be fixed before Task 2.

---

## Task 2: Proposal Metadata And Approval Propagation

**Files:**

- Modify: `apps/backend/src/modules/orchestrator/claude-orchestrator.ts`
- Modify: `apps/backend/src/modules/orchestrator/openai-orchestrator.ts`
- Modify: `apps/backend/src/modules/orchestrator/mock-orchestrator.ts`
- Modify: `apps/backend/src/services/proposal-service.ts`
- Modify: `apps/backend/src/handlers/http/proposals/approve-proposal.ts`
- Test: `apps/backend/src/services/proposal-service.spec.ts`
- Test: `apps/backend/src/handlers/http/proposals/approve-proposal.spec.ts`

- [ ] **Step 1: Write failing proposal-service test**

Add a test to `proposal-service.spec.ts`:

```ts
it('applies selected script tone and review mode to content nodes and proposal metadata', async () => {
    // Arrange a PENDING proposal with content and media nodes.
    // Approve with scriptToneId: 'news-anchor', scriptToneIntensity: 'high',
    // contentProfileId: 'shorts.info.v1', reviewMode: 'script-first'.
    // Assert content node config contains all four values.
    // Assert proposal.metadata.contentProfile contains all four values.
});
```

The actual assertion must inspect `putFlow.mock.calls[0][0]` and `putProposal.mock.calls[0][0]`.

- [ ] **Step 2: Run and confirm RED**

Run:

```bash
npx nx run @flows/backend:test --skip-nx-cache -- --run apps/backend/src/services/proposal-service.spec.ts
```

Expected: FAIL because approval overrides do not include script tone fields.

- [ ] **Step 3: Implement backend propagation**

Modify `ApprovalOverrides` in `proposal-service.ts` to include:

```ts
scriptToneId?: ScriptToneId;
scriptToneIntensity?: ScriptToneIntensity;
contentProfileId?: ContentProfileId;
reviewMode?: ReviewMode;
```

Apply these fields to `content`, `data`, `analysis`, `media-tts`, and `media-video` node configs where relevant. At minimum, `content` must receive all four fields, and downstream nodes must receive `contentProfileId` and `reviewMode` if needed to gate execution.

- [ ] **Step 4: Extend approve handler**

Pass the parsed fields from `approve-proposal.ts` into `proposalService.approve`.

- [ ] **Step 5: Attach metadata from orchestrators**

In both real orchestrators and mock orchestrator, build content profile preferences and attach:

```ts
metadata: {
  ...(imageGeneration ? { imageGeneration } : {}),
  contentProfile,
}
```

Do not overwrite `imageGeneration`.

- [ ] **Step 6: Run targeted tests**

```bash
npx nx run @flows/backend:test --skip-nx-cache -- --run apps/backend/src/services/proposal-service.spec.ts apps/backend/src/handlers/http/proposals/approve-proposal.spec.ts
npx nx run @flows/backend:typecheck --skip-nx-cache
npx nx run @flows/flows:typecheck --skip-nx-cache
git diff --check
```

- [ ] **Step 7: Code review checkpoint**

Review producer-consumer closure:

- Producer: orchestrator metadata and approval body.
- Consumer: proposal service node config.
- Connected: approved config reaches flow nodes.

Fix any gap before Task 3.

---

## Task 3: Script Tone Rulepacks In Content Block

**Files:**

- Create: `apps/backend/src/modules/shorts/rulepacks/script-tone-rulepack.ts`
- Modify: `apps/backend/src/modules/blocks/content-block.ts`
- Test: `apps/backend/src/modules/blocks/content-block.spec.ts`

- [ ] **Step 1: Write failing tests**

Add tests that prove:

- `news-anchor` adds news-style constraints to the model request.
- `mz-viral` does not remove source requirements.
- `story-dialogue` adds question/answer progression.

Use the existing `openaiAdapter` mock pattern in `content-block.spec.ts` and assert `request.systemPrompt` includes tone-specific phrases.

- [ ] **Step 2: Run and confirm RED**

```bash
npx nx run @flows/backend:test --skip-nx-cache -- --run apps/backend/src/modules/blocks/content-block.spec.ts
```

- [ ] **Step 3: Implement tone rulepack**

Create a tone rulepack module with deterministic text rules. It must not contain fixed topic examples like “모수”, “세레브라스”, or “입시”.

- [ ] **Step 4: Inject tone into content block**

In `content-block.ts`, read `config.scriptToneId` and `config.scriptToneIntensity`, select a tone rulepack, and pass it into the combined system prompt.

- [ ] **Step 5: Verify**

```bash
npx nx run @flows/backend:test --skip-nx-cache -- --run apps/backend/src/modules/blocks/content-block.spec.ts
npx nx run @flows/backend:typecheck --skip-nx-cache
git diff --check
```

- [ ] **Step 6: Code review checkpoint**

Review for prompt hardcoding, URL-first regression, and imagePrompt style leakage.

---

## Task 4: Frontend Proposal Controls

**Files:**

- Modify: `libs/flows/src/api/messages.ts`
- Modify: `libs/flows/src/api/proposals.ts`
- Modify: `apps/web/src/app/features/flows/components/FlowAgentPanel.tsx`

- [ ] **Step 1: Write UI-facing type/test or component-level assertion**

If no component test harness exists, write a focused pure helper in `FlowAgentPanel.tsx` or a colocated helper module:

```ts
export function asContentProfileMetadata(metadata: unknown): ContentProfileMetadata | undefined;
```

Then test that helper with metadata containing tone options and review mode options.

- [ ] **Step 2: Confirm RED**

Run the relevant frontend test target if available. If there is no frontend unit test target for this component, run:

```bash
npx nx run @flows/web:typecheck --skip-nx-cache
```

and record that no frontend unit harness exists for this component.

- [ ] **Step 3: Add proposal UI controls**

In the proposal card, add controls in this order:

1. 대본 톤
2. 톤 강도
3. 대본 검수 방식
4. Existing scene count
5. Existing image style
6. Existing quality

Keep controls disabled after approval.

- [ ] **Step 4: Send approval fields**

Extend `handleApprove()` body with:

```ts
scriptToneId,
scriptToneIntensity,
contentProfileId,
reviewMode,
```

- [ ] **Step 5: Verify**

```bash
npx nx run @flows/web:typecheck --skip-nx-cache
npx nx run @flows/flows:typecheck --skip-nx-cache
npx nx run @flows/web:lint --skip-nx-cache
git diff --check
```

- [ ] **Step 6: Playwright no-paid UI verification**

Run local frontend/backend in mock/no-paid mode, then:

```bash
yarn e2e:ui
```

Expected browser proof:

- Proposal card shows 대본 톤.
- User can choose 뉴스앵커형 or 이야기 진행형.
- User can choose 대본 검수 후 실행.
- Approval sends the selected values.

- [ ] **Step 7: Code review checkpoint**

Review for hidden state mismatch: displayed selection must equal approval payload.

---

## Task 5: Script Review Mode Execution Path

**Files:**

- Modify: `apps/web/src/app/features/flows/pages/FlowEditorPage.tsx`
- Modify: `apps/web/src/app/features/flows/components/NodeBlock.tsx`
- Modify backend execution only if frontend review mode currently cannot stop at content node reliably.

- [ ] **Step 1: Write failing tests or E2E assertions**

Add Playwright assertions:

- User selects `script-first`.
- Run stops after script/content node.
- Script output is visible.
- User can save reviewed script.
- Next run uses reviewed script.

- [ ] **Step 2: Confirm RED**

Run:

```bash
yarn e2e:ui
```

Expected: fail on one of the script-review assertions if current wiring is incomplete.

- [ ] **Step 3: Implement missing execution path**

Fix the smallest missing path:

- If UI selection is not persisted, persist it in flow/node config.
- If execution ignores review mode, stop after content node.
- If reviewed output is not reused, pass it into content/data node execution.

- [ ] **Step 4: Verify**

```bash
npx nx run @flows/backend:test --skip-nx-cache -- --run
npx nx run @flows/web:typecheck --skip-nx-cache
yarn e2e:ui
git diff --check
```

- [ ] **Step 5: Code review checkpoint**

Review that this is not just UI state. Confirm the reviewed script is the producer and downstream blocks are the consumers.

---

## Task 6: Longform Gate A

**Files:**

- Modify: `apps/backend/src/modules/orchestrator/prompt-templates.ts`
- Modify: `apps/backend/src/modules/blocks/content-block.ts`
- Modify: `apps/backend/src/modules/blocks/data-block.ts`
- Modify: `apps/backend/src/modules/blocks/analysis-block.ts`
- Add tests near the changed backend modules.

- [ ] **Step 1: Write failing tests**

Tests must prove:

- “롱폼 제작해줘” produces a longform profile proposal.
- Gate A output contains outline, full script draft, scene plan, estimated duration, estimated cost, and renderer route.
- Gate A does not include media-image, media-tts, or media-video execution before approval.

- [ ] **Step 2: Confirm RED**

Run targeted backend tests and confirm failure.

- [ ] **Step 3: Implement longform Gate A using existing blocks first**

Prefer existing `content`, `data`, `analysis` modes before adding new block types. Add new block types only if the existing block catalog becomes misleading.

- [ ] **Step 4: Verify**

```bash
npx nx run @flows/backend:test --skip-nx-cache -- --run
npx nx run @flows/backend:typecheck --skip-nx-cache
git diff --check
```

- [ ] **Step 5: Playwright Gate A verification**

Browser flow:

- Ask: `롱폼 제작해줘. 주제는 AI 에이전트의 미래`
- Confirm proposal says 롱폼.
- Confirm Gate A execution shows outline/script/scene plan.
- Confirm paid Gate B controls are not enabled before review approval.

- [ ] **Step 6: Code review checkpoint**

Review for paid boundary leaks.

---

## Task 7: Longform Gate B Smoke

**Files:**

- Modify: `apps/backend/src/modules/blocks/media-tts-block.ts`
- Modify: `apps/backend/src/modules/blocks/media-video-block.ts`
- Modify: `apps/backend/src/adapters/external/ffmpeg-adapter.ts`
- Add or modify render/package helpers only if current media-video code cannot express longform QA cleanly.

- [ ] **Step 1: Write failing tests**

Tests must prove:

- Gate B rejects unapproved Gate A artifacts.
- Successful Gate B returns an MP4 asset with preview/download metadata.
- ffprobe QA failure blocks completed status.

- [ ] **Step 2: Confirm RED**

Run targeted tests and confirm expected failure.

- [ ] **Step 3: Implement production smoke**

Implement the smallest real path:

- Use existing TTS adapter for narration.
- Generate SRT/timing metadata.
- Render a real MP4 through FFmpeg path.
- Require audio and video stream checks.
- For longform default, target `2560x1440` unless the profile says vertical.

- [ ] **Step 4: Verify**

```bash
npx nx run @flows/backend:test --skip-nx-cache -- --run
npx nx run @flows/backend:typecheck --skip-nx-cache
git diff --check
```

- [ ] **Step 5: Code review checkpoint**

Review that Gate B cannot complete on placeholder artifact existence.

---

## Task 8: Full E2E And Paid Smoke

**Files:**

- Modify: `tests/e2e/eureka-ui-inspection.spec.ts`
- Store screenshots/videos under `test-results/`.

- [ ] **Step 1: No-paid full browser E2E**

Run:

```bash
ALLOW_PAID_OPENAI=0 yarn e2e:ui
```

Must verify:

- Proposal controls are visible.
- Tone/review/style selections are visible.
- Script review flow works in mock/no-paid path.
- Final UI has no stale failed flow state.

- [ ] **Step 2: Paid Shorts smoke only after explicit user approval**

Run only when approved:

```bash
E2E_ALLOW_PAID_RUN=1 E2E_PAID_RUN_TIMEOUT_MS=1200000 yarn e2e:ui
```

Must verify:

- 12 images requested means 12 image assets.
- Adam TTS asset exists.
- MP4 asset exists.
- Preview and download are visible.
- Script matches primary URL source.

- [ ] **Step 3: Longform Gate A browser E2E**

Must verify:

- Longform proposal.
- Gate A artifacts visible.
- Gate B paid execution blocked until approval.

- [ ] **Step 4: Final static verification**

Run:

```bash
npx nx run @flows/backend:typecheck --skip-nx-cache
npx nx run @flows/web:typecheck --skip-nx-cache
npx nx run @flows/flows:typecheck --skip-nx-cache
npx nx run @flows/backend:lint --skip-nx-cache
npx nx run @flows/web:lint --skip-nx-cache
npx nx run @flows/flows:lint --skip-nx-cache
npx nx run @flows/backend:test --skip-nx-cache -- --run
git diff --check
```

- [ ] **Step 5: Final code review**

Review against the spec completion criteria:

- user-facing tone selection
- no hardcoded topic fixtures
- source-grounded script generation
- image style propagation
- script review path
- longform Gate A
- longform Gate B smoke
- preview/download proof

- [ ] **Step 6: Commit and push**

Use focused commits per checkpoint if possible. Push to:

```bash
git push origin codex/content-profile-longform-20260513
```

## Final Completion Audit

Before claiming completion, produce a prompt-to-artifact checklist:

| Requirement                 | Evidence                                             |
| --------------------------- | ---------------------------------------------------- |
| 대본 톤 선택                | UI screenshot, approval payload, node config test    |
| 화풍/장면 수/품질 선택      | UI screenshot, backend propagation test              |
| URL-first 대본              | content-block test and paid/no-paid E2E source check |
| 대본 검수                   | Playwright script-first flow                         |
| 12장 이미지                 | paid smoke asset count                               |
| Adam TTS                    | paid smoke asset metadata                            |
| MP4 preview/download        | Playwright screenshot and asset URL                  |
| Longform Gate A             | browser E2E and backend test                         |
| Longform Gate B             | MP4 QA test and smoke output                         |
| Code review after each task | review notes in final report                         |
| No hardcoding               | semantic diff review and rg scan                     |
