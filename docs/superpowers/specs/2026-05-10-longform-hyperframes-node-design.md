# Longform Hyperframes Production MVP Design

작성일: 2026-05-10
대상 브랜치: `min-longform`
기준 브랜치: `integration/jt-frontend-on-latest-backend`
기준 커밋: `888f308e2c3d4f4bf52e91e9a99a784ac8f70612`

## 1. Product Boundary

이번 작업의 이름은 **longform production MVP**다.

이전 `longform artifact MVP`는 기획 artifact와 approval gate까지만 증명하는 범위였다. 이 문서는 그 범위를 올려, 1차 MVP부터 TTS, SRT/timing, Hyperframes composition, MP4 render, QA, package까지 포함한다.

단, `sun_tube` 원칙처럼 모든 주제를 같은 분량과 같은 구조로 만들지 않는다. Longform production MVP는 다음 방식으로 동작해야 한다.

```text
user topic
-> topic classification
-> recommended production profile
-> MVP safety cap
-> proposal
-> approval
-> TTS/SRT
-> scene contracts
-> tool routing
-> Hyperframes composition
-> MP4 render
-> QA
-> package
```

핵심 원칙:

- 주제마다 content pattern, production mode, scene count, length band, route mix가 달라진다.
- 1차 MVP는 길이와 비용 폭주를 막기 위해 safety cap을 적용한다.
- 사용자가 승인하기 전에는 TTS, SRT, render, paid API를 실행하지 않는다.
- 최종 결과는 placeholder가 아니라 실제 audio/video stream이 있는 MP4여야 한다.
- 기존 쇼츠 파이프라인은 회귀하면 안 된다.

## 2. Source System

참고 원본은 `kwmin122/sun_tube`다.

- README: `https://github.com/kwmin122/sun_tube`
- Content factory: `https://raw.githubusercontent.com/kwmin122/sun_tube/main/CONTENT_FACTORY_PIPELINE.md`
- Tool routing: `https://raw.githubusercontent.com/kwmin122/sun_tube/main/TOOL_ROUTING_PIPELINE.md`
- Scene contract: `https://raw.githubusercontent.com/kwmin122/sun_tube/main/SCENE_CONTRACT_SYSTEM.md`
- Motion graphics quality: `https://raw.githubusercontent.com/kwmin122/sun_tube/main/MOTION_GRAPHICS_QUALITY_SYSTEM.md`

가져올 것은 repo 전체가 아니라 제작 시스템이다.

`sun_tube`에서 확인한 핵심 원칙:

- 고정 비디오 템플릿이 아니다.
- 참고 영상 구조는 pattern library이지 복붙 스크립트가 아니다.
- 영상 구조는 research 이후 content needs에 따라 고른다.
- topic type별 기본 pattern이 다르다.
- production mode는 topic과 timeline에 따라 고른다.
- scene마다 primary tool route를 고른다.
- Hyperframes는 최종 TTS-driven motion composition의 기본 조립 장소다.

## 3. MVP Safety Cap

주제별로 production profile은 달라지지만, 첫 production MVP에는 안전 상한이 필요하다.

Default cap:

- maximum duration: 5 minutes
- preferred duration band: 2-5 minutes
- maximum scenes: 8 scenes
- preferred scenes: 5-8 scenes
- route execution: `hyperframes`, `script/ffmpeg`, `tts`, `srt/timing`
- route planning only: `video-use`, `capture`, `imagegen`, `manual`
- paid execution: approval 이후에만 허용

사용자가 더 긴 영상을 요청하면:

- proposal은 요청 길이를 기록한다.
- production profile은 원래 권장 길이를 계산한다.
- MVP cap 때문에 축소되는 경우 assumptions에 명시한다.
- 예: `"사용자는 10분을 요청했지만 현재 production MVP는 5분/8 scenes cap으로 축소합니다."`

## 4. Topic-dependent Production Profiles

Longform은 분량 고정이 아니라 topic profile 기반이다.

### Profile Fields

```json
{
    "topicType": "ai-tool-product",
    "contentPattern": "problem-cause-fix",
    "productionMode": "demo-led",
    "lengthBand": { "recommendedMinSec": 180, "recommendedMaxSec": 300 },
    "sceneCount": { "recommended": 7, "max": 8 },
    "routeMix": {
        "primary": "hyperframes",
        "support": ["capture", "script/ffmpeg"],
        "plannedOnly": ["video-use", "imagegen"]
    },
    "assetBias": ["ui-screenshot", "workflow-diagram", "docs"],
    "assumptions": [],
    "mvpCapApplied": true
}
```

### Topic Type Mapping

