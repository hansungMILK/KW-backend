# Longform Hyperframes Node Design

작성일: 2026-05-10
대상 브랜치: `min-longform`
기준 브랜치: `integration/jt-frontend-on-latest-backend`
기준 커밋: `888f308e2c3d4f4bf52e91e9a99a784ac8f70612`

## 1. Product Boundary

이번 작업의 이름은 **longform artifact MVP**다.

이 MVP는 최종 롱폼 MP4 생성 MVP가 아니다. 목표는 사용자가 자연어로 롱폼 유튜브 제작을 요청했을 때, eureka-flow가 `sun_tube`식 제작 철학과 계약을 노드 그래프로 번역하고, 승인 전 단계까지 필요한 제작 artifact를 쌓을 수 있음을 증명하는 것이다.

성공 기준은 다음 네 가지다.

1. 채팅 요청이 longform proposal로 분류된다.
2. proposal 승인 후 longform 노드들이 캔버스에 배치된다.
3. 각 노드 output으로 제작 artifact가 확인된다.
4. 승인 전에는 TTS, SRT, Hyperframes render, paid API 실행으로 넘어가지 않는다.

## 2. Source System

참고 원본은 `kwmin122/sun_tube`다.

- README: `https://github.com/kwmin122/sun_tube`
- Content factory: `https://raw.githubusercontent.com/kwmin122/sun_tube/main/CONTENT_FACTORY_PIPELINE.md`
- Tool routing: `https://raw.githubusercontent.com/kwmin122/sun_tube/main/TOOL_ROUTING_PIPELINE.md`
- Scene contract: `https://raw.githubusercontent.com/kwmin122/sun_tube/main/SCENE_CONTRACT_SYSTEM.md`
- Motion graphics quality: `https://raw.githubusercontent.com/kwmin122/sun_tube/main/MOTION_GRAPHICS_QUALITY_SYSTEM.md`

이 repo를 eureka-flow 제품 런타임으로 복사하지 않는다. 가져올 것은 제작 철학, artifact 계약, gate 순서, tool routing 기준이다.

`sun_tube` 기준 production flow:

```text
topic
-> topic classification
-> research-pack.md
-> creative-brief.md
-> draft-scene-packets.md
-> script + scene contract in plan.md
-> user approval
-> ElevenLabs TTS + SRT
-> timed-scene-packets.md
-> scene-contracts.md
-> scene tool routing
-> asset-plan.md / design-context.md
-> asset / visual / motion / audio work by scene
-> Hyperframes assembly
-> snapshot / pre-render QA
-> render
-> rendered-frame video review
-> final QA
-> packaging
```

eureka-flow 1차 MVP는 이 중 approval 이전과 scene/tool planning artifact까지만 구현 대상으로 삼는다.

## 3. Non-goals

이번 MVP에서 제외한다.

- 최종 MP4 렌더
- Hyperframes composition 실제 생성
- ElevenLabs 또는 OpenAI TTS 호출
- SRT 생성
- 유료 OpenAI/외부 API 호출
- `sun_tube` repo 전체 복사
- Codex skill을 백엔드 런타임에서 직접 실행
- 사용자가 승인하지 않은 상태에서 asset/render 실행
- 기존 쇼츠 플로우 교체 또는 회귀

## 4. Proposed Node Graph

1차 MVP graph:

```text
longform-intake
-> longform-research
-> longform-brief
-> longform-draft-scenes
-> longform-plan
-> approval-gate
-> longform-scene-contract
-> longform-tool-routing
-> longform-package
```

2차 이후 확장 graph:

```text
longform-intake
-> longform-research
-> longform-brief
-> longform-draft-scenes
-> longform-plan
-> approval-gate
-> longform-tts
-> longform-timing
-> longform-scene-contract
-> longform-tool-routing
-> longform-assets
-> hyperframes-compose
-> longform-qa
-> longform-package
```

## 5. Node Responsibilities

### longform-intake

역할: 사용자 요청을 longform 제작 요청으로 구조화한다.

Output:

- topic
- targetViewer
- outputFormat: `youtube-longform`
- requestedLengthBand
- tone
- assumptions
- missingInputs

### longform-research

역할: no-paid UAT에서는 실제 웹 리서치처럼 보이면 안 된다. 1차 output은 factual research 결과가 아니라 research draft다.

Output:

- research-pack draft
- assumptions
- candidate queries
- source-needed list
- source priority
- risk notes

1차에서는 공식 출처나 웹 검색 결과를 날조하지 않는다. 실제 factual research adapter는 2차로 분리한다.

### longform-brief

역할: 주제의 관점, 길이, 구조, tone, production mode를 정한다.

Output:

- creative-brief
- selected pattern
- production mode
- material bias
- viewer promise
- narrative risk

### longform-draft-scenes

역할: 최종 대본 전에 scene purpose와 visual intent를 먼저 만든다.

Output:

- draft-scene-packets
- scene purpose
- scene role
- material direction
- visual intent
- likely tool route candidates

