# Countryball Skit Writer Root Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make countryball Shorts generation start from a reusable skit-writer brief, preserve a continuous situation skit through script/data/TTS/video contracts, and show the generated dialogue in the node UI.

**Architecture:** Keep countryball as a dedicated product flow. Strengthen `countryball-brief` into a writer brief that selects a skit mechanism, setting, conflict, emotional arc, payoff, scene count, speech flavor, and voice-role plan. Then make `countryball-script`, preview UI, analysis, TTS, and image prompt handling consume the same countryball scene contract without adding countryball logic to general Shorts blocks.

**Tech Stack:** TypeScript, Zod, Vitest, React Testing Library/jsdom, Nx/Vite, existing backend block executors, existing web flow node components.

---

## File Map

- Modify: `apps/backend/src/modules/blocks/countryball-brief-block.ts`
    - Strengthen the system prompt and normalized output with skit-writer fields.
- Modify: `apps/backend/src/modules/blocks/countryball-brief-block.spec.ts`
    - Add prompt-contract tests for skit mechanism and user plot preservation.
- Modify: `apps/backend/src/modules/blocks/types.ts`
    - Add optional countryball brief fields if the current Zod schema rejects them.
- Modify: `apps/backend/src/modules/blocks/countryball/countryball-script-block.ts`
    - Require a continuous skit, consume new brief fields, fix speech flavor rules, and normalize mechanical suffix mistakes.
- Modify: `apps/backend/src/modules/blocks/countryball/countryball-script-block.spec.ts`
    - Add tests for continuous skit prompt contract, scene count, and speech suffix normalization.
- Modify: `apps/backend/src/modules/blocks/countryball/countryball-analysis-block.ts`
    - Add checks for coherent skit premise, narrator-heavy output, mechanical speech flavor, dialogue/voice collapse.
- Modify: `apps/backend/src/modules/blocks/countryball/countryball-analysis-block.spec.ts`
    - Add negative cases for narrator-only and bad speech flavor.
- Modify: `apps/backend/src/modules/blocks/countryball/countryball-image-block.ts`
    - Remove blank speech-bubble/visible caption-space prompting while preserving no-embedded-text guidance.
- Modify: `apps/backend/src/modules/blocks/countryball/countryball-image-block.spec.ts`
    - Assert image prompt avoids embedded text and blank speech bubbles.
- Modify: `apps/backend/src/modules/blocks/countryball/countryball-tts-block.ts`
    - Verify dialogue-line segment order and multi-role voice preservation.
- Modify: `apps/backend/src/modules/blocks/countryball/countryball-tts-block.spec.ts`
    - Add focused order/role tests if missing.
- Modify: `apps/web/src/app/features/flows/components/NodeBlock.tsx`
    - Preview countryball script lines from `scenes`, `normalizedScenes`, and nested script records.
- Modify: `apps/web/src/app/features/flows/components/NodeBlock.spec.tsx`
    - Add tests for normalized scene dialogue preview.
- Modify: `apps/web/src/app/features/flows/components/ContentPreviewModal.tsx`
    - Large script modal reads normalized countryball dialogue.
- Modify: `apps/web/src/app/features/flows/components/ContentPreviewModal.spec.tsx`
    - Add modal test for normalized countryball dialogue.
- Existing boundary test: `apps/backend/src/modules/blocks/block-boundary.spec.ts`
    - Keep general Shorts countryball isolation checks green.

## Task 1: Countryball Brief Becomes A Skit Writer

**Files:**

- Modify: `apps/backend/src/modules/blocks/countryball-brief-block.ts`
- Modify: `apps/backend/src/modules/blocks/countryball-brief-block.spec.ts`
- Modify: `apps/backend/src/modules/blocks/types.ts` only if schema validation rejects the new optional fields

- [ ] **Step 1: Write failing prompt-contract tests**

Add tests to `countryball-brief-block.spec.ts` that assert the brief system prompt contains these requirements:

```ts
expect(COUNTRYBALL_BRIEF_SYSTEM_PROMPT).toContain('skitPremise');
expect(COUNTRYBALL_BRIEF_SYSTEM_PROMPT).toContain('comicMechanism');
expect(COUNTRYBALL_BRIEF_SYSTEM_PROMPT).toContain('emotionalArc');
expect(COUNTRYBALL_BRIEF_SYSTEM_PROMPT).toContain('speechFlavorPlan');
expect(COUNTRYBALL_BRIEF_SYSTEM_PROMPT).toContain('voiceRolePlan');
expect(COUNTRYBALL_BRIEF_SYSTEM_PROMPT).toContain('The brief must preserve explicit user plot order');
```

Also mock `openaiAdapter.chatJson` with a brief for late-night delivery and assert the output includes:

```ts
expect(output.countryballBrief).toMatchObject({
    skitPremise: expect.stringContaining('밤'),
    setting: expect.any(String),
    comicMechanism: expect.any(String),
    emotionalArc: expect.any(String),
    payoff: expect.any(String),
});
expect(output.countryballBrief.storyFlow.length).toBe(output.countryballBrief.recommendedSceneCount);
```

- [ ] **Step 2: Run red test**

Run:

```bash
npx vitest run apps/backend/src/modules/blocks/countryball-brief-block.spec.ts
```

Expected: FAIL because the current prompt/schema does not require or preserve all skit-writer fields.

- [ ] **Step 3: Strengthen `COUNTRYBALL_BRIEF_SYSTEM_PROMPT`**

Update the prompt so it says the block is a countryball skit writer brief strategist, not a generic summary. Add required JSON fields:

```json
{
    "skitPremise": "one acted-out countryball situation",
    "setting": "concrete visual location",
    "comicMechanism": "why the skit is entertaining",
    "emotionalArc": "emotion progression",
    "payoff": "final visual or line",
    "storyFlow": ["ordered action beats"],
    "speechFlavorPlan": { "default": "readable Korean", "countryNotes": [] },
    "voiceRolePlan": { "main": "main_confident", "rival": "rival_smug", "panic": "panic_high" }
}
```

Add mechanism guidance as examples, not branches:

```text
Choose a skit mechanism from the topic: doubt-test-shock, culture shock, meeting argument, historical reenactment, ranking comparison, rival banter, everyday misunderstanding, what-if chaos, or product showcase.
These are writer choices, not hardcoded plots.
```

- [ ] **Step 4: Normalize the new brief fields**

In `normalizeCountryballBriefOutput`, preserve optional fields:

```ts
skitPremise: firstString(rawBrief['skitPremise'], firstString(rawBrief['mainConflict'], requestTopic)),
setting: firstString(rawBrief['setting'], '컨트리볼 상황극 무대'),
comicMechanism: firstString(rawBrief['comicMechanism'], '대사와 리액션으로 핵심 차이를 보여준다'),
emotionalArc: firstString(rawBrief['emotionalArc'], '문제 제기 -> 반응 -> 행동 -> payoff'),
payoff: firstString(rawBrief['payoff'], firstString(rawBrief['endingPayoff'], '짧은 마지막 반응')),
speechFlavorPlan: isRecord(rawBrief['speechFlavorPlan']) ? rawBrief['speechFlavorPlan'] : {},
voiceRolePlan: isRecord(rawBrief['voiceRolePlan']) ? rawBrief['voiceRolePlan'] : {},
```

If `CountryballBriefOutputSchema` rejects these fields, add them as optional fields in `apps/backend/src/modules/blocks/types.ts`.

- [ ] **Step 5: Ensure storyFlow length matches recommendedSceneCount when possible**

If `storyFlow` is shorter than `recommendedSceneCount`, do not invent topic-specific content. Add generic continuation beats derived from the current brief fields:

```ts
const storyFlow = ensureStoryFlowLength(stringArray(rawBrief['storyFlow']), recommendedSceneCount, countryballBrief);
```

`ensureStoryFlowLength` should reuse `skitPremise`, `mainConflict`, `targetFeature`, and `payoff` to create generic action beats such as setup, challenge, reaction, action, escalation, payoff.

- [ ] **Step 6: Run green test**

Run:

```bash
npx vitest run apps/backend/src/modules/blocks/countryball-brief-block.spec.ts
```

Expected: PASS.

