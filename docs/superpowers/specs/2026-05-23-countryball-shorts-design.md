# Countryball Shorts Mode Design

Date: 2026-05-23
Status: design ready for review

## Goal

Add a countryball-specific Shorts mode to the existing Eureka Flow Shorts workflow.

The feature should let a user either:

- explicitly ask for a countryball-style short, for example `컨트리볼 쇼츠 만들어줘`
- select `컨트리볼` from the proposal card before approval

When selected, the generated output should feel like a countryball short: multiple country characters recreate a situation through short dialogue, reactions, historic or political context, and punchline-like captions. It should not be a normal one-speaker explainer with only countryball images attached.

## Reference Inputs

Reference Shorts provided by the user:

- https://www.youtube.com/shorts/mv2NHIawdss
- https://www.youtube.com/shorts/GLUUHnSWuVg
- https://www.youtube.com/shorts/ik5GjYC6vzY
- https://www.youtube.com/shorts/TpJQN-ZwSYU

Local analysis performed:

- Downloaded reference videos to `/tmp/eureka-countryball-refs`
- Generated 1 fps frame sheets for each reference
- Compared the user's attached frames against those sheets

Observed common structure:

1. Persistent black top title area.
2. Large Korean title split into white and yellow emphasis lines.
3. Central illustrated scene with 1-3 countryball characters.
4. Dialogue-like text or punchline captions placed around the characters.
5. Story moves through situation, conflict, reaction, factual reveal, and final takeaway.
6. The narrator is not the only speaker; the video feels like a small reenactment.
7. Countryballs use exaggerated expressions and simple props to explain a historical, political, economic, or cultural event.

## Product Scope

In scope:

- Countryball content mode inside the existing Shorts workflow.
- Countryball script rules.
- Countryball image style preset.
- Proposal-card selection for countryball mode.
- Auto-selection when the user's request contains clear countryball intent.
- Quality review rules for national, ethnic, historical, and political claims.

Out of scope for this first pass:

- A separate countryball workflow pack.
- Full voice acting per character.
- Per-character TTS voices.
- Licensed recreation of a specific creator's exact art style.
- Any automatic upload or social platform publishing.

## Recommended Approach

Use approach B: add `countryball` as a Shorts content/style mode rather than a separate workflow.

Rationale:

- The user is still asking for a Shorts video.
- Existing Shorts blocks already cover research, script, data normalization, review, image generation, TTS, video composition, and metadata.
- The change belongs in the recipe's creative grammar, not in a new execution engine.
- A separate workflow would duplicate approval, run, recovery, cost, and deployment surfaces.

## User Experience

### Natural Language Trigger

If the user says one of the following, the proposal should default to countryball mode:

- `컨트리볼`
- `countryball`
- `나라공`
- `국가볼`
- `국가 의인화 쇼츠`
- `한국볼`, `일본볼`, `미국볼` when the request clearly asks for a Shorts-style character story

Example:

```text
미국 육사 교재에 실린 한국인 이야기를 컨트리볼 쇼츠로 만들어줘
```

Expected proposal defaults:

- content profile: `shorts.countryball.v1`
- script tone: story/dialogue
- image style: countryball comic
- scene count: existing selected count, usually 12

### Manual Selection

In the proposal card, the user should be able to choose:

- `일반 쇼츠`
- `컨트리볼`

For countryball, the card should explain the difference in one short line:

```text
나라 캐릭터들이 대화로 사건을 재현하는 쇼츠 형식입니다.
```

## Script Design

Countryball scripts need a structured reenactment format.

The content block should still output the existing scene contract, but each scene may include additional countryball fields:

```json
{
    "style": {
        "format": "vertical-shorts",
        "aspectRatio": "9:16",
        "sceneCount": 12,
        "contentProfileId": "shorts.countryball.v1",
        "visualGrammar": {
            "mode": "countryball",
            "dialogueDriven": true
        }
    },
    "characters": [
        {
            "id": "korea",
            "label": "한국",
            "role": "protagonist",
            "personality": "calm but proud"
        }
    ],
    "scenes": [
        {
            "sceneNumber": 1,
            "imageSlot": "[Image #1]",
            "storyBeat": "hook",
            "topTitle": "미국 육사 교재에 실린 한국인 3명 중 1명",
            "caption": "한국인 3명만 실렸다",
            "narration": "미국 육사 교재에 실린 한국인 3명 중 한 명은 김영옥입니다.",
            "dialogue": [
                { "speaker": "usa", "line": "이 인물은 반드시 배워야 해." },
                { "speaker": "korea", "line": "잠깐, 한국인이요?" }
            ],
            "visualText": "한국인 3명만",
            "visual": {
                "topTitle": "미국 육사 교재에 실린 한국인 3명 중 1명",
                "mainCaption": "한국인 3명만"
            },
            "imagePrompt": "United States countryball in a military academy library showing an open textbook to Korea countryball, surprised reaction, historical classroom setting",
            "claimType": "fact",
            "sourceRefs": ["source-1"],
            "durationSec": 4
        }
    ]
}
```

Existing consumers should continue to work by reading `caption`, `narration`, `imagePrompt`, `visualText`, and `visual`. The new `characters` and `dialogue` fields are additive.

### Story Beat Template

Default 12-scene countryball structure:

1. Hook: shocking claim or question.
2. Setup: where and when the story begins.
3. Character entry: main countries appear.
4. Misunderstanding or conflict.
5. First factual reveal.
6. Reaction or joke beat.
7. Escalation with a number, event, or decision.
8. Second reveal or reversal.
9. Why it mattered.
10. Modern connection or consequence.
11. Final comparison or punchline.
12. Takeaway and CTA.

## Visual Design

The image block should use a new style preset, for example:

- id: `countryball-comic`
- label: `컨트리볼 만화`

Prompt prefix requirements:

- vertical Korean Shorts composition
- countryball characters represented as simple spherical flag-colored characters
- expressive eyes, eyebrows, sweat drops, angry marks, surprise marks, pointing hands, simple props
- historical, classroom, museum, battlefield, office, port, factory, map-room, or diplomatic setting depending on the story
- clean bold comic linework
- central characters large enough for mobile viewing
- leave safe space for compositor title/subtitle overlays
- do not draw final title band, final subtitles, URLs, source labels, or watermarks

The image prompt should describe:

- which countryballs appear
- where they are
- what each character is doing
- the emotional beat
- one important prop or background cue

The prompt should avoid:

- claiming that the generated image contains exact readable Korean text
- complex multi-panel layouts unless the scene explicitly needs comparison
- too many countries in one frame
- specific creator name imitation

## Video and Subtitle Behavior

For the first version, TTS remains single-voice narration.

Reason:

- The current audio pipeline is built around scene narration.
- Per-character voice acting would increase provider calls, state complexity, and timing risk.
- The countryball feel can be achieved first through dialogue-like captions, scene composition, and narration cadence.

The output should still use compositor-owned overlays:

- top title band
- subtitle or main caption placement
- source label where needed

Countryball mode should not rely on GPT-image to render the final title or lower subtitles.

## Quality and Safety Review

Countryball mode often touches countries, war, ethnicity, diplomacy, and history. The analysis block should add countryball-specific review rules:

- Do not use national or ethnic slurs.
- Do not imply that a whole nationality has one fixed personality.
- Do not glorify war crimes, colonization, or civilian harm.
- Factual historical claims must preserve source references when available.
- If a claim is disputed, phrase it as disputed.
- Satire is allowed, but the factual spine must remain accurate.
- Captions should be punchy but not dehumanizing.

Failure should return actionable feedback, not just rejection.

Example:

```text
컨트리볼 풍자는 가능하지만 특정 국적 전체를 조롱하는 표현이 있어 완화가 필요합니다.
```

## Architecture Changes

Expected code surfaces:

- `apps/backend/src/modules/content-profile/content-profile.ts`
    - add `shorts.countryball.v1` profile option
    - allow Shorts family profile choices to include general and countryball

- `apps/backend/src/modules/shorts/rulepacks/base-shorts-rulepack.ts`
    - expand `ShortsRulepack.id`

- `apps/backend/src/modules/shorts/rulepacks/countryball-shorts-rulepack.ts`
    - new countryball-specific prompt rules

- `apps/backend/src/modules/shorts/topic-router.ts`
    - route countryball keywords to the countryball rulepack

- `apps/backend/src/modules/image-generation/image-style.ts`
    - add `countryball-comic` style preset
    - recommend it for countryball requests

- `apps/backend/src/services/proposal-service.ts`
    - preserve selected content profile and selected image style when approving proposal
    - ensure countryball defaults can be overridden by the user

- `apps/web/src/app/features/flows/components/FlowAgentPanel.tsx`
    - show countryball as a selectable Shorts profile
    - keep general Shorts as the default unless AI/user intent selects countryball

## Compatibility

This design must not break:

- existing general Shorts generation
- image-only generation
- longform proposal selection
- script-first review flow
- quality-review recovery
- selected workflow-group execution

Countryball fields are additive. Existing `scenes[]` fields remain required.

## Verification Plan

Backend tests:

1. `컨트리볼 쇼츠 만들어줘` selects `shorts.countryball.v1`.
2. `countryball` request recommends `countryball-comic`.
3. normal `쇼츠 만들어줘` remains `shorts.info.v1`.
4. countryball content profile survives proposal approval overrides.
5. countryball rulepack prompt asks for dialogue-driven reenactment.
6. analysis rules flag nationality-wide insults or unsupported historical claims.

Frontend tests:

1. proposal card shows `일반 쇼츠` and `컨트리볼`.
2. user can select `컨트리볼` before approval.
3. approval payload includes selected `contentProfileId` and `imageStyleId`.
4. image quality and scene count controls still work.

Smoke test:

1. Create prompt: `미국 육사 교재에 실린 한국인 이야기를 컨트리볼 쇼츠로 만들어줘`.
2. Confirm proposal defaults to countryball mode.
3. Approve with script-first mode.
4. Confirm script scenes include countryball dialogue and image prompts.
5. Run one paid-light smoke only after script review passes.

## Completion Criteria

The feature is complete when:

- Countryball mode can be selected or inferred.
- Generated script is dialogue-driven, not plain one-speaker narration.
- Generated image prompts describe countryball scenes with clear character roles.
- General Shorts behavior remains unchanged.
- Tests and typechecks pass.
- If deployed, CloudFront and backend dev smoke pass as usual.
