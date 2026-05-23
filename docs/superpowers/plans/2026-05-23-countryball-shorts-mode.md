# Countryball Shorts Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a countryball-specific mode to the existing Shorts workflow so users can request or select countryball Shorts and receive source-grounded situation reenactment scripts and scene-structured image prompts.

**Architecture:** Keep the existing `shorts` recipe and add countryball as a Shorts content/profile mode plus image style preset. Countryball is a narrative mode, not just an image style: it reenacts a real event, conflict, negotiation, economic situation, diplomatic moment, or historical situation with countryball characters. The mode is selected only by explicit countryball/polandball/national-ball intent or proposal-card choice, then propagated through content, data, analysis, media-image, TTS, video, and integration node configs. The implementation is additive: existing general Shorts, image-only, longform, script-first review, and recovery behavior must remain unchanged.

**Core Contract:** Countryball output must distinguish `factualClaim` from `dramatizedAction`. Dialogue lines are a reenactment tool, not the primary success criterion. Each countryball run should expose:

- `contentProfileId: 'shorts.countryball.v1'`
- `narrativeMode: 'historical-situation-reenactment'`
- `visualStyle: 'countryball-comic'`
- `sourceEvent`
- `reenactmentFrame`
- `cast`
- `sceneBeats[]`
- scene prompt fields: `characters`, `props`, `background`, `historicalContext`, `captionIntent`, `safetyNotes`

**Execution Order:** Implement in this order even though file-level tasks are listed by code surface below: shared contract -> countryball situation profile -> image style -> source/event grounding rulepack -> reenactment content generator -> analysis/QA -> proposal propagation -> frontend controls -> full regression verification.

**Tech Stack:** TypeScript, Zod contracts in `libs/contracts`, backend Vitest, React/Vitest/jsdom frontend tests, existing `@flows/backend` and `@flows/web` Nx targets.

---

## File Map

- Modify: `libs/contracts/src/http/proposals.schema.ts`
    - Adds shared enum values for `shorts.countryball.v1` and `countryball-comic`.
- Modify: `apps/backend/src/modules/content-profile/content-profile.ts`
    - Adds countryball profile option and narrow explicit-intent countryball inference.
- Modify: `apps/backend/src/modules/content-profile/content-profile.spec.ts`
    - Tests profile inference and option alignment.
- Modify: `apps/backend/src/modules/image-generation/image-style.ts`
    - Adds countryball style preset and recommendation logic.
- Test: `apps/backend/src/modules/orchestrator/workflow-compiler.spec.ts`
    - Existing image-style preference tests can cover preset normalization if needed.
- Create: `apps/backend/src/modules/shorts/rulepacks/countryball-shorts-rulepack.ts`
    - Holds countryball situation-reenactment, scene prompt, grounding, visual, and review prompt rules.
- Modify: `apps/backend/src/modules/shorts/rulepacks/base-shorts-rulepack.ts`
    - Extends `ShortsRulepack.id`.
- Modify: `apps/backend/src/modules/shorts/topic-router.ts`
    - Routes explicit countryball keywords and profile metadata to the countryball rulepack.
- Test: create or extend `apps/backend/src/modules/shorts/topic-router.spec.ts`
    - Verifies countryball routing and default routing.
- Modify: `apps/backend/src/modules/blocks/content-block.ts`
    - Lets countryball content profile enrich the Shorts prompt with countryball dialogue contract.
- Modify: `apps/backend/src/modules/blocks/content-block.spec.ts`
    - Tests countryball prompt/config behavior without making paid calls.
- Modify: `apps/backend/src/modules/blocks/analysis-block.ts`
    - Adds countryball-specific safety/factual review rules.
- Modify: `apps/backend/src/modules/blocks/analysis-block.spec.ts`
    - Tests nationality-wide insults and unsupported historical claims are flagged.
- Modify: `apps/backend/src/modules/orchestrator/openai-orchestrator.ts`
    - Ensures AI-selected Shorts proposals preserve countryball defaults.
- Modify: `apps/backend/src/modules/orchestrator/openai-orchestrator.spec.ts`
    - Tests countryball request defaults.
- Modify: `apps/backend/src/modules/orchestrator/mock-orchestrator.ts`
    - Keeps local/mock proposal behavior aligned.
- Modify: `apps/backend/src/modules/orchestrator/mock-orchestrator.spec.ts`
    - Tests mock countryball defaults.
- Modify: `apps/web/src/app/features/flows/components/FlowAgentPanel.tsx`
    - Adds frontend union values and shows `컨트리볼` as a Shorts profile option.
- Modify: `apps/web/src/app/features/flows/components/FlowAgentPanel.spec.tsx`
    - Tests selection and approve payload.

## Task 1: Shared Contract Values

**Files:**

- Modify: `libs/contracts/src/http/proposals.schema.ts`
- Modify: `apps/backend/src/modules/content-profile/content-profile.spec.ts`

- [ ] **Step 1: Write the failing contract alignment test**

Add this assertion inside `keeps option ids aligned with the shared proposal contract schemas` in `apps/backend/src/modules/content-profile/content-profile.spec.ts`:

```ts
expect(ContentProfileIdSchema.options).toContain('shorts.countryball.v1');
```

Also add this assertion in the same test:

```ts
expect(ProposalApproveRequestSchema.safeParse({ contentProfileId: 'shorts.countryball.v1' }).success).toBe(true);
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
npx vitest run apps/backend/src/modules/content-profile/content-profile.spec.ts
```

