# 콘텐츠 프로필과 롱폼 제작 설계

작성일: 2026-05-13
브랜치: `codex/content-profile-longform-20260513`
기준 브랜치: `integration/jt-frontend-on-latest-backend`

## 1. 목표

`eureka-flow`는 쇼츠 전용 제작기가 아니다. 사용자가 자연어로 원하는 산출물을 말하면, 시스템이 그 목표에 맞는 워크플로우를 제안하고, 사용자가 비용/톤/화풍/길이/검수 단계를 승인한 뒤 실행하는 범용 블록 자동화 플랫폼이다.

이번 설계의 목표는 두 가지다.

1. 쇼츠 제작에서 대본 톤, 이미지 화풍, 장면 수, 비용, 검수 단계를 사용자가 고를 수 있게 만든다.
2. 같은 선택 구조를 롱폼 제작에도 확장해서, 대본/씬 검수 후 TTS, SRT, HyperFrames, Video Use, MP4, QA, 패키징까지 이어지는 생산 파이프라인을 정의한다.

## 2. 제품 원칙

- 쇼츠는 기본 데모 레시피일 뿐, 제품 정체성이 아니다.
- 사용자의 요청이 텍스트, 이미지, 쇼츠, 롱폼, 데이터, 자동화 중 무엇인지 먼저 분류한다.
- 대본 톤과 이미지 화풍은 주제마다 달라야 한다. 프롬프트나 테스트에 특정 주제, 특정 기사, 특정 인물을 박아 넣지 않는다.
- URL이 있으면 그 URL의 원문이 1순위 source다. 웹 검색은 원문 보강, 검증, 최신성 확인에만 사용한다.
- 유료 실행은 사용자가 비용과 실행 범위를 본 뒤 승인해야 한다.
- 최종 완료 기준은 “블록이 생김”이 아니라 실제 산출물이 검증되는 것이다. 영상이면 MP4, 오디오 스트림, 비디오 스트림, 해상도, duration, 다운로드 경로까지 확인한다.

## 3. 비범위

이번 스펙은 구현 계획의 상위 설계다. 바로 모든 블록을 새로 만들지 않는다.

이번 스펙에서 제외:

- 외부 서비스 계정 자동 생성
- YouTube 업로드 자동화
- 광고/수익화 기능
- 무제한 장면 수 또는 무제한 길이 렌더
- 저작권 있는 YouTube 자막/대본의 장문 복사
- `sun_tube` 또는 다른 repo의 코드 통째 복붙

## 4. 현재 코드 기준

현재 repo에는 이미 일부 기반이 있다.

- `WorkflowPlan`은 `outputType`, `planType`, `selectedBlocks`, `rejectedBlocks`, `assumptions`를 가진다.
- proposal 승인 요청은 `imageStyleId`, `imageQuality`, `sceneCount`를 받을 수 있다.
- 프론트 proposal 카드에는 이미지 모델, 장면 수, 화풍, 품질, 예상 비용 선택 UI가 있다.
- 쇼츠 대본/장면 생성을 위한 rulepack이 존재한다.
- 이미지 생성은 `gpt-image-2`와 스타일 preset을 사용한다.
- 현재 쇼츠 UAT 문서는 `docs/superpowers/specs/2026-05-10-workflow-uat-design.md`에 있다.

따라서 1차 구현은 새 시스템을 옆에 만들기보다, 기존 proposal metadata와 content/media block config를 확장하는 방식이 맞다.

## 5. 핵심 계약: ContentProductionProfile

`ContentProductionProfile`은 사용자의 제작 의도를 실행 가능한 제작 옵션으로 고정하는 공통 계약이다.

```ts
type ContentProductionProfile = {
    profileId:
        | 'text.explainer.v1'
        | 'image.single.v1'
        | 'shorts.info.v1'
        | 'shorts.story.v1'
        | 'longform.explainer.v1'
        | 'longform.documentary.v1';
    outputKind: 'text' | 'image' | 'shorts' | 'longform' | 'mixed';
    sourcePolicy: {
        primarySourceMode: 'url-first' | 'query-first' | 'user-brief-first';
        requireSourceRefs: boolean;
    };
    scriptTone: {
        toneId: 'informative-reframe' | 'mz-viral' | 'news-anchor' | 'story-dialogue' | 'calm-explainer';
        intensity: 'low' | 'medium' | 'high';
    };
    mediaPlan: {
        aspectRatio: '9:16' | '16:9';
        durationBand: '45-60s' | '3-5m' | '5-8m';
        sceneCount: number;
        imageStyleId?: string;
        imageQuality?: 'low' | 'medium' | 'high';
        renderResolution: '1080x1920' | '1920x1080' | '2560x1440' | '1440x2560';
    };
    reviewPolicy: {
        scriptReviewRequired: boolean;
        sceneReviewRequired: boolean;
        paidExecutionRequiresApproval: boolean;
    };
    rendererPolicy: {
        renderer: 'ffmpeg-shorts' | 'hyperframes' | 'video-use' | 'hybrid';
        qaRequired: boolean;
    };
};
```