## Task 2: Script Generation Requires One Continuous Skit

**Files:**

- Modify: `apps/backend/src/modules/blocks/countryball/countryball-script-block.ts`
- Modify: `apps/backend/src/modules/blocks/countryball/countryball-script-block.spec.ts`

- [ ] **Step 1: Write failing script prompt tests**

Add expectations:

```ts
expect(COUNTRYBALL_SCRIPT_SYSTEM_PROMPT).toContain('one continuous skit');
expect(COUNTRYBALL_SCRIPT_SYSTEM_PROMPT).toContain('skitPremise');
expect(COUNTRYBALL_SCRIPT_SYSTEM_PROMPT).toContain('Do not mechanically append suffixes');
expect(COUNTRYBALL_SCRIPT_SYSTEM_PROMPT).not.toContain('often ends short lines with ~데스');
```

Add a mocked script for the K2 plot and assert `scenes.length === recommendedSceneCount`, all normal scenes have `screenAction`, and dialogue is preserved as short countryball lines.

- [ ] **Step 2: Run red test**

Run:

```bash
npx vitest run apps/backend/src/modules/blocks/countryball/countryball-script-block.spec.ts
```

Expected: FAIL until the prompt and normalization rules are updated.

- [ ] **Step 3: Update script prompt**

Replace suffix-based speech rule with readable speech flavor rules:

```text
Speech flavor must never obscure meaning.
Do not mechanically append suffixes to every sentence.
If a Korean sentence already ends with 요, 네요, 합니다, 하지, or 입니다, do not append 데스.
Japanese-ball flavor may use short natural gag lines only when useful, such as "말도 안 되므니다!", "잠깐만 데스!", or "이건 반칙데스!".
Unknown countries use neutral readable Korean unless the brief provides a speechFlavorPlan.
```

Add continuous skit requirements:

```text
The whole output must feel like one continuous countryball skit.
Use the brief's skitPremise, setting, comicMechanism, emotionalArc, payoff, and storyFlow as the spine.
Do not produce disconnected facts or generic commentary.
Each normal scene should be a call-and-response beat between countryballs unless it is a title, silent reaction, or ending payoff scene.
```

- [ ] **Step 4: Pass new brief fields into the script user message**

In `buildScriptUserMessage`, keep the full `countryballBrief` JSON. Add an explicit line:

```text
COUNTRYBALL SKIT SPINE:
Use skitPremise, setting, comicMechanism, emotionalArc, payoff, storyFlow, speechFlavorPlan, and voiceRolePlan from the brief. If they are present, they are binding.
```

- [ ] **Step 5: Normalize mechanical Japanese suffix mistakes**

Add a helper near `normalizeDialogueLines`:

```ts
function normalizeSpeechFlavor(country: string, line: string): string {
    const normalized = line.replace(/\s+/g, ' ').trim();
    if (!/일본|japan/i.test(country)) return normalized;
    return normalized
        .replace(/(요|네요|합니다|입니다|하죠|하지요)[.。!！?？]*\s*(데스|です)[!！.。?？]*$/i, '$1!')
        .replace(/\.{2,}\s*(데스|です)[!！.。?？]*$/i, '!');
}
```

Use it before slicing:

```ts
const line = normalizeSpeechFlavor(country, compactCountryballText(item['line'] ?? item['text']));
```

This is not topic hardcoding. It is a speech-quality guard.

- [ ] **Step 6: Improve fallback script to use skit premise**

When OpenAI output is absent or mock mode runs, build fallback beats from:

- `skitPremise`
- `mainConflict`
- `storyFlow`
- `payoff`

The fallback should still be generic and never K2/new-delivery specific.

- [ ] **Step 7: Run green test**

Run:

```bash
npx vitest run apps/backend/src/modules/blocks/countryball/countryball-script-block.spec.ts
```

Expected: PASS.

## Task 3: UI Preview Shows Countryball Dialogue

**Files:**

- Modify: `apps/web/src/app/features/flows/components/NodeBlock.tsx`
- Modify: `apps/web/src/app/features/flows/components/NodeBlock.spec.tsx`
- Modify: `apps/web/src/app/features/flows/components/ContentPreviewModal.tsx`
- Modify: `apps/web/src/app/features/flows/components/ContentPreviewModal.spec.tsx`