| Topic type             | Default pattern                     | Production mode | Typical asset bias                       |
| ---------------------- | ----------------------------------- | --------------- | ---------------------------------------- |
| open-source repo       | Claim -> Proof -> Explanation       | evidence-led    | README, docs, CLI screenshots, diagrams  |
| AI tool/product        | Problem -> Cause -> Fix             | demo-led        | UI screenshots, workflow diagrams, demos |
| controversy/commentary | Original Claim -> Counter-Evidence  | quote-led       | clips, articles, posts, quote cards      |
| market/news            | Timeline / Data Story               | evidence-led    | articles, charts, public statements      |
| tutorial               | Demo Walkthrough                    | demo-led        | screen recordings, UI highlights         |
| concept explainer      | Myth -> Correction or Diagram-first | motion-only     | diagrams, analogies, minimal b-roll      |
| company/person story   | Case Study                          | documentary-led | interviews, archive, press, timeline     |

### MVP Route Rule

In the first production MVP:

- `hyperframes` can execute.
- `script/ffmpeg` can execute for render/probe/package.
- `tts` and `srt/timing` can execute after approval.
- `capture`, `video-use`, `imagegen`, and `manual` are represented in route plans but not fully executed unless separately approved later.

This keeps the first production MVP real enough to create MP4 while avoiding a full `sun_tube` automation port.

## 5. Proposed Node Graph

Production MVP graph:

```text
longform-intake
-> longform-topic-profile
-> longform-research
-> longform-brief
-> longform-draft-scenes
-> longform-plan
-> approval-gate
-> longform-tts
-> longform-timing
-> longform-scene-contract
-> longform-tool-routing
-> hyperframes-compose
-> hyperframes-render
-> longform-qa
-> longform-package
```

The graph is intentionally longer than the shorts graph. Longform is not "more scenes"; it is a staged production workflow.

## 6. Node Responsibilities

### longform-intake

역할: 사용자 요청을 longform 제작 요청으로 구조화한다.

Output:

- topic
- targetViewer
- outputFormat: `youtube-longform`
- requestedLengthBand
- requestedStyle
- tone
- assumptions
- missingInputs

### longform-topic-profile

역할: 주제별 production profile을 고른다.

Output:

- topicType
- contentPattern
- productionMode
- lengthBand
- sceneCount
- routeMix
- assetBias
- assumptions
- mvpCapApplied

이 노드는 `sun_tube`의 "topic마다 구조를 고른다"는 원칙을 eureka-flow에 고정하는 핵심 노드다.

### longform-research

역할: 제작에 필요한 material lead를 만든다.

1차 production MVP에서는 두 모드가 있다.

- no-paid/local UAT: research draft만 생성한다.
- paid/real mode: configured research adapter가 있는 경우 source-backed research-pack을 생성한다.

No-paid output은 실제 웹 리서치처럼 보이면 안 된다.

Output:

- research-pack
- sourceCandidates
- sourceNeededList
- candidateQueries
- assumptions
- riskNotes
- factualityStatus: `draft` | `source-backed`

### longform-brief

역할: 영상의 각도와 제작 방향을 정한다.

Output:

- creativeBrief
- selectedPattern
- productionMode
- materialBias
- viewerPromise
- narrativeRisk
- visualDirection

### longform-draft-scenes

역할: 최종 대본 전에 scene purpose와 visual intent를 먼저 만든다.

Output:

- draftScenePackets
- scenePurpose
- sceneRole
- materialDirection
- visualIntent
- likelyRouteCandidates

### longform-plan

역할: 사용자 승인 대상이 되는 script plan을 만든다.

Output:

- planDraft
- scriptDraft
- sceneTable
- roughNarration
- draftSceneContractFields
- approvalSummary
- blockedQuestions

### approval-gate

역할: plan approval을 backend invariant로 고정한다.

규칙:

- `plan_approved !== true`면 TTS, SRT, timing, render, external paid work로 넘어갈 수 없다.
- UI 버튼만으로 gate를 표현하지 않는다.
- backend executor가 gate를 검사해야 한다.
- frontend가 우회 호출을 해도 backend가 차단해야 한다.
- 승인 이벤트는 artifact envelope의 `approvedAt`과 run metadata에 남아야 한다.

### longform-tts

역할: 승인된 script를 음성으로 생성한다.

Provider policy:

- 첫 MVP는 하나의 configured provider만 요구한다.
- ElevenLabs가 설정되어 있으면 Korean narration provider로 우선 사용한다.
- 기존 backend TTS provider를 사용할 수 있으면 fallback 또는 alternative로 둔다.
- provider가 없으면 `MISSING_API_KEYS` 계열 오류로 사전 차단한다.

Output:

- audioAsset
- voiceProvider
- voiceModel
- narrationMap
- durationSec
- costEstimate

