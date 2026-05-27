# Countryball Skit Writer Root Fix Design

## Goal

Countryball Shorts must not be generated as a narrated explainer with a countryball skin. The flow needs a reusable countryball skit writer layer that can take any user topic and turn it into a coherent situation skit before script, image, TTS, caption, and video stages run.

This is a root fix, not a prompt-only workaround.

## Current Failure

Observed failures:

- The countryball script node can show only the title and "대본 크게 보기" while the visible script lines are empty.
- Generic prompts such as "밤늦게 주문하고 아침에 도착하는 한국 국뽕 쇼츠" can become disconnected explanations instead of one staged skit.
- Country-specific speech flavor can become mechanical, for example appending "데스" after an already complete Korean sentence.
- TTS can sound like one speaker if dialogue lines or role voices collapse.
- Caption sync becomes fragile if the video stage does not receive speaker-linked dialogue and caption overlay contracts.

Root cause:

- The system has countryball-specific blocks, but the front of the flow does not yet act like a robust countryball skit writer.
- The brief is too close to topic summarization. It needs to decide the skit premise, mechanism, setting, cast function, emotional arc, and payoff before script generation.
- The UI preview path reads too narrow a script shape and can miss countryball `normalizedScenes`.
- Speech flavor is described as suffix behavior instead of a readable character-writing rule.

## Non-Goals

- Do not add countryball branches inside general Shorts content, TTS, image, or video blocks.
- Do not hardcode one topic such as K2, 새벽배송, or 금모으기 as production logic.
- Do not fix weak generation by only making QA stricter.
- Do not embed Korean dialogue inside generated images.
- Do not make every country require a fixed voice. Voice roles remain reusable and role-based.

## Architecture

The dedicated countryball flow remains:

```text
countryball-shorts-pack
  -> search
  -> countryball-brief
  -> countryball-script
  -> countryball-data
  -> countryball-analysis
  -> countryball-image
  -> countryball-tts
  -> countryball-video
  -> integration
```

Only shared infrastructure can be reused:

- OpenAI adapter
- ElevenLabs adapter
- image provider
- storage
- ffmpeg runner
- job/parallel utility
- credential/env resolver

General Shorts blocks must not import or interpret countryball-only contracts.

## Countryball Story Brief Contract

`countryball-brief` becomes a skit writer brief, not a generic research summary.

Required conceptual fields:

- `targetCountry`: main country or countryball focus.
- `targetFeature`: the concrete feature, event, technology, culture, product, or situation.
- `comparisonCountries`: relevant opposing, confused, rival, or observing countryballs.
- `mainConflict`: the tension that makes the scene watchable.
- `skitPremise`: one-sentence situation that can be acted out by countryballs.
- `setting`: concrete location where the skit happens.
- `comicMechanism`: how the short becomes entertaining.
- `emotionalArc`: emotion progression such as doubt -> test -> shock -> order.
- `payoff`: final visual or line.
- `storyBeats`: ordered action beats. Count should match or justify `recommendedSceneCount`.
- `recommendedSceneCount`: chosen by story density, not a fixed default.
- `speechFlavorPlan`: countryball speech flavor guidance.
- `voiceRolePlan`: role-based voice choices.

The brief must preserve explicit user plot order. If the user says "무시 -> 테스트 -> 놀람 -> 추가 주문", the brief must keep that as the spine.

## Skit Mechanism Selection

The brief should select a mechanism dynamically from the topic. This is not fixed plot logic; it is a writer decision layer.

Supported mechanism families:

- Doubt -> test -> shock -> reversal.
- Culture shock -> attempt -> panic -> acceptance.
- Meeting argument -> one country changes the room.
- Historical reenactment -> pressure -> action -> payoff.
- Ranking/comparison -> rapid reactions -> comment hook.
- Rival banter -> third-party trigger -> forced cooperation.
- Everyday normality -> foreign misunderstanding -> protagonist treats it as obvious.
- What-if scenario -> initial excitement -> chaos -> punchline.
- Product/tech showcase -> skepticism -> demo -> contract/order.

These families are examples for the model to choose from, not hardcoded topic branches.

## Script Contract

`countryball-script` receives the story brief and returns a full skit contract.

Each scene should include:

- `sceneId`
- `sceneNumber`
- `timeRange`
- `scenePurpose`
- `location`
- `visualTone`
- `screenAction`
- `dialogueLines`
- `expressionChanges`
- `sfx`
- `editBeat`
- `narratorLine`
- `captionOverlay`
- `props`
- `durationSec`

Rules:

- The script must be one continuous skit, not disconnected facts.
- The first scene must start with a direct line, visible problem, or strange situation.
- Most normal scenes should contain at least two short countryball dialogue lines.
- Title, reaction, silent visual payoff, and ending scenes may have fewer lines.
- A single countryball must not explain the whole topic in long sentences.
- `narratorLine` defaults to null. It is allowed only for title cards, short time jumps, or ending meta captions.
- `captionOverlay` is video-editing data. It must not be pushed into the image prompt.
- `recommendedSceneCount` and `scenes.length` must match.