Expected: FAIL because `shorts.countryball.v1` is not in `ContentProfileIdSchema`.

- [ ] **Step 3: Add contract enum values**

In `libs/contracts/src/http/proposals.schema.ts`, change `ContentProfileIdSchema` to include the new Shorts profile:

```ts
export const ContentProfileIdSchema = z.enum([
    'text.explainer.v1',
    'image.single.v1',
    'shorts.info.v1',
    'shorts.story.v1',
    'shorts.countryball.v1',
    'longform.explainer.v1',
    'longform.documentary.v1',
]);
```

Change `ImageStyleIdSchema` to include the new image style:

```ts
export const ImageStyleIdSchema = z.enum([
    'explainer-comic',
    'animation',
    'photo-real',
    'research-visual',
    'blueprint',
    'newspaper',
    'app-ui',
    'icon-design',
    'countryball-comic',
]);
```

- [ ] **Step 4: Run the focused test and confirm it passes**

Run:

```bash
npx vitest run apps/backend/src/modules/content-profile/content-profile.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add libs/contracts/src/http/proposals.schema.ts apps/backend/src/modules/content-profile/content-profile.spec.ts
git commit -m "feat: add countryball shorts contract values"
```

## Task 2: Content Profile Inference and Options

**Files:**

- Modify: `apps/backend/src/modules/content-profile/content-profile.ts`
- Modify: `apps/backend/src/modules/content-profile/content-profile.spec.ts`

- [ ] **Step 1: Write failing profile tests**

Add this test to `apps/backend/src/modules/content-profile/content-profile.spec.ts`:

```ts
it('detects countryball Shorts requests and keeps general Shorts selectable', () => {
    const prefs = buildContentProfilePreferences({
        userMessage: '미국 육사 교재에 실린 한국인 이야기를 컨트리볼 쇼츠로 만들어줘',
        outputType: 'video',
        hasMediaVideo: true,
    });

    expect(prefs.contentProfileId).toBe('shorts.countryball.v1');
    expect(prefs.scriptToneId).toBe('story-dialogue');
    expect(prefs.narrativeMode).toBe('historical-situation-reenactment');
    expect(prefs.profileOptions.map(option => option.id)).toEqual(['shorts.info.v1', 'shorts.countryball.v1']);
});

it('does not infer countryball from generic geopolitical Shorts requests', () => {
    const prefs = buildContentProfilePreferences({
        userMessage: '미중갈등 쇼츠 만들어줘',
        outputType: 'video',
        hasMediaVideo: true,
    });

    expect(prefs.contentProfileId).toBe('shorts.info.v1');
    expect(prefs.profileOptions.map(option => option.id)).toEqual(['shorts.info.v1', 'shorts.countryball.v1']);
});
```

- [ ] **Step 2: Run focused test and confirm it fails**

Run:

```bash
npx vitest run apps/backend/src/modules/content-profile/content-profile.spec.ts
```

Expected: FAIL because countryball detection and options are not implemented.

- [ ] **Step 3: Add countryball profile option**

In `apps/backend/src/modules/content-profile/content-profile.ts`, add an optional `narrativeMode` field to `ContentProfilePreferences`:

```ts
narrativeMode?: 'historical-situation-reenactment';
```

Then update `CONTENT_PROFILE_OPTIONS`:

```ts
export const CONTENT_PROFILE_OPTIONS: ContentProfilePreferences['profileOptions'] = [
    { id: 'text.explainer.v1', label: '텍스트 설명', description: '글 또는 요약 산출물' },
    { id: 'image.single.v1', label: '단일 이미지', description: '한 장 이미지 산출물' },
    { id: 'shorts.info.v1', label: '일반 쇼츠', description: 'AI가 내용 성격을 판단하는 45-60초 세로형 쇼츠' },
    {
        id: 'shorts.countryball.v1',
        label: '컨트리볼',
        description: '국가볼 캐릭터가 실제 사건/상황을 상황극으로 재연하는 쇼츠 형식',
    },
    { id: 'shorts.story.v1', label: '쇼츠 제작', description: '이전 워크플로우 호환용 쇼츠 프로필' },
    { id: 'longform.explainer.v1', label: '롱폼 해설', description: '3-5분 이상 해설 영상' },
    { id: 'longform.documentary.v1', label: '롱폼 다큐', description: '자료 기반 다큐형 영상' },
];
```

- [ ] **Step 4: Update Shorts profile option scoping**

In `profileOptionsFor`, replace the current Shorts branch:

```ts
if (family === 'shorts') {
    return CONTENT_PROFILE_OPTIONS.filter(option => option.id === 'shorts.info.v1');
}
```

with:

```ts
if (family === 'shorts') {
    return CONTENT_PROFILE_OPTIONS.filter(
        option => option.id === 'shorts.info.v1' || option.id === 'shorts.countryball.v1'
    );
}
```

- [ ] **Step 5: Add countryball inference**

Add a helper above `inferContentProfileId`. Keep the matcher narrow: generic topics like `미중갈등`, `브렉시트`, `세계사`, or `국제정세` must not trigger countryball unless the user explicitly asks for countryball/polandball/national-ball style.

```ts
export const isCountryballShortsRequest = (value: string): boolean =>
    /컨트리볼|countryball|polandball|폴란드볼|국가볼|국가\s*의인화/.test(value.toLowerCase()) ||
    /(?:한국볼|일본볼|미국볼|중국볼|러시아볼).*(?:쇼츠|shorts|상황극|재연|스타일)|(?:쇼츠|shorts|상황극|재연|스타일).*(?:한국볼|일본볼|미국볼|중국볼|러시아볼)/.test(
        value.toLowerCase()
    );
```