- [ ] **Step 1: Write failing NodeBlock preview test**

Add a test case where node output has:

```ts
{
  title: '밤 11시 주문, 아침 도착 실화?',
  normalizedScenes: [
    {
      sceneNumber: 1,
      dialogueLines: [
        { country: '미국', line: '너 지금 주문한다고?' },
        { country: '한국', line: '응, 아침에 와.' }
      ]
    }
  ]
}
```

Assert the node preview shows:

```ts
expect(screen.getByText(/미국: 너 지금 주문한다고/)).toBeInTheDocument();
expect(screen.getByText(/한국: 응, 아침에 와/)).toBeInTheDocument();
```

- [ ] **Step 2: Write failing modal test**

Add a `ContentPreviewModal` test with the same `normalizedScenes` input and assert the large script modal renders both dialogue lines.

- [ ] **Step 3: Run red frontend tests**

Run:

```bash
npx vitest run --config apps/web/vite.config.mts apps/web/src/app/features/flows/components/NodeBlock.spec.tsx apps/web/src/app/features/flows/components/ContentPreviewModal.spec.tsx
```

Expected: FAIL because preview only reads top-level `scenes`.

- [ ] **Step 4: Add shared scene extraction helpers in both components**

Add or update helpers:

```ts
const getScriptScenes = (record: Record<string, unknown>): Record<string, unknown>[] => {
    const directScenes = asRecordArray(record.scenes);
    if (directScenes.length > 0) return directScenes;
    const normalizedScenes = asRecordArray(record.normalizedScenes);
    if (normalizedScenes.length > 0) return normalizedScenes;
    const nestedScript = isRecordValue(record.script) ? record.script : undefined;
    const nestedScenes = nestedScript ? asRecordArray(nestedScript.scenes) : [];
    if (nestedScenes.length > 0) return nestedScenes;
    return [];
};
```

Use this instead of `asRecordArray(recordValue?.scenes)` for script previews.

- [ ] **Step 5: Ensure dialogue draft takes priority**

`buildScriptDraft` should prefer countryball `dialogueLines` over generic `caption`, `visualText`, or `narration` when dialogue exists.

- [ ] **Step 6: Run green frontend tests**

Run:

```bash
npx vitest run --config apps/web/vite.config.mts apps/web/src/app/features/flows/components/NodeBlock.spec.tsx apps/web/src/app/features/flows/components/ContentPreviewModal.spec.tsx
```

Expected: PASS.

## Task 4: Analysis, TTS, And Image Guards

**Files:**

- Modify: `apps/backend/src/modules/blocks/countryball/countryball-analysis-block.ts`
- Modify: `apps/backend/src/modules/blocks/countryball/countryball-analysis-block.spec.ts`
- Modify: `apps/backend/src/modules/blocks/countryball/countryball-image-block.ts`
- Modify: `apps/backend/src/modules/blocks/countryball/countryball-image-block.spec.ts`
- Modify: `apps/backend/src/modules/blocks/countryball/countryball-tts-block.ts`
- Modify: `apps/backend/src/modules/blocks/countryball/countryball-tts-block.spec.ts`

- [ ] **Step 1: Add failing analysis tests**

Add cases that reject:

- A scene with long `narratorLine` and no dialogue.
- Japanese dialogue ending in `요. 데스!`.
- Multiple speaking countries all using one `voiceRole`.

- [ ] **Step 2: Add failing image prompt test**

Assert generated countryball image prompts do not contain:

```ts
expect(prompt).not.toMatch(/speech bubble|blank bubble|empty bubble|말풍선/i);
expect(prompt).toContain('No embedded Korean text');
```

- [ ] **Step 3: Add or confirm TTS ordering test**

Assert `countryball-tts` creates segments in scene/dialogue order and preserves different `voiceRole` values.

- [ ] **Step 4: Run red tests**

Run:

```bash
npx vitest run apps/backend/src/modules/blocks/countryball/countryball-analysis-block.spec.ts apps/backend/src/modules/blocks/countryball/countryball-image-block.spec.ts apps/backend/src/modules/blocks/countryball/countryball-tts-block.spec.ts
```