이 계약은 proposal metadata에 저장하고, 승인 시 flow node config로 전파한다. 프론트는 이 값을 읽어 사용자 선택 UI를 보여준다.

## 6. 대본 톤 프리셋

대본 톤은 prompt 문자열 하나가 아니라 재사용 가능한 rulepack이다. 각 톤은 “말투”, “구조”, “금지 표현”, “출처 처리”, “자막 길이”를 함께 정의한다.

### 6.1 정보전달/문제 재정의형

ID: `informative-reframe`

용도:

- 기술, 경제, 사회 이슈, 제도 변화, 논란 설명
- 사용자가 “왜 이런 일이 생겼는지 알려줘”, “핵심만 정리해줘”라고 요청할 때

구조:

1. 겉보기 문제를 찌른다.
2. 진짜 원인을 다시 정의한다.
3. 쉽게 정의한다.
4. 기존 방식의 한계를 보여준다.
5. 핵심 3가지를 정리한다.
6. 현실 예시를 든다.
7. 관점 전환으로 끝낸다.

금지:

- 근거 없는 공포 조장
- “무조건 하세요”
- 전문용어를 설명 없이 나열

### 6.2 MZ 바이럴형

ID: `mz-viral`

용도:

- 가벼운 트렌드, 앱/서비스 이슈, 커뮤니티 확산 소재

규칙:

- 훅과 전환부에만 유행어를 제한적으로 쓴다.
- 사실 설명 장면은 출처 중심으로 쓴다.
- “님들 이거 앎?” 같은 문장은 사용할 수 있지만, 주제의 신뢰성을 깨면 안 된다.
- 유행어 목록은 코드에 고정하지 않고 `scriptTone.intensity`와 최신 tone pack으로 관리한다.

주의:

- 의료, 사고, 법적 분쟁, 피해자 있는 사건에는 기본 추천하지 않는다.
- 사실 전달보다 유행어가 앞서면 품질 검수에서 warning을 낸다.

### 6.3 뉴스앵커형

ID: `news-anchor`

용도:

- 공식 발표, 기업공시, 법/정책, 논란 정리

규칙:

- 단정적이고 짧게 말한다.
- “확인됐습니다”, “알려졌습니다”, “다만” 같은 뉴스 문법을 사용한다.
- 확인되지 않은 내용은 추정으로 분리한다.
- CTA는 자제한다.

### 6.4 이야기 진행형/대화형

ID: `story-dialogue`

용도:

- 시청자가 따라가기 쉬운 내러티브형 정보 전달
- “처음엔 A처럼 보였는데, 알고 보니 B였다” 구조

규칙:

- 장면 간 질문과 답변으로 진행한다.
- 한 장면마다 궁금증을 만들고 다음 장면에서 해소한다.
- YouTube Shorts 레퍼런스는 문장 복사가 아니라 구조 분석만 사용한다.
- 사용자가 직접 자막/대본 샘플을 제공하면, 25단어 이하의 짧은 인용만 분석하고 나머지는 구조로 일반화한다.

### 6.5 차분한 해설형

ID: `calm-explainer`

용도:

- 롱폼 기본값
- 교육, 기술 개념, 역사, 기업 분석

규칙:

- 과장된 유튜버 말투를 피한다.
- 정보 밀도를 높이되 문장은 짧게 끊는다.
- 장면보다 논리 흐름을 우선한다.

## 7. 사용자 선택 UX

proposal 카드에는 다음 순서로 선택지를 보여준다.