Then update the Shorts branch in `inferContentProfileId`:

```ts
if (/쇼츠|shorts|릴스|reels|틱톡|tiktok/.test(text) || params.hasMediaVideo || params.outputType === 'video') {
    return isCountryballShortsRequest(text) ? 'shorts.countryball.v1' : 'shorts.info.v1';
}
```

- [ ] **Step 6: Make countryball default to story tone plus reenactment narrative mode**

In `buildContentProfilePreferences`, change `scriptToneId` assignment from:

```ts
scriptToneId: normalizeScriptToneId(params.scriptToneId ?? params.userMessage),
```

to:

```ts
scriptToneId:
    contentProfileId === 'shorts.countryball.v1'
        ? normalizeScriptToneId(params.scriptToneId ?? 'story-dialogue')
        : normalizeScriptToneId(params.scriptToneId ?? params.userMessage),
narrativeMode:
    contentProfileId === 'shorts.countryball.v1' ? 'historical-situation-reenactment' : undefined,
```

- [ ] **Step 7: Run focused test**

Run:

```bash
npx vitest run apps/backend/src/modules/content-profile/content-profile.spec.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

Run:

```bash
git add apps/backend/src/modules/content-profile/content-profile.ts apps/backend/src/modules/content-profile/content-profile.spec.ts
git commit -m "feat: infer countryball shorts profile"
```

## Task 3: Countryball Image Style

**Files:**

- Modify: `apps/backend/src/modules/image-generation/image-style.ts`
- Modify: `apps/backend/src/modules/orchestrator/workflow-compiler.spec.ts`
- Modify: `apps/backend/src/modules/orchestrator/openai-orchestrator.spec.ts`

- [ ] **Step 1: Write failing image style assertions**

Add this test to `apps/backend/src/modules/orchestrator/workflow-compiler.spec.ts`:

```ts
it('recommends the countryball image style for countryball requests', () => {
    const prefs = buildImageGenerationPreferences({
        userMessage: '컨트리볼 쇼츠 만들어줘',
        sceneCount: 12,
    });

    expect(prefs.imageStyleId).toBe('countryball-comic');
    expect(prefs.imageStyleLabel).toBe('컨트리볼 만화');
    expect(prefs.styleOptions.map(option => option.id)).toContain('countryball-comic');
});
```

- [ ] **Step 2: Run focused test and confirm it fails**

Run:

```bash
npx vitest run apps/backend/src/modules/orchestrator/workflow-compiler.spec.ts
```

Expected: FAIL because `countryball-comic` is not in `ImageStyleId`.

- [ ] **Step 3: Add backend image style union value**

In `apps/backend/src/modules/image-generation/image-style.ts`, add this value to `ImageStyleId`:

```ts
| 'countryball-comic';
```

- [ ] **Step 4: Add countryball preset**

Append this object to `IMAGE_STYLE_PRESETS`:

```ts
{
    id: 'countryball-comic',
    label: '컨트리볼 만화',
    description: '국가볼 캐릭터가 실제 사건/상황을 상황극으로 재연하는 만화 컷',
    promptPrefix:
        'countryball comic style for Korean Shorts, source-grounded situation reenactment, spherical flag-colored country characters, expressive eyes and eyebrows, simple hands, clear props, bold clean outlines, historical/political/economic/diplomatic reenactment scene, mobile-first composition, avoid offensive national or ethnic stereotypes',
},
```

- [ ] **Step 5: Recommend countryball style from user text**

In `recommendImageStyleId`, add this check before other topic checks:

```ts
if (isCountryballShortsRequest(text)) return 'countryball-comic';
```

In `detectUserRequestedImageStyleId`, add this check before comic/cartoon:

```ts
if (isCountryballShortsRequest(text)) {
    return 'countryball-comic';
}
```

- [ ] **Step 6: Add countryball-specific prompt sanitization if needed**

In `sanitizeVisualPromptForStyle`, no conflict pattern is required for `countryball-comic` in the first pass. Do not add broad sanitizers that remove country names, flags, history, or politics.

- [ ] **Step 7: Run focused test**

Run:

```bash
npx vitest run apps/backend/src/modules/orchestrator/workflow-compiler.spec.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

Run:

```bash
git add apps/backend/src/modules/image-generation/image-style.ts apps/backend/src/modules/orchestrator/workflow-compiler.spec.ts
git commit -m "feat: add countryball image style"
```

## Task 4: Countryball Shorts Rulepack and Routing

**Files:**

- Create: `apps/backend/src/modules/shorts/rulepacks/countryball-shorts-rulepack.ts`
- Modify: `apps/backend/src/modules/shorts/rulepacks/base-shorts-rulepack.ts`
- Modify: `apps/backend/src/modules/shorts/topic-router.ts`
- Create: `apps/backend/src/modules/shorts/topic-router.spec.ts`

- [ ] **Step 1: Write failing router tests**

Create `apps/backend/src/modules/shorts/topic-router.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { selectShortsRulepack } from './topic-router';

describe('selectShortsRulepack', () => {
    it('selects the countryball rulepack for countryball requests', () => {
        expect(selectShortsRulepack('미국 육사 이야기를 컨트리볼 쇼츠로 만들어줘').id).toBe('countryball-shorts');
        expect(selectShortsRulepack({ contentProfileId: 'shorts.countryball.v1' }).id).toBe('countryball-shorts');
    });

    it('keeps general Shorts as the default', () => {
        expect(selectShortsRulepack('AI 뉴스 쇼츠 만들어줘').id).toBe('general-shorts');
        expect(selectShortsRulepack('미중갈등 쇼츠 만들어줘').id).toBe('general-shorts');
    });
});
```