Expected: FAIL for missing guards if they are not already implemented.

- [ ] **Step 5: Implement minimal guards**

Analysis:

- Reject narrator-heavy scenes in countryball mode.
- Reject mechanical suffix pattern `/요[.!?]*\s*데스/i`.
- Keep existing multi-role checks.

Image:

- Remove any prompt instruction asking for blank speech bubbles or obvious caption holes.
- Keep `No embedded Korean text. Captions will be added later in video editing.`

TTS:

- Keep dialogue-line segment mapping.
- Ensure role collapse fails when multiple countries speak.

- [ ] **Step 6: Run green tests**

Run:

```bash
npx vitest run apps/backend/src/modules/blocks/countryball/countryball-analysis-block.spec.ts apps/backend/src/modules/blocks/countryball/countryball-image-block.spec.ts apps/backend/src/modules/blocks/countryball/countryball-tts-block.spec.ts
```

Expected: PASS.

## Task 5: Regression And Deployment Verification

**Files:**

- No planned production files unless earlier tasks expose a narrow issue.

- [ ] **Step 1: Run countryball focused backend tests**

Run:

```bash
npx vitest run apps/backend/src/modules/blocks/countryball-brief-block.spec.ts apps/backend/src/modules/blocks/countryball/countryball-script-block.spec.ts apps/backend/src/modules/blocks/countryball/countryball-analysis-block.spec.ts apps/backend/src/modules/blocks/countryball/countryball-image-block.spec.ts apps/backend/src/modules/blocks/countryball/countryball-tts-block.spec.ts apps/backend/src/modules/blocks/countryball/countryball-video-block.spec.ts apps/backend/src/modules/blocks/block-boundary.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run frontend preview tests**

Run:

```bash
npx vitest run --config apps/web/vite.config.mts apps/web/src/app/features/flows/components/NodeBlock.spec.tsx apps/web/src/app/features/flows/components/ContentPreviewModal.spec.tsx apps/web/src/app/features/flows/components/FlowAgentPanel.spec.tsx
```

Expected: PASS.

- [ ] **Step 3: Run backend typecheck**

Run:

```bash
npx tsc -p apps/backend/tsconfig.json --noEmit
```

Expected: PASS.

- [ ] **Step 4: Run web build**

Run:

```bash
yarn web:build:dev
```

Expected: PASS.

- [ ] **Step 5: Run diff whitespace check**

Run:

```bash
git diff --check
```

Expected: PASS.

- [ ] **Step 6: Commit implementation**

Run:

```bash
git add apps/backend/src/modules/blocks/countryball-brief-block.ts apps/backend/src/modules/blocks/countryball-brief-block.spec.ts apps/backend/src/modules/blocks/types.ts apps/backend/src/modules/blocks/countryball apps/web/src/app/features/flows/components/NodeBlock.tsx apps/web/src/app/features/flows/components/NodeBlock.spec.tsx apps/web/src/app/features/flows/components/ContentPreviewModal.tsx apps/web/src/app/features/flows/components/ContentPreviewModal.spec.tsx
git commit -m "fix: strengthen countryball skit writer flow"
```

- [ ] **Step 7: Deploy backend and web to the agreed CloudFront target**

Use the existing dev deploy commands and keep the user-facing URL as:

```text
https://d37nj585pnjtts.cloudfront.net/
```

After deploy, verify the CloudFront HTML references the new bundle hash and that backend CORS still accepts the CloudFront origin.

## Self-Review

- Spec coverage: The plan covers skit brief, script contract, UI preview, speech flavor, TTS, image prompt, QA, boundary tests, and deploy verification.
- Completeness scan: No TBD/TODO gaps are present.
- Type consistency: The plan consistently uses `skitPremise`, `comicMechanism`, `emotionalArc`, `speechFlavorPlan`, `voiceRolePlan`, `scenes`, `normalizedScenes`, `dialogueLines`, `captionOverlay`, and `voiceRole`.
- Scope: This is one vertical root fix for countryball generation quality and preview visibility. It does not redesign the general Shorts pipeline.