### longform-timing

역할: TTS 결과를 scene timing과 caption timing으로 변환한다.

Output:

- srtAsset
- timedScenePackets
- sceneStartEnd
- captionBehavior
- motionBeatTiming

1차 MVP는 full subtitle editor를 만들지 않는다. TTS duration과 scene table을 기준으로 deterministic timing을 만들고, provider가 word/segment timing을 제공하면 그것을 사용한다.

### longform-scene-contract

역할: scene implementation을 추측하지 않도록 scene별 계약을 만든다.

필수 필드:

- sceneId
- purpose
- patternRole
- primaryScreenObject
- allowedElements
- forbiddenFillers
- motionBeats
- requiredStateChange
- captionSafeZone
- evidenceFrame
- implementationMarkers
- routeHints
- timing

### longform-tool-routing

역할: 각 scene에 primary route와 support route를 붙인다.

허용 route:

- `hyperframes`
- `video-use`
- `imagegen`
- `capture`
- `script/ffmpeg`
- `manual`

1차 production MVP에서는 `hyperframes` route만 실제 composition으로 진행한다. 나머지 route는 route plan과 blocked/planned status로 남긴다.

### hyperframes-compose

역할: scene contracts와 timed scene packets를 Hyperframes composition input으로 변환한다.

Output:

- compositionManifest
- compositionHtml
- compositionAssets
- sceneMarkers
- captionTracks
- blockedRoutes

1차 MVP는 asset-heavy documentary composition을 만들지 않는다. 텍스트, SVG/HTML diagram, kinetic type, simple cards, timing-driven captions 중심으로 만든다.

### hyperframes-render

역할: Hyperframes composition을 MP4로 렌더한다.

Output:

- videoAsset
- renderLog
- renderDurationMs
- width
- height
- fps
- audioStreamPresent
- videoStreamPresent

Placeholder MP4는 실패로 본다. `ffprobe` 기준 audio/video stream이 있어야 한다.

### longform-qa

역할: render 결과와 production state를 검사한다.

Minimum checks:

- MP4 exists
- ffprobe passes
- audio stream present
- video stream present
- duration is within accepted profile range
- rendered scene count matches scene contract count
- captions do not knowingly exceed safe zone metadata
- blocked routes are disclosed
- existing shorts flow is not modified by this run

### longform-package

역할: 최종 결과를 사용자가 받을 수 있는 package로 정리한다.

Output:

- finalVideoUrl
- titleCandidates
- descriptionDraft
- thumbnailDirection
- sourceNotes
- productionSummary
- blockedEnhancements
- artifactManifest

## 7. Artifact Contract

모든 longform 노드 output은 artifact envelope를 따른다.

```json
{
    "artifactType": "longform-plan",
    "schemaVersion": "1.0",
    "status": "draft",
    "sourceNodeId": "node-longform-plan",
    "inputs": {
        "topic": "AI 에이전트의 미래"
    },
    "content": {},
    "validation": {
        "approved": false,
        "issues": [],
        "warnings": []
    },
    "approvedAt": null
}
```

Required fields:

- artifactType
- schemaVersion
- status
- sourceNodeId
- inputs
- content
- validation
- approvedAt

Allowed status values:

- `draft`
- `needs_user_input`
- `blocked`
- `approved`
- `running`
- `completed`
- `failed`
- `superseded`

## 8. Imported Rulepack Mapping

| sun_tube source                     | eureka-flow target                                               |
| ----------------------------------- | ---------------------------------------------------------------- |
| `CONTENT_FACTORY_PIPELINE.md`       | `base-longform.rules.md`, topic profile rules, node graph policy |
| `TOOL_ROUTING_PIPELINE.md`          | `longform-tool-routing` rules and route enum                     |
| `SCENE_CONTRACT_SYSTEM.md`          | scene contract schema and validator                              |
| `MOTION_GRAPHICS_QUALITY_SYSTEM.md` | `longform-qa`, `hyperframes-compose`, render review rules        |
| project templates                   | artifact envelope and longform package manifest                  |
| hype/Codex skills                   | backend prompt/rulepack text, not runtime skills                 |

## 9. Orchestrator Detection

The orchestrator should produce a longform proposal when the user explicitly asks for:

- 롱폼
- 유튜브 영상
- YouTube longform
- 3분 영상
- 5분 영상
- 10분 영상
- 다큐/해설 영상
- 하이퍼프레임스 영상
- Hyperframes motion explainer

It should not produce a longform proposal for:

- 1분 쇼츠
- 이미지 한 장
- 단순 채팅
- 썸네일만 생성
- 짧은 릴스/TikTok/Reels 요청

If the request is ambiguous, the proposal may proceed with assumptions, but must include clarifying questions in artifact output.