- [ ] **Step 2: Run focused test and confirm it fails**

Run:

```bash
npx vitest run apps/backend/src/modules/shorts/topic-router.spec.ts
```

Expected: FAIL because countryball rulepack does not exist.

- [ ] **Step 3: Extend rulepack id type**

In `apps/backend/src/modules/shorts/rulepacks/base-shorts-rulepack.ts`, change:

```ts
id: 'education-admission' | 'general-shorts';
```

to:

```ts
id: 'education-admission' | 'general-shorts' | 'countryball-shorts';
```

- [ ] **Step 4: Create countryball rulepack**

Create `apps/backend/src/modules/shorts/rulepacks/countryball-shorts-rulepack.ts`:

```ts
import type { ShortsRulepack } from './base-shorts-rulepack';

export const COUNTRYBALL_SHORTS_RULEPACK: ShortsRulepack = {
    id: 'countryball-shorts',
    label: '컨트리볼 쇼츠',
    triggerKeywords: ['컨트리볼', 'countryball', 'polandball', '폴란드볼', '국가볼', '국가 의인화'],
    sourcePolicy: `Countryball source policy:
- Historical, political, military, diplomatic, and economic claims need evidenceRefs when source material exists.
- Satire is allowed, but factual framing must stay source-backed.
- Do not invent exact statistics, dates, documents, textbook claims, or official positions.
- Keep factualClaim separate from dramatizedAction so review can distinguish fact from satire.`,
    searchPrompt: `Countryball search rules:
- Search for the factual spine: who, what, when, where, why it matters.
- Prefer official, museum, academic, reputable news, or primary source material.
- Keep direct source coverage separate from background context.`,
    contentPrompt: `Countryball script rules:
- Write a countryball situation reenactment, not a one-speaker lecture and not dialogue for its own sake.
- Use 2-4 recurring country characters when useful, each with a clear role in the situation.
- Add top-level sourceEvent, reenactmentFrame, cast, and sceneBeats when possible.
- Each sceneBeat should separate factualClaim, dramatizedAction, dialogueLines, visualPromptBrief, and evidenceRefs.
- Each scene should have a clear story beat: hook, setup, conflict, reveal, reaction, consequence, takeaway, or CTA.
- Each scene may include dialogue: [{ "speaker": "korea", "line": "..." }], but dialogue is only a reenactment tool.
- Narration should be short and can frame the scene, but the perceived story should come from countryball actions, reactions, props, and situation changes.
- Keep captions punchy but not insulting toward nationalities or ethnic groups.
- Keep imagePrompt style-neutral except for the countryball subject itself. The media-image style preset applies the final art style.`,
    imagePrompt: `Countryball visual rules:
- Build prompts from a scene prompt contract: sceneNumber, characters[{countryCode, expression, pose}], props, background, historicalContext, captionIntent, safetyNotes.
- Show spherical flag-colored country characters with expressive eyes, eyebrows, simple arms, sweat drops, angry marks, surprise marks, and clear props.
- Use settings such as military academy, museum, palace, battlefield map, trade port, office, factory, classroom, or diplomatic table based on the story.
- Limit most scenes to 1-3 main countryballs.
- Do not rely on GPT-image for final title bands, subtitles, URLs, watermarks, or source labels.
- Leave safe space for compositor overlays.`,
    analysisPrompt: `Countryball analysis rules:
- Reject or request revision for national or ethnic slurs.
- Reject captions that imply an entire nationality is stupid, evil, dirty, inferior, or subhuman.
- Reject unsupported historical claims presented as fact.
- Reject factual claims without evidenceRefs when the scene presents specific dates, statistics, documents, textbook claims, official positions, wars, current conflicts, or diplomatic decisions.
- Reject glorification of war crimes, colonization, or civilian harm.
- Reject insulting national or ethnic stereotypes.
- Allow light satire only when the factual spine remains accurate, source-backed, and separated from dramatizedAction.`,
};
```

- [ ] **Step 5: Route countryball requests**

In `apps/backend/src/modules/shorts/topic-router.ts`, import the new rulepack:

```ts
import { COUNTRYBALL_SHORTS_RULEPACK } from './rulepacks/countryball-shorts-rulepack';
```

Then update `selectShortsRulepack` before education-admission checks:

```ts
if (text.includes(COUNTRYBALL_SHORTS_RULEPACK.id)) return COUNTRYBALL_SHORTS_RULEPACK;
if (
    isCountryballShortsRequest(text) ||
    COUNTRYBALL_SHORTS_RULEPACK.triggerKeywords.some(keyword => text.includes(keyword))
) {
    return COUNTRYBALL_SHORTS_RULEPACK;
}
```

Update `extractRoutingText` object values to include:

```ts
obj['contentProfileId'],
obj['imageStyleId'],
```

- [ ] **Step 6: Run focused test**

Run:

```bash
npx vitest run apps/backend/src/modules/shorts/topic-router.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

Run:

```bash
git add apps/backend/src/modules/shorts/rulepacks/base-shorts-rulepack.ts apps/backend/src/modules/shorts/rulepacks/countryball-shorts-rulepack.ts apps/backend/src/modules/shorts/topic-router.ts apps/backend/src/modules/shorts/topic-router.spec.ts
git commit -m "feat: add countryball shorts rulepack"
```

## Task 5: Content Block Prompt Integration

**Files:**

- Modify: `apps/backend/src/modules/blocks/content-block.ts`
- Modify: `apps/backend/src/modules/blocks/content-block.spec.ts`

- [ ] **Step 1: Write failing prompt/config test**

Add this test to `apps/backend/src/modules/blocks/content-block.spec.ts` near existing Shorts content tests:

```ts
it('adds countryball reenactment instructions when the content profile is countryball Shorts', async () => {
    const result = await executeContentBlockForTest(
        {
            topic: '미국 육사 교재에 실린 한국인',
            contentProfileId: 'shorts.countryball.v1',
            mode: 'shorts',
        },
        { contentProfileId: 'shorts.countryball.v1', scenes: 12 }
    );

    expect(result.output).toEqual(
        expect.objectContaining({
            style: expect.objectContaining({
                visualGrammar: expect.objectContaining({
                    mode: 'countryball',
                    reenactment: true,
                }),
                narrativeMode: 'historical-situation-reenactment',
                visualStyle: 'countryball-comic',
            }),
        })
    );
});
```

Use the existing test helper in the file. If the helper name differs, adapt only the call site to the local helper without changing production logic.

- [ ] **Step 2: Run focused test and confirm it fails**

Run:

```bash
npx vitest run apps/backend/src/modules/blocks/content-block.spec.ts
```

Expected: FAIL because the content prompt/output normalization does not yet force countryball grammar.

- [ ] **Step 3: Add countryball prompt enrichment**

In `apps/backend/src/modules/blocks/content-block.ts`, import the rulepack through the existing router path. The file already uses `selectShortsRulepack`, so keep the change local.

Add a helper near other content-mode helpers:

```ts
function isCountryballContentProfile(input: unknown, config?: Record<string, unknown>): boolean {
    const values: unknown[] = [config?.['contentProfileId']];
    if (input && typeof input === 'object' && !Array.isArray(input)) {
        const obj = input as Record<string, unknown>;
        values.push(obj['contentProfileId'], obj['mode']);
    }
    return values
        .filter((value): value is string => typeof value === 'string')
        .some(value => value === 'shorts.countryball.v1' || isCountryballShortsRequest(value));
}
```

When constructing the Shorts system prompt, append countryball-specific output instructions if `isCountryballContentProfile(input, config)` is true:

```ts
const countryballOutputRules = isCountryballContentProfile(input, config)
    ? `Countryball output addendum:
- Add top-level "sourceEvent", "reenactmentFrame", and "cast" when possible.
- Each scene should separate "factualClaim" from "dramatizedAction".
- Each scene may include "dialogue": [{ "speaker": "korea", "line": "..." }], but dialogue supports reenactment and is not the goal.
- Add "countryballScene" with sceneNumber, characters[{countryCode, expression, pose}], props, background, historicalContext, captionIntent, and safetyNotes.
- Set style.narrativeMode to "historical-situation-reenactment", style.visualStyle to "countryball-comic", style.visualGrammar.mode to "countryball", and style.visualGrammar.reenactment to true.
- Keep narration short; make the scene feel like country characters are reenacting a real situation.`
    : '';
```

Then include `countryballOutputRules` in the final system prompt assembly for Shorts.

- [ ] **Step 4: Normalize countryball style metadata**

In the existing `normalizeStyle` function, preserve existing style fields and add a countryball branch:

```ts
if (
    requestSpec['contentProfileId'] === 'shorts.countryball.v1' ||
    style['contentProfileId'] === 'shorts.countryball.v1'
) {
    return {
        ...normalized,
        visualGrammar: {
            ...(isRecord(normalized['visualGrammar']) ? normalized['visualGrammar'] : {}),
            mode: 'countryball',
            reenactment: true,
        },
        narrativeMode: 'historical-situation-reenactment',
        visualStyle: 'countryball-comic',
    };
}
```

If `normalizeStyle` does not have access to `requestSpec`, pass a boolean from the executor path instead of reading a global variable.

- [ ] **Step 5: Run focused test**

Run:

```bash
npx vitest run apps/backend/src/modules/blocks/content-block.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

Run:

```bash
git add apps/backend/src/modules/blocks/content-block.ts apps/backend/src/modules/blocks/content-block.spec.ts
git commit -m "feat: apply countryball script grammar"
```

## Task 6: Proposal Defaults and Orchestrator Metadata

**Files:**

- Modify: `apps/backend/src/modules/orchestrator/openai-orchestrator.ts`
- Modify: `apps/backend/src/modules/orchestrator/openai-orchestrator.spec.ts`
- Modify: `apps/backend/src/modules/orchestrator/mock-orchestrator.ts`
- Modify: `apps/backend/src/modules/orchestrator/mock-orchestrator.spec.ts`

- [ ] **Step 1: Write failing OpenAI orchestrator test**

Add this test to `apps/backend/src/modules/orchestrator/openai-orchestrator.spec.ts`:

```ts
it('defaults countryball Shorts requests to the countryball profile and image style', async () => {
    vi.mocked(openaiAdapter.chatJson).mockImplementation(async request => {
        if (request.systemPrompt.includes('request intent and recipe planner')) {
            return {
                content: JSON.stringify({
                    ...genericDecision('shorts.info.v1', '미국 육사 이야기를 컨트리볼 쇼츠로 만들어줘'),
                    mode: 'story',
                    reason: '컨트리볼 형식의 쇼츠 요청입니다.',
                }),
                model: 'gpt-test',
                inputTokens: 1,
                outputTokens: 1,
                latencyMs: 1,
            };
        }
        throw new Error('full workflow planner should not be called for an AI-selected shorts recipe');
    });

    const proposal = await openaiOrchestrator.generateProposal(
        'flow-countryball',
        '미국 육사 교재에 실린 한국인 이야기를 컨트리볼 쇼츠로 만들어줘'
    );

    expect(proposal.metadata?.['contentProfile']).toEqual(
        expect.objectContaining({
            contentProfileId: 'shorts.countryball.v1',
            scriptToneId: 'story-dialogue',
            narrativeMode: 'historical-situation-reenactment',
        })
    );
    expect(proposal.metadata?.['imageGeneration']).toEqual(
        expect.objectContaining({
            imageStyleId: 'countryball-comic',
            imageStyleLabel: '컨트리볼 만화',
        })
    );
    expect(proposal.proposedNodes.find(node => node.blockType === 'content')?.config).toEqual(
        expect.objectContaining({ contentProfileId: 'shorts.countryball.v1' })
    );
    expect(proposal.proposedNodes.find(node => node.blockType === 'media-image')?.config).toEqual(
        expect.objectContaining({ imageStyleId: 'countryball-comic' })
    );
});
```

- [ ] **Step 2: Run focused orchestrator test and confirm it fails**

Run:

```bash
npx vitest run apps/backend/src/modules/orchestrator/openai-orchestrator.spec.ts
```

Expected: FAIL if countryball profile/image defaults are not propagated.

- [ ] **Step 3: Preserve countryball profile in generic Shorts proposal path**

In `apps/backend/src/modules/orchestrator/openai-orchestrator.ts`, when `buildContentProfilePreferences` is called for `aiGenericWorkflow`, set `contentProfileId` using the same narrow countryball inference helper rather than only image-single. Do not duplicate a broad regex here.

```ts
import { isCountryballShortsRequest } from '../content-profile/content-profile';
```

Then:

```ts
contentProfileId:
    aiRecipeDecision.recipeId === 'image.single.v1'
        ? 'image.single.v1'
        : isCountryballShortsRequest(userMessage)
          ? 'shorts.countryball.v1'
          : undefined,
```

- [ ] **Step 4: Align mock orchestrator**

In `apps/backend/src/modules/orchestrator/mock-orchestrator.ts`, ensure mock countryball requests produce:

```ts
contentProfileId: 'shorts.countryball.v1';
imageStyleId: 'countryball-comic';
```

Use `buildContentProfilePreferences` and `recommendImageStyleId` rather than hardcoding both values in separate places.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npx vitest run apps/backend/src/modules/orchestrator/openai-orchestrator.spec.ts apps/backend/src/modules/orchestrator/mock-orchestrator.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

Run:

```bash
git add apps/backend/src/modules/orchestrator/openai-orchestrator.ts apps/backend/src/modules/orchestrator/openai-orchestrator.spec.ts apps/backend/src/modules/orchestrator/mock-orchestrator.ts apps/backend/src/modules/orchestrator/mock-orchestrator.spec.ts
git commit -m "feat: default countryball shorts proposals"
```

## Task 7: Frontend Proposal Controls

**Files:**

- Modify: `apps/web/src/app/features/flows/components/FlowAgentPanel.tsx`
- Modify: `apps/web/src/app/features/flows/components/FlowAgentPanel.spec.tsx`

- [ ] **Step 1: Write failing frontend test**

Add this test to `apps/web/src/app/features/flows/components/FlowAgentPanel.spec.tsx`:

```tsx
it('lets the user select countryball mode for Shorts proposals', async () => {
    const countryballProposal: MessageProposal = {
        ...proposal,
        id: 'proposal-countryball',
        metadata: {
            ...proposal.metadata,
            contentProfile: {
                ...proposal.metadata?.contentProfile,
                contentProfileId: 'shorts.info.v1',
                profileOptions: [
                    { id: 'shorts.info.v1', label: '일반 쇼츠', description: '일반 쇼츠' },
                    {
                        id: 'shorts.countryball.v1',
                        label: '컨트리볼',
                        description: '국가볼 캐릭터가 실제 사건/상황을 상황극으로 재연하는 쇼츠',
                    },
                ],
            },
            imageGeneration: {
                model: 'gpt-image-2',
                imageStyleId: 'explainer-comic',
                imageQuality: 'medium',
                sceneCount: 12,
                styleOptions: [
                    { id: 'explainer-comic', label: '정보전달 만화' },
                    { id: 'countryball-comic', label: '컨트리볼 만화' },
                ],
                sceneCountOptions: [{ count: 12, label: '12장' }],
                qualityOptions: [{ id: 'medium', label: 'medium', estimatedImageCostUsd: 0.492 }],
            },
        },
    };

    render(
        <FlowAgentPanel
            open
            onClose={() => undefined}
            flowId="flow-1"
            externalProposal={{
                type: 'proposal.created',
                id: 'proposal-created-countryball',
                proposalId: countryballProposal.id,
                flowId: 'flow-1',
                blocks: countryballProposal.blocks,
                estimatedCost: countryballProposal.estimatedCost,
                metadata: countryballProposal.metadata,
                description: '컨트리볼 제안',
                timestamp: Date.now(),
            }}
        />
    );

    expect(await screen.findByText('대본/콘텐츠 설정')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '컨트리볼' }));
    fireEvent.click(screen.getByRole('button', { name: '컨트리볼 만화' }));
    fireEvent.click(screen.getByRole('button', { name: '승인' }));

    await waitFor(() => {
        expect(approveProposal).toHaveBeenCalledWith(
            'proposal-countryball',
            expect.objectContaining({
                contentProfileId: 'shorts.countryball.v1',
                imageStyleId: 'countryball-comic',
            })
        );
    });
});
```