1. 산출물 종류: 텍스트, 이미지, 쇼츠, 롱폼
2. 길이: 쇼츠 45-60초, 롱폼 3-5분, 롱폼 5-8분
3. 대본 톤: 정보전달형, MZ 바이럴형, 뉴스앵커형, 이야기 진행형, 차분한 해설형
4. 대본 검수: 바로 실행, 대본 검수 후 실행
5. 장면 수: 쇼츠 8/12/16장, 롱폼 6/8/12 scenes
6. 이미지 화풍: 기존 `IMAGE_STYLE_PRESETS`
7. 이미지 품질: low/medium/high
8. 예상 비용: 텍스트/이미지/TTS/영상 합성 분리 표시
9. 승인 버튼

선택값은 `POST /proposals/{proposalId}/approve` body에 들어간다.

```json
{
    "layoutType": "vertical",
    "imageStyleId": "photo-real",
    "imageQuality": "medium",
    "sceneCount": 12,
    "scriptToneId": "informative-reframe",
    "scriptToneIntensity": "medium",
    "contentProfileId": "shorts.info.v1",
    "reviewMode": "script-first"
}
```

기존 계약에 없는 필드는 구현 단계에서 contracts, backend approve handler, proposal service, frontend API를 함께 확장한다.

## 8. 쇼츠 제작 플로우

기본 쇼츠는 지금 플로우를 유지하되, profile metadata를 통과시킨다.

```text
source.collect
  -> script.generate
  -> scene.normalize
  -> quality.review
  -> image.generate
  -> tts.generate
  -> shorts.compose
  -> metadata.generate
```

### 쇼츠 성공 기준

- 사용자 URL이 있으면 원문 중심 대본이 나온다.
- 대본 톤 선택이 실제 narration 문장에 반영된다.
- 이미지 프롬프트는 style-neutral이어야 하고, 화풍은 `media-image`에서만 적용된다.
- 이미지 12장을 요청하면 12장 전부 완료되어야 한다.
- Adam TTS 등 voice 선택은 config로 전달된다.
- 최종 MP4 미리보기와 다운로드 경로가 UI에 보인다.

## 9. 롱폼 제작 플로우

롱폼은 쇼츠보다 비용과 실패 영향이 크다. 따라서 Gate A와 Gate B를 분리한다.

### Gate A. Production Foundation

유료 실행 전 설계 산출물을 만든다.

```text
source.collect
  -> longform.outline
  -> script.draft
  -> scene.plan
  -> user.review
```

Gate A 산출물:

- source digest
- outline
- full script draft
- scene plan
- estimated duration
- estimated cost
- renderer route
- QA checklist

Gate A에서는 대본/씬 승인 전 TTS, 이미지, HyperFrames render, MP4 생성이 실행되지 않는다.

### Gate B. Production Smoke

사용자가 Gate A 산출물을 승인하면 실제 제작을 실행한다.

```text
user.review.approved
  -> tts.generate
  -> srt.align
  -> scene.contract
  -> render.route
  -> hyperframes.compose 또는 video-use.edit
  -> mp4.render
  -> ffprobe.qa
  -> package.output
```

Gate B 성공 기준:

- 실제 MP4가 생성된다.
- 비디오 스트림과 오디오 스트림이 있다.
- 기본 롱폼 해상도는 2K 16:9, `2560x1440`이다.
- 세로형 롱폼을 사용자가 고르면 `1440x2560`을 쓴다.
- SRT 또는 자막 타이밍이 음성과 크게 어긋나지 않는다.
- preview/download path가 UI에 보인다.
- QA 실패 시 completed로 표시하지 않는다.

## 10. HyperFrames와 Video Use 역할

공식 HyperFrames 문서는 AI agent가 HTML, CSS, JS를 작성해서 비디오 composition을 만들 수 있다고 설명한다. 이 특성상 `eureka-flow`에서는 “그래픽/모션/정보 카드/장면 composition”에 적합하다.

Video Use는 원본 영상 폴더를 받아 transcript, timeline view, EDL, render, self-eval 루프로 `final.mp4`를 만드는 편집 파이프라인이다. 원본 footage가 있을 때 컷 편집, 자막 burn-in, 색보정, dead space 제거에 적합하다.

라우팅 규칙:

| 사용자 요청                   | 기본 route      | 이유                                       |
| ----------------------------- | --------------- | ------------------------------------------ |
| 원본 영상 없이 롱폼 설명 영상 | `hyperframes`   | HTML/CSS/JS 기반 정보 장면 제작            |
| 촬영본/인터뷰/강의 파일 편집  | `video-use`     | transcript 기반 컷 편집과 self-eval        |
| 촬영본 위에 정보 그래픽 추가  | `hybrid`        | Video Use로 컷 편집 후 HyperFrames overlay |
| 쇼츠 기본 템플릿              | `ffmpeg-shorts` | 현재 안정 경로 유지                        |