## 10. Backend Touchpoints

Expected backend surfaces:

- block catalog entries for `longform-*` and `hyperframes-*`
- block executor registration for production MVP nodes
- orchestrator prompt update for longform production proposal examples
- response parser compatibility for longform metadata
- artifact envelope validators
- topic profile selector
- approval gate invariant
- TTS provider adapter
- SRT/timing generator
- Hyperframes composition adapter
- render adapter
- ffprobe QA adapter
- run output persistence through existing node output path

This MVP should avoid changing existing shorts rulepacks and media blocks unless integration requires shared provider adapters.

## 11. Frontend Touchpoints

Expected frontend surfaces:

- proposal card shows longform production block list
- proposal card shows estimated cost and safety cap assumptions
- canvas renders longform nodes
- node detail panel displays artifact envelope content
- approval gate status is visible
- TTS/render nodes are blocked until approval
- final MP4 asset is visible in node output or asset list

No new full video editor UI is required for the first production MVP.

## 12. UAT Matrix

### UAT 1. Chat classification

Input:

```text
안녕
```

Expected:

- no proposal
- normal chat response

Input:

```text
AI 에이전트의 미래에 대한 롱폼 유튜브 만들어줘
```

Expected:

- longform production proposal created
- topic profile selected
- production mode, length band, scene count, route mix visible
- no paid execution before approval

### UAT 2. Topic-dependent profile

Inputs:

```text
오픈소스 CLI 도구 소개 롱폼 만들어줘
AI 서비스 사용법 튜토리얼 롱폼 만들어줘
최근 AI 시장 변화 뉴스 롱폼 만들어줘
```

Expected:

- different content patterns are selected
- different production modes are selected
- different asset bias is selected
- MVP safety cap is applied consistently

### UAT 3. Canvas graph

Expected:

- proposal approval places production longform nodes on canvas
- node labels are not `unknown`
- edges follow the production MVP graph order
- existing shorts proposal still works

### UAT 4. Approval gate

Expected:

- `plan_approved !== true` blocks TTS/SRT/render/premium production steps
- backend enforces the block even if frontend tries to bypass it
- approval updates artifact envelope and run metadata

### UAT 5. TTS and timing

Expected:

- approved script generates audio asset
- timing node creates SRT or timing artifact
- timed scene packets map narration to scene start/end
- missing API key blocks before paid execution

### UAT 6. Scene contract and routing

Expected:

- every scene has required contract fields
- every scene has primary route
- non-executed routes are marked `planned` or `blocked`, not silently ignored
- missing primary screen object blocks composition

### UAT 7. Hyperframes compose and render

Expected:

- Hyperframes composition artifact is generated
- MP4 render completes
- output is not placeholder
- `ffprobe` finds video stream
- `ffprobe` finds audio stream

### UAT 8. QA and package

Expected:

- QA reports duration, stream presence, scene count, and known blocked routes
- package returns final video URL
- package includes title candidates, description draft, thumbnail direction

### UAT 9. Shorts regression

Expected:

- existing shorts request still creates the current shorts proposal
- existing shorts block catalog remains available
- no longform changes break `search -> content -> data -> analysis -> media-image + media-tts -> media-video -> integration`

## 13. Acceptance Criteria

The MVP is complete only when all are true.

- `min-longform` contains a committed design and implementation plan before code work starts.
- longform production proposal can be generated.
- topic-dependent production profile is selected.
- MVP safety cap is applied and disclosed.
- longform nodes can be placed on the canvas.
- approval gate is enforced by backend logic.
- TTS audio is generated after approval.
- SRT/timing artifact is generated after TTS.
- scene contracts pass required field validation.
- tool routing exists for every scene.
- Hyperframes composition is generated.
- MP4 render produces real audio/video streams.
- QA blocks placeholder or invalid MP4.
- package exposes final MP4 URL and upload metadata.
- existing shorts UAT remains green.

## 14. Rollout Plan

1. Commit this revised production MVP design spec.
2. User reviews the spec.
3. After approval, write an implementation plan.
4. Implement topic profile and proposal path.
5. Implement approval-gated TTS/SRT path.
6. Implement scene contract and routing validators.
7. Implement minimal Hyperframes composition/render adapter.
8. Implement ffprobe QA and package node.
9. Run no-paid classification/canvas UAT.
10. Run limited paid production smoke with safety cap.
11. Verify existing shorts flow after longform changes.

## 15. Explicit Deferrals

These belong to later phases.

- full `sun_tube` quality automation
- all route execution
- full `video-use` processing integration
- browser capture automation
- imagegen route execution
- documentary asset pipeline
- renderer comparison
- rendered-frame director review
- thumbnail image generation
- upload/publish automation