- [ ] **Step 2: Run focused frontend test and confirm it fails**

Run:

```bash
npx vitest run apps/web/src/app/features/flows/components/FlowAgentPanel.spec.tsx
```

Expected: FAIL because frontend unions do not include countryball values.

- [ ] **Step 3: Add frontend union values**

In `apps/web/src/app/features/flows/components/FlowAgentPanel.tsx`, add `countryball-comic` to `ImageStyleId`:

```ts
| 'countryball-comic';
```

Add `shorts.countryball.v1` to `ContentProfileId`:

```ts
| 'shorts.countryball.v1'
```

- [ ] **Step 4: Update decision label**

In `describeAiContentDecision`, add this check first inside `isShortsContentProfileId` branch:

```ts
if (contentProfileId === 'shorts.countryball.v1') return '컨트리볼 쇼츠';
```

- [ ] **Step 5: Ensure profile choices are visible for Shorts**

Current logic hides profile choices for Shorts:

```ts
const shouldShowProfileChoices = !isShortsProposal && visibleProfileOptions.length > 1;
```

Change it to:

```ts
const shouldShowProfileChoices = visibleProfileOptions.length > 1 && !isImageProposal;
```

This keeps image-only proposals clean while allowing general Shorts vs countryball selection.

- [ ] **Step 6: Auto-select countryball image style when countryball profile is selected**

In the countryball profile button `onClick`, also set image style when the selected option is countryball:

```ts
onClick={() => {
    setProposalContentProfiles(prev => ({
        ...prev,
        [proposal.id]: option.id,
    }));
    if (option.id === 'shorts.countryball.v1') {
        setProposalImageStyles(prev => ({
            ...prev,
            [proposal.id]: 'countryball-comic',
        }));
    }
}}
```

- [ ] **Step 7: Run focused frontend test**

Run:

```bash
npx vitest run apps/web/src/app/features/flows/components/FlowAgentPanel.spec.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit Task 7**

Run:

```bash
git add apps/web/src/app/features/flows/components/FlowAgentPanel.tsx apps/web/src/app/features/flows/components/FlowAgentPanel.spec.tsx
git commit -m "feat: add countryball proposal controls"
```

## Task 8: Analysis Safety Rules

**Files:**

- Modify: `apps/backend/src/modules/blocks/analysis-block.ts`
- Modify: `apps/backend/src/modules/blocks/analysis-block.spec.ts`

- [ ] **Step 1: Write failing analysis tests**

Add this test to `apps/backend/src/modules/blocks/analysis-block.spec.ts`:

```ts
it('rejects countryball scripts that insult whole nationalities', async () => {
    const result = await executeAnalysisBlockForTest(
        {
            style: {
                format: 'vertical-shorts',
                contentProfileId: 'shorts.countryball.v1',
                visualGrammar: { mode: 'countryball' },
            },
            scenes: [
                {
                    sceneNumber: 1,
                    caption: '나라 전체 조롱',
                    narration: '일본은 전부 멍청해서 이런 선택을 했습니다.',
                    claimType: 'joke',
                    evidenceRefs: [],
                },
            ],
        },
        { contentProfileId: 'shorts.countryball.v1' }
    );

    expect(result.output.approved).toBe(false);
    expect(JSON.stringify(result.output.issues)).toContain('국적');
});

it('rejects countryball scripts with unsupported specific historical claims', async () => {
    const result = await executeAnalysisBlockForTest(
        {
            style: {
                format: 'vertical-shorts',
                contentProfileId: 'shorts.countryball.v1',
                narrativeMode: 'historical-situation-reenactment',
                visualGrammar: { mode: 'countryball', reenactment: true },
            },
            scenes: [
                {
                    sceneNumber: 1,
                    caption: '1919년에 공식 문서가 바뀌었다',
                    factualClaim: '1919년에 미국 정부 공식 문서가 한국 관련 결정을 바꾸었다.',
                    dramatizedAction: '미국 국가볼이 도장을 찍고 한국 국가볼이 놀란다.',
                    claimType: 'fact',
                    evidenceRefs: [],
                },
            ],
        },
        { contentProfileId: 'shorts.countryball.v1' }
    );

    expect(result.output.approved).toBe(false);
    expect(JSON.stringify(result.output.issues)).toContain('근거');
});
```

Use the existing analysis test helper name from the file. If no helper exists, create a local helper in the spec that invokes the exported analysis executor used by existing tests.

- [ ] **Step 2: Run focused test and confirm it fails**

Run:

```bash
npx vitest run apps/backend/src/modules/blocks/analysis-block.spec.ts
```

Expected: FAIL if countryball-specific insult detection is not implemented.

- [ ] **Step 3: Add countryball input detection**

In `apps/backend/src/modules/blocks/analysis-block.ts`, add helper near `isLongformGateAInput`:

```ts
function isCountryballInput(input: unknown, config?: Record<string, unknown>): boolean {
    const values: unknown[] = [config?.['contentProfileId'], config?.['imageStyleId']];
    if (input && typeof input === 'object' && !Array.isArray(input)) {
        const obj = input as Record<string, unknown>;
        values.push(obj['contentProfileId'], obj['imageStyleId'], obj['mode']);
        const style = isRecord(obj['style']) ? obj['style'] : {};
        values.push(style['contentProfileId']);
        values.push(style['narrativeMode']);
        const visualGrammar = isRecord(style['visualGrammar']) ? style['visualGrammar'] : {};
        values.push(visualGrammar['mode']);
    }
    return values
        .filter((value): value is string => typeof value === 'string')
        .some(value => value === 'shorts.countryball.v1' || value === 'countryball-comic' || value === 'countryball');
}
```

- [ ] **Step 4: Add countryball issue checks**

In the scene review logic, when `isCountryballInput(input, config)` is true, add issue checks for nationality-wide insults:

```ts
const countryballInsultPattern =
    /(한국|일본|미국|중국|러시아|영국|프랑스|독일|국가|민족|국민).*(전부|다|모두).*(멍청|악랄|열등|더럽|미개|쓰레기)/;