## 11. 필요한 신규/확장 노드

1차 구현은 기존 블록을 최대한 재사용하고, longform 전용 블록은 Gate A부터 얇게 추가한다.

### 기존 블록 확장

- `search`: URL-first source policy 강화
- `content`: `scriptToneId`, `contentProfileId`, `durationBand` 반영
- `data`: scene contract에 longform 필드 추가
- `analysis`: tone/source/duration QA 추가
- `media-tts`: longform chunk TTS와 SRT alignment 입력 지원
- `media-video`: shorts compose와 longform route를 분리
- `integration`: package output과 metadata 생성

### 신규 후보 블록

- `longform-outline`: source digest에서 outline 생성
- `user-review`: 대본/씬 approve, reject, request changes
- `srt-align`: TTS와 문장/단어 timing 정렬
- `scene-contract`: HyperFrames/Video Use가 읽을 장면 계약 생성
- `hyperframes-compose`: HTML/CSS/JS composition 생성
- `video-use-edit`: raw footage 편집 route
- `render-qa`: ffprobe, duration, stream, resolution, caption safe-zone 확인
- `package-output`: MP4, SRT, script, sources, scene plan 묶기

신규 블록은 바로 전부 만들지 않는다. 구현 계획에서는 `content profile + tone selection`을 먼저 끝낸 뒤, `user-review`와 `longform-outline`부터 순서대로 들어간다.

## 12. Review와 시도 이력

롱폼에서는 request changes가 흔하다. 기존 attempt를 덮어쓰면 안 된다.

```ts
type ReviewableArtifact = {
    artifactId: string;
    flowId: string;
    runId?: string;
    nodeId: string;
    artifactType: 'outline' | 'script' | 'scene-plan' | 'srt' | 'render-plan';
    attemptNo: number;
    status: 'draft' | 'approved' | 'rejected' | 'superseded';
    supersedes?: string;
    supersededBy?: string;
    reviewDecision?: {
        decision: 'approve' | 'reject' | 'request_changes';
        note?: string;
        decidedAt: string;
    };
    estimatedCostShownAt?: string;
    paidExecutionApprovedAt?: string;
    paidExecutionStartedAt?: string;
};
```

규칙:

- `request_changes`는 기존 artifact를 `superseded`로 만들고 새 attempt를 만든다.
- `approved` artifact만 Gate B 입력이 될 수 있다.
- paid execution은 `paidExecutionApprovedAt` 이후에만 시작할 수 있다.
- provider 실패는 지우지 않고 trace/providerCalls에 남긴다.

## 13. 비용 정책

비용은 사용자가 승인 전에 볼 수 있어야 한다.

표시 항목:

- text/research cost estimate
- image cost estimate
- TTS cost estimate
- render/compose estimate
- max run limit
- paid execution enabled 여부

쇼츠 기본값:

- 12 scenes
- `gpt-image-2`
- image quality medium
- Adam TTS
- 기본 BGM 1개

롱폼 1차 기본값:

- 최대 5분
- 최대 8 scenes
- 2K render
- Gate A는 low-cost planning
- Gate B는 사용자가 별도 승인

## 14. UI 출력 계약

사용자는 “지금 어디서 무엇이 생성되는지”를 봐야 한다.

필수 UI:

- 실행 상태 카드: 현재 노드명, 완료 수, 대기 중인 다음 노드, 진행 문장
- 노드 활성 표시: running node border/glow/progress
- 노드 출력 미리보기:
    - 대본: 읽기 쉬운 script viewer와 편집 가능한 review textarea
    - 이미지: 갤러리
    - 오디오: player
    - 영상: preview player와 MP4 다운로드 버튼
    - JSON: 접을 수 있는 structured viewer
    - Markdown/text: 문서형 viewer
- 대본 검수 모드: 대본 노드에서 멈추고, 사용자가 수정본을 저장하면 다음 실행에서 그 수정본을 사용한다.

## 15. 검증 전략

### 정적 검증

```bash
npx nx run @flows/backend:typecheck --skip-nx-cache
npx nx run @flows/web:typecheck --skip-nx-cache
npx nx run @flows/flows:typecheck --skip-nx-cache
npx nx run @flows/backend:lint --skip-nx-cache
npx nx run @flows/web:lint --skip-nx-cache
npx nx run @flows/flows:lint --skip-nx-cache
```