### longform-plan

역할: 사용자 승인 대상이 되는 script plan을 만든다.

Output:

- plan draft
- scene table
- rough narration
- draft scene contract fields
- approval summary
- blocked questions

### approval-gate

역할: plan approval을 backend invariant로 고정한다.

규칙:

- `plan_approved !== true`면 TTS, timing, render, external paid work로 넘어갈 수 없다.
- UI 버튼만으로 gate를 표현하지 않는다.
- backend executor가 gate를 검사해야 한다.
- 1차 MVP에 TTS/render 노드가 없어도 gate contract는 먼저 둔다.

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

### longform-tool-routing

역할: 각 scene에 primary route와 support route를 붙인다.

허용 route:

- `hyperframes`
- `video-use`
- `imagegen`
- `capture`
- `script/ffmpeg`
- `manual`

1차 MVP에서는 route를 실제 실행하지 않고 artifact로만 남긴다.

### longform-package

역할: 승인 전 artifact bundle을 정리한다.

Output:

- artifact manifest
- next actions
- gate status
- UAT summary
- blocked production steps

## 6. Artifact Contract

모든 longform 노드 output은 단순 JSON이 아니라 artifact envelope를 따른다.

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
- `superseded`

## 7. Imported Rulepack Mapping

| sun_tube source                     | eureka-flow target                                           |
| ----------------------------------- | ------------------------------------------------------------ |
| `CONTENT_FACTORY_PIPELINE.md`       | `base-longform.rules.md`, node graph policy                  |
| `TOOL_ROUTING_PIPELINE.md`          | `longform-tool-routing` rules and route enum                 |
| `SCENE_CONTRACT_SYSTEM.md`          | scene contract schema and validator                          |
| `MOTION_GRAPHICS_QUALITY_SYSTEM.md` | future `longform-qa` and `hyperframes-compose` quality rules |
| project templates                   | artifact envelope and longform package manifest              |
| hype/Codex skills                   | backend prompt/rulepack text, not runtime skills             |

## 8. Orchestrator Detection

The orchestrator should produce a longform proposal when the user explicitly asks for:

- 롱폼
- 유튜브 영상
- YouTube longform
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

## 9. Backend Touchpoints

Expected backend surfaces:

- block catalog entries for `longform-*`
- block executor registration for artifact-only nodes
- orchestrator prompt update for longform proposal examples
- response parser compatibility for new optional metadata
- artifact envelope validators
- approval gate invariant
- run output persistence through existing node output path

This MVP should avoid changing media-image, media-tts, media-video, and existing shorts rulepacks unless regression evidence demands it.

## 10. Frontend Touchpoints

Expected frontend surfaces:

- proposal card shows longform block list
- canvas renders longform nodes
- node detail panel displays artifact envelope content
- approval gate status is visible
- blocked production steps are understandable

No new full editor UI is required for the first MVP.

## 11. UAT Matrix

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

- longform proposal created
- no paid API call
- no TTS/render node execution

### UAT 2. Canvas graph

Expected:

- proposal approval places longform nodes on canvas
- node labels are not `unknown`
- edges follow the MVP graph order
- existing shorts proposal still works

### UAT 3. Artifact output

Expected:

- each node returns artifact envelope
- `artifactType` and `schemaVersion` exist
- `validation.approved` exists
- `approvedAt` exists and is null until approval

### UAT 4. Approval gate

Expected:

- `plan_approved !== true` blocks TTS/render/premium production steps
- blocked state is visible in node output
- backend enforces the block even if frontend tries to bypass it

### UAT 5. Research honesty

Expected:

- no-paid mode produces `research-pack draft`
- source-needed list is explicit
- output does not pretend live web research happened
- factual claims are marked as assumptions unless sourced

### UAT 6. Shorts regression

Expected:

- existing shorts request still creates the current shorts proposal
- existing shorts block catalog remains available
- no longform changes break `search -> content -> data -> analysis -> media-image + media-tts -> media-video -> integration`

## 12. Acceptance Criteria

The MVP is complete only when all are true.

- `min-longform` contains a committed design and implementation plan before code work starts.
- longform proposal can be generated without paid calls.
- longform nodes can be placed on the canvas.
- artifact envelopes are visible through existing node output UI/API.
- approval gate is enforced by backend logic, not only UI state.
- research node is honest about no-paid draft status.
- existing shorts UAT remains green.

## 13. Rollout Plan

1. Commit this design spec.
2. User reviews the spec.
3. After approval, write an implementation plan.
4. Implement artifact-only longform nodes.
5. Run no-paid UAT.
6. Add limited paid or external adapters only after artifact flow passes.

## 14. Explicit Deferrals

These belong to later phases.

- ElevenLabs TTS adapter
- SRT timing generation
- Hyperframes composition worker
- rendered-frame QA
- final MP4 packaging
- thumbnail generation
- source capture automation
- `video-use` processing integration
- imagegen route execution