if (countryballInsultPattern.test([scene.caption, scene.narration, scene.visualText].filter(Boolean).join(' '))) {
    issues.push({
        severity: 'critical',
        message: '컨트리볼 풍자는 가능하지만 국적/민족 전체를 비하하는 표현은 사용할 수 없습니다.',
    });
}
```

Also reject unsupported specific factual claims:

```ts
const countryballNeedsEvidence =
    isCountryball &&
    scene.claimType === 'fact' &&
    typeof scene.factualClaim === 'string' &&
    /\d{3,4}년|공식|교재|문서|조약|전쟁|침공|정부|대통령|장관|통계|명 중|%/.test(scene.factualClaim) &&
    (!Array.isArray(scene.evidenceRefs) || scene.evidenceRefs.length === 0);

if (countryballNeedsEvidence) {
    issues.push({
        severity: 'critical',
        message: '컨트리볼 상황극의 구체적 역사/정치/외교 사실 주장은 근거 참조가 필요합니다.',
    });
}
```

Do not ban all country names or all conflict/war references. Only block dehumanizing or whole-nationality insults and unsupported factual claims.

- [ ] **Step 5: Run focused test**

Run:

```bash
npx vitest run apps/backend/src/modules/blocks/analysis-block.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 8**

Run:

```bash
git add apps/backend/src/modules/blocks/analysis-block.ts apps/backend/src/modules/blocks/analysis-block.spec.ts
git commit -m "feat: review countryball safety rules"
```

## Task 9: Full Verification

**Files:**

- No new production files.
- Verify all files modified by Tasks 1-8.

- [ ] **Step 1: Run targeted backend and frontend tests**

Run:

```bash
npx vitest run \
  apps/backend/src/modules/content-profile/content-profile.spec.ts \
  apps/backend/src/modules/orchestrator/workflow-compiler.spec.ts \
  apps/backend/src/modules/shorts/topic-router.spec.ts \
  apps/backend/src/modules/blocks/content-block.spec.ts \
  apps/backend/src/modules/orchestrator/openai-orchestrator.spec.ts \
  apps/backend/src/modules/orchestrator/mock-orchestrator.spec.ts \
  apps/backend/src/modules/blocks/analysis-block.spec.ts \
  apps/web/src/app/features/flows/components/FlowAgentPanel.spec.tsx
```

Expected: PASS.

- [ ] **Step 2: Run typechecks**

Run:

```bash
npx nx typecheck @flows/backend
npx nx typecheck @flows/web
```

Expected: both PASS.

- [ ] **Step 3: Run web build**

Run:

```bash
npx nx build web -- --mode dev
```

Expected: PASS. Chunk-size warning is acceptable if build exits 0.

- [ ] **Step 4: Run diff whitespace check**

Run:

```bash
git diff --check
```

Expected: no output and exit 0.

- [ ] **Step 5: Manual local smoke**

With local web and deployed or local backend configured, submit:

```text
미국 육사 교재에 실린 한국인 이야기를 컨트리볼 쇼츠로 만들어줘
```

Expected:

- Proposal card shows `컨트리볼`.
- `컨트리볼 만화` image style is selected or selectable.
- Approval payload includes `contentProfileId: shorts.countryball.v1`.
- Script-first output includes `sourceEvent`, `reenactmentFrame`, `cast`, `factualClaim`, `dramatizedAction`, dialogue lines as needed, and scene prompt fields for countryball reenactment.
- A generic `미중갈등 쇼츠 만들어줘` prompt stays on normal Shorts unless the proposal card is changed to `컨트리볼`.

- [ ] **Step 6: Final commit if any verification fixes were needed**

If verification required fixes after Task 8, commit them:

```bash
git add <changed files>
git commit -m "fix: stabilize countryball shorts mode"
```

## Self-Review

Spec coverage:

- Natural language trigger: covered by Task 2 and Task 6.
- Manual selection: covered by Task 7.
- Countryball situation-reenactment grammar: covered by Task 4 and Task 5.
- Countryball image style: covered by Task 3.
- Safety review: covered by Task 8.
- Compatibility with general Shorts/image/longform: covered by tests in Task 2, Task 7, and Task 9.

Scope:

- The plan does not create a separate workflow pack.
- The plan does not add per-character TTS voices.
- The plan keeps the existing execution graph and cost controls.

Verification:

- Each behavior change starts with a focused failing test.
- Final verification includes targeted tests, backend typecheck, web typecheck, web build, and whitespace check.