### 단위 테스트

- `ContentProductionProfile` schema validation
- `scriptToneId` approval payload validation
- tone rulepack selection
- image style and script tone conflict prevention
- URL-first source policy
- request changes attempt lineage
- Gate A blocks paid execution
- Gate B requires approved script/scene plan

### 브라우저/E2E

1. 사용자가 “쇼츠 만들어줘”를 입력한다.
2. proposal 카드에서 대본 톤, 장면 수, 화풍, 품질을 선택한다.
3. 예상 비용이 선택값에 맞게 바뀐다.
4. 대본 검수 모드로 실행한다.
5. 대본 노드에서 생성 대본이 보인다.
6. 사용자가 수정본을 저장한다.
7. 다시 실행하면 수정본으로 이미지/TTS/MP4가 생성된다.
8. 최종 영상 preview/download가 보인다.

롱폼 E2E는 Gate A부터 시작한다.

1. “롱폼 제작해줘”를 입력한다.
2. 롱폼 profile proposal이 나온다.
3. Gate A만 실행된다.
4. outline/script/scene plan이 보인다.
5. 사용자가 approve/request changes를 할 수 있다.
6. 승인 전에는 Gate B 유료 실행 버튼이 비활성이다.

## 16. 구현 순서

### Phase 1. Shorts profile and tone selection

- contracts에 `scriptToneId`, `contentProfileId`, `reviewMode` 추가
- proposal metadata에 `ContentProductionProfile` 저장
- FlowAgentPanel에 대본 톤/검수 방식 UI 추가
- approval override를 content/media node config에 전파
- content-block rulepack selector가 tone을 반영
- 기존 쇼츠 E2E 회귀 방지

### Phase 2. Script review UX hardening

- 대본 노드 viewer/editor 개선
- reviewed output 저장과 재실행 경로 테스트
- 실행 상태 카드와 노드 active state 개선

### Phase 3. Longform Gate A

- `longform-outline` 또는 content mode 확장
- longform outline/script/scene plan artifact 생성
- `user-review` 계약과 attempt lineage 구현
- Gate A E2E

### Phase 4. Longform Gate B smoke

- TTS chunking
- SRT alignment
- scene contract
- HyperFrames compose route
- ffprobe QA
- package output
- 2K smoke render

### Phase 5. Video Use route

- raw footage input contract
- Video Use project folder handoff
- EDL/render/self-eval artifact import
- hybrid route with HyperFrames overlay

## 17. 하드코딩 방지 규칙

- 테스트 fixture는 특정 기사/인물에 의존하지 않는다.
- 예시 주제는 “source URL”, “topic title”, “claim” 같은 generic fixture로 둔다.
- 프롬프트에 “항상 교육 쇼츠”, “항상 최신 공식 입시 자료”, “항상 12장” 같은 문장을 넣지 않는다.
- 12장은 쇼츠 default일 뿐, 사용자 선택 또는 profile default로만 결정된다.
- imagePrompt에는 화풍을 박지 않는다. 화풍은 `imageStyleId`가 담당한다.
- 대본 tone은 content-block system prompt 내부에 흩뿌리지 않고 tone rulepack에서 선택한다.
- 롱폼은 쇼츠 block label을 재사용하지 않는다.

## 18. 완료 기준

이 스펙의 구현이 완료됐다고 말하려면 다음을 통과해야 한다.

- 쇼츠 proposal에서 대본 톤, 장면 수, 화풍, 품질, 검수 방식을 선택할 수 있다.
- 선택값이 backend contracts, proposal approval, node config, content/media blocks까지 이어진다.
- URL 기반 쇼츠 대본이 원문 중심으로 생성된다.
- 대본 검수 모드가 실제로 실행을 멈추고, 수정본이 다음 실행에 사용된다.
- 최종 MP4 preview/download가 사용자 화면에서 확인된다.
- 롱폼 Gate A가 outline/script/scene plan을 만들고, 승인 전 유료 Gate B를 막는다.
- Gate B smoke는 실제 2K MP4와 QA/package를 만든다.
- 모든 자동 검증과 최소 1회 Playwright E2E가 통과한다.

## 19. 참고한 외부 자료

- HyperFrames: https://hyperframes.heygen.com/
- Video Use: https://github.com/browser-use/video-use
