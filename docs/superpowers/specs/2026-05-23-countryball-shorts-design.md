# Countryball Shorts Mode Design

Date: 2026-05-23
Status: design ready for review

## Goal

Add a countryball-specific Shorts mode to the existing Eureka Flow Shorts workflow.

The feature should let a user either:

- explicitly ask for a countryball-style short, for example `컨트리볼 쇼츠 만들어줘`
- select `컨트리볼` from the proposal card before approval

When selected, the generated output should feel like a countryball short: the user's requested situation is reenacted by countryball characters through role-play, reactions, short dialogue, context, and punchline-like captions. The request may be a real event, a historical situation, a current issue, a fictional scenario, a hypothetical conflict, or a metaphor. Dialogue is a tool for reenactment, not the product definition. It should not be a normal one-speaker explainer with only countryball images attached.

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
4. Short role-play lines or punchline captions placed around the characters.
5. Story moves through situation, conflict, reaction, factual reveal, and final takeaway.
6. The narrator is not the only speaker; the video feels like a small reenactment of the requested situation.
7. Countryballs use exaggerated expressions and simple props to dramatize the requested historical, political, economic, diplomatic, military, cultural, fictional, or hypothetical setup.
8. Factual claims and dramatized actions must stay separable so QA can check accuracy when the request makes factual claims without banning satire or fictional prompts.

## Product Scope

In scope:

- Countryball content mode inside the existing Shorts workflow.
- Countryball script rules.
- User-requested countryball situation/reenactment contract.
- Countryball image style preset.
- Proposal-card selection for countryball mode.
- Auto-selection only when the user's request contains explicit countryball intent.
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

If the user explicitly says one of the following, the proposal should default to countryball mode:

- `컨트리볼`
- `countryball`
- `국가볼`
- `polandball`
- `폴란드볼`
- `국가 의인화 쇼츠`
- `한국볼`, `일본볼`, `미국볼` only when the request also asks for a ball-style Shorts story, reenactment, or situation play

Example:

```text
미국 육사 교재에 실린 한국인 이야기를 컨트리볼 쇼츠로 만들어줘
```

Expected proposal defaults:

- `contentProfileId`: `shorts.countryball.v1`
- `narrativeMode`: `countryball-situation-reenactment`
- `visualStyle`: `countryball-comic`
- script tone: reenactment/story
- scene count: existing selected count, usually 12

Do not auto-select countryball for generic geopolitical or history prompts such as `미중갈등 쇼츠 만들어줘`, `브렉시트 설명 쇼츠 만들어줘`, or `세계사 쇼츠 만들어줘`. Those prompts can show `컨트리볼 상황극으로 만들기` as a proposal-card option, but the default remains normal Shorts unless the user explicitly chooses it.

### Manual Selection

In the proposal card, the user should be able to choose:

- `일반 쇼츠`
- `컨트리볼`

For countryball, the card should explain the difference in one short line:

```text
국가볼 캐릭터가 사용자가 요청한 사건/상황을 상황극으로 재연하는 쇼츠 형식입니다.
```

## Script Design

Countryball scripts need a structured user-requested situation-reenactment format.

The content block should still output the existing scene contract, but countryball mode should add explicit metadata that separates the requested situation, optional factual spine, and dramatized action:

```json
{
    "style": {
        "format": "vertical-shorts",
        "aspectRatio": "9:16",
        "sceneCount": 12,
        "contentProfileId": "shorts.countryball.v1",
        "narrativeMode": "countryball-situation-reenactment",
        "visualStyle": "countryball-comic",
        "visualGrammar": {
            "mode": "countryball",
            "reenactment": true
        }
    },
    "requestBasis": "factual",
    "requestedSituation": {
        "topic": "미국 육사 교재에 실린 한국인",
        "kind": "real_event",
        "userIntent": "컨트리볼 형식의 쇼츠로 상황극화"
    },
    "sourceEvent": {
        "topic": "미국 육사 교재에 실린 한국인",
        "timeRange": "제2차 세계대전 및 이후 군사 교육 맥락",
        "countries": ["KR", "US"],
        "evidenceRefs": ["source-1"]
    },
    "reenactmentFrame": {
        "situation": "미국 육사 교재가 한국계 군인을 주요 사례로 다루는 상황",
        "conflict": "한국은 놀라고, 미국은 왜 이 인물을 배워야 하는지 설명한다",
        "turningPoint": "김영옥의 전공과 리더십 사례가 드러난다",
        "punchlineOrLesson": "교재에 실린 이유는 국적이 아니라 실제 군사적 업적이었다"
    },
    "characters": [
        {
            "countryCode": "KR",
            "label": "한국",
            "roleInScene": "놀라는 관찰자",
            "expression": "surprised",
            "stance": "curious and proud"
        },
        {
            "countryCode": "US",
            "label": "미국",
            "roleInScene": "교재를 보여주는 설명자",
            "expression": "serious",
            "stance": "official and instructional"
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
            "factualClaim": "미국 육사 교육 자료에서 김영옥이 사례로 언급된다.",
            "dramatizedAction": "미국 국가볼이 교재를 펼쳐 한국 국가볼에게 보여준다.",
            "dialogue": [
                { "speaker": "usa", "line": "이 인물은 반드시 배워야 해." },
                { "speaker": "korea", "line": "잠깐, 한국인이요?" }
            ],
            "countryballScene": {
                "sceneNumber": 1,
                "characters": [
                    { "countryCode": "US", "expression": "serious", "pose": "holding an open military textbook" },
                    { "countryCode": "KR", "expression": "surprised", "pose": "leaning toward the book" }
                ],
                "props": ["open military textbook", "academy library table", "portrait wall"],
                "background": "United States military academy library",
                "historicalContext": "military education case-study scene",
                "captionIntent": "make the rarity of the Korean figure immediately clear",
                "safetyNotes": ["no ethnic stereotypes", "avoid claiming exact textbook wording unless sourced"]
            },
            "visualText": "한국인 3명만",
            "visual": {
                "topTitle": "미국 육사 교재에 실린 한국인 3명 중 1명",
                "mainCaption": "한국인 3명만"
            },
            "imagePrompt": "United States countryball and Korea countryball reenacting a military academy textbook scene, United States ball holding an open military textbook, Korea ball surprised beside the library table, serious historical classroom mood, no offensive stereotypes",
            "claimType": "fact",
            "evidenceRefs": ["source-1"],
            "durationSec": 4
        }
    ]
}
```

Existing consumers should continue to work by reading `caption`, `narration`, `imagePrompt`, `visualText`, and `visual`. The new `requestBasis`, `requestedSituation`, `sourceEvent`, `reenactmentFrame`, `characters`, `factualClaim`, `dramatizedAction`, `dialogue`, and `countryballScene` fields are additive. `sourceEvent` and `evidenceRefs` are required only when the scene presents factual claims. `dialogue` exists to support the reenactment; it is not the primary success criterion by itself.

### Story Beat Template

Default 12-scene countryball structure:

1. Hook: shocking claim or question.
2. Request grounding: what situation the user asked to reenact, and whether it is factual, fictional, hypothetical, or satirical.
3. Character entry: main countryballs appear in assigned roles.
4. Misunderstanding, conflict, pressure, or negotiation.
5. First reveal. If it is factual, preserve evidence refs.
6. Reaction or joke beat.
7. Escalation with a number, event, or decision.
8. Second reveal or reversal. If it is factual, preserve evidence refs.
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

The image prompt should be derived from a scene prompt contract before it is converted into final provider prompt text:

```json
{
    "sceneNumber": 1,
    "characters": [
        { "countryCode": "KR", "expression": "surprised", "pose": "pointing at a document" },
        { "countryCode": "US", "expression": "stern", "pose": "holding a textbook" }
    ],
    "props": ["textbook", "academy desk"],
    "background": "military academy library",
    "historicalContext": "case-study reenactment; optional for fictional or hypothetical requests",
    "captionIntent": "show why this Korean figure is rare in the textbook",
    "safetyNotes": ["do not use national or ethnic insults", "do not render final subtitles"]
}
```

The final image prompt should describe:

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
- Do not imply that a whole nationality is inferior, stupid, evil, dirty, subhuman, or naturally aggressive.
- Do not glorify war crimes, colonization, or civilian harm.
- Do not present current conflicts, political claims, or historical events as fact without source support.
- Do not require real-event grounding for fictional, hypothetical, metaphorical, or satirical requests. In those cases, QA should check safety and clarity, not factual sourcing.
- Do not use insulting national, ethnic, or racial stereotypes as a punchline.
- Factual historical claims must preserve source references when available.
- If a claim is disputed, phrase it as disputed.
- Satire is allowed, but the factual spine must remain accurate and separable from dramatized action.
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
    - infer countryball only from explicit countryball/polandball/national-ball style intent, not generic geopolitical topics

- `apps/backend/src/modules/shorts/rulepacks/base-shorts-rulepack.ts`
    - expand `ShortsRulepack.id`

- `apps/backend/src/modules/shorts/rulepacks/countryball-shorts-rulepack.ts`
    - new countryball-specific situation-reenactment prompt rules
    - require `requestedSituation`, `reenactmentFrame`, `cast`, `sceneBeats`, and `dramatizedAction`
    - require `sourceEvent`, `factualClaim`, and `evidenceRefs` only for factual claims

- `apps/backend/src/modules/shorts/topic-router.ts`
    - route countryball keywords to the countryball rulepack

- `apps/backend/src/modules/image-generation/image-style.ts`
    - add `countryball-comic` style preset
    - recommend it for countryball requests
    - build scene prompts from `countryballScene` / scene-prompt contract instead of loosely extracting visual prompts from narration text

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
3. `미중갈등 쇼츠 만들어줘` remains normal Shorts unless the proposal profile is manually changed.
4. normal `쇼츠 만들어줘` remains `shorts.info.v1`.
5. countryball content profile survives proposal approval overrides.
6. countryball rulepack prompt asks for user-requested situation reenactment.
7. output separates `factualClaim` from `dramatizedAction` when factual claims exist.
8. image prompt contract includes characters, expressions, poses, props, background, historical context, caption intent, and safety notes.
9. analysis rules flag nationality-wide insults, unsupported historical claims, and factual claims without evidence refs.

Frontend tests:

1. proposal card shows `일반 쇼츠` and `컨트리볼`.
2. user can select `컨트리볼` before approval.
3. approval payload includes selected `contentProfileId` and `imageStyleId`.
4. image quality and scene count controls still work.
5. `ㅎㅇ` does not create a proposal.
6. `AI 쇼츠 만들어줘` keeps the existing general Shorts path.

Smoke test:

1. Create prompt: `미국 육사 교재에 실린 한국인 이야기를 컨트리볼 쇼츠로 만들어줘`.
2. Confirm proposal defaults to countryball mode.
3. Approve with script-first mode.
4. Confirm script scenes include countryball reenactment beats, requested situation metadata, dramatized actions, dialogue lines, and scene prompt contracts. Factual claims include evidence refs.
5. Run one paid-light smoke only after script review passes.

## Completion Criteria

The feature is complete when:

- Countryball mode can be selected or inferred.
- Countryball is inferred only from explicit countryball/polandball/national-ball wording.
- Generated script is user-requested-situation reenactment driven, not plain one-speaker narration and not merely dialogue for its own sake.
- Generated image prompts describe countryball reenactment scenes with clear character roles, expressions, poses, props, backgrounds, and safety notes.
- General Shorts behavior remains unchanged.
- Tests and typechecks pass.
- If deployed, CloudFront and backend dev smoke pass as usual.