## Speech Flavor And Voice Roles

Speech flavor and TTS voice are separate concepts.

`voiceRole` controls TTS personality:

- `narrator_short`
- `main_tired`
- `main_confident`
- `rival_smug`
- `rival_angry`
- `neutral_serious`
- `panic_high`
- `deep_serious`
- `old_teacher`

`speechFlavor` controls Korean dialogue writing:

- Default is readable Korean.
- Country flavor should be light and understandable.
- No country should become unreadable because of gimmicks.
- Do not mechanically append suffixes to every sentence.
- If a sentence already ends in Korean polite style such as `요`, `네요`, `합니다`, do not append `데스`.
- Japanese-ball flavor should use short, natural gag lines only when useful, such as `말도 안 되므니다!`, `잠깐만 데스!`, or `이건 반칙데스!`.
- Unknown or uncommon countries use neutral readable Korean unless the brief gives a specific style.

This is not topic hardcoding. It is a reusable writing rule.

## UI Preview

The node preview and large script modal must display countryball dialogue from all valid countryball script shapes:

- `scenes`
- `normalizedScenes`
- nested script-like records when present

Preview priority:

1. `dialogueLines` as `국가: 대사`.
2. Short `narratorLine` only when present and allowed.
3. Action caption fallback if no dialogue exists.

The preview must not show only a title when valid countryball scenes exist.

## TTS And Caption Sync

Countryball TTS must be built from `dialogueLines`, not from a single narration string.

Rules:

- Each dialogue line becomes a segment with `sceneId`, `country`, `line`, `voiceRole`, and optional `pauseAfterMs`.
- Multiple speaking countries require at least two role voices unless the script intentionally has a single-speaker special case.
- Caption timing must follow the generated TTS segment order.
- Caption placement uses `captionOverlay` with `anchorTarget`, `speakerCountry`, and `preferredPosition`.
- General Shorts TTS/video blocks must not learn countryball caption contracts.

## Image Prompt Contract

Countryball image prompts must translate scenes into visual action:

- Use `screenAction`, `location`, `visualTone`, `expressionChanges`, `props`, and cast.
- Do not embed Korean dialogue or fake subtitles.
- Do not request blank speech bubbles or highlighted empty caption spaces as a visible graphic element.
- It is acceptable to leave uncluttered space near the speaking ball, but the prompt should not ask for a drawn blank bubble.
- Avoid infographic panels and long text.
- The scene should be understandable in one second through countryballs, props, and expressions.

## Quality Gate

Countryball analysis should fail outputs that:

- Are mostly narration or long explanation.
- Lack one coherent skit premise.
- Have too few actionable scene beats.
- Have normal scenes without dialogue or visible action.
- Collapse multi-country dialogue into one speaker or one voice role.
- Put Korean dialogue into image prompts.
- Produce mechanical speech flavor such as a stray `데스` after a full Korean sentence.
- Omit caption overlay for dialogue scenes.

It should not demand report-style source phrases such as "공식 지표에 따르면" in countryball mode.

## Test Plan

Backend unit tests:

- Brief prompt contains skit writer fields and mechanism selection requirements.
- Script prompt requires one continuous skit and explicit plot preservation.
- Script normalization rejects scene count mismatch.
- Script normalization prevents mechanical Japanese suffix patterns.
- Countryball analysis rejects narrator-only scenes and one-voice multi-speaker collapse.
- TTS segments map from dialogue lines in order and preserve role voices.

Frontend unit tests:

- Node preview displays dialogue from `scenes`.
- Node preview displays dialogue from `normalizedScenes`.
- Large script modal displays countryball dialogue from normalized scenes.

Boundary tests:

- General Shorts `content-block`, `media-tts-block`, and `media-video-block` must not contain countryball-only contract strings.

Semantic sample tests:

- K2 tank: doubt -> test -> shock -> order.
- Late-night delivery: foreign disbelief -> Korea orders at night -> morning arrival -> reaction.
- Spicy food: challenge -> taste -> panic -> rivalry.
- Swiss neutrality: argument around Swiss ball -> calm neutral payoff.
- Dollar hegemony: trade table -> dollar pressure -> annoyed rivals.

These samples are test inputs, not production topic branches.

## Completion Criteria

- Any countryball request first produces a skit writer brief with premise, setting, conflict, mechanism, emotional arc, payoff, and scene count.
- The script is a countryball situation skit, not an explainer.
- The UI shows script dialogue in the node and large modal.
- TTS uses dialogue segments with role voices.
- Captions are speaker-linked video overlays.
- Images are clean countryball action scenes without embedded Korean dialogue or blank speech bubbles.
- General Shorts blocks remain isolated.
- Targeted tests, backend typecheck, web build, and diff checks pass before deployment.
