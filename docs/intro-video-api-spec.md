# API 명세: `video.intro.v1` 인트로 영상 기능

> 보완 문서. 설계 전체는 [intro-video-feature-spec.md](./intro-video-feature-spec.md).
> 원칙: **기존 HTTP 표면 재사용.** 신규 엔드포인트 없음. 새로 정의하는 것은 ① 5개 블록 I/O zod 계약 ② 렌더러 계약(HF + 신설 Remotion) ③ `introStyle` config 필드뿐. `IntroSceneContract`는 feature-spec §3을 참조(여기서 재정의 안 함).

## 0. 검증된 사실 (코드 추적)

- HF 어댑터 입력 타입 = `HyperframesRenderRequest`(`adapters/external/hyperframes-adapter.ts`). 카드형 visualType(6종 + `fact-card` unknown fallback)만 렌더, 외부 비디오 합성 없음, **local asset URL만 prod 차단**(`!isLocalStage`; 일반 remote URL은 fetch). → feature-spec §11.
- 블록 = `BlockExecutor.execute(input, config?, ctx?) → BlockExecutorResult{ output, durationMs, assets? }`.

---

## 1. HTTP 흐름 — 전부 기존 엔드포인트 재사용 (신규 0)

| 단계                 | 엔드포인트                                                                                        | 신규 필드                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1. 요청              | `POST /flows/{flowId}/messages` `{ content }`                                                     | 없음. orchestrator가 `video.intro.v1` 분류 + `introStyle` 기본값 추론                                                              |
| 2. 제안 발행         | WS `proposal.created`                                                                             | proposal.metadata에 `introStyle`, `contentProfileId:'video.intro.v1'`                                                              |
| 3. 스타일 변경       | 기존 노드 config PATCH(proposal 승인 경로)                                                        | `intro-render.config.introStyle` 패치 (대본 톤 칩과 동일 메커니즘)                                                                 |
| 4. 실행              | `POST /flows/{flowId}/runs` `{ executionMode:'step' }`                                            | 없음 — intro-review에서 정지(체크포인트)                                                                                           |
| 3.5 스타일 선택 정지 | (interactive) `intro-style-options`에서 step 정지                                                 | 사용자가 스타일 후보 중 선택 → config.selectedStyle 패치                                                                           |
| 5. 이어실행          | `POST /flows/{flowId}/runs` `{ resumeFromNodeId:<intro-style-options 또는 intro-review nodeId> }` | resume 엔드포인트는 기존. `buildResumeSeedOutput`에 **intro 분기만 additive 추가**(countryball 분기 불변, 일반화·이관 ❌). 미구현. |
| 6. 결과              | WS `asset.created`(VIDEO) / `run.completed`                                                       | 없음                                                                                                                               |

> 즉 클라이언트 입장에서 **새 API를 배우지 않음**. "소개 영상 만들어줘" → 제안에서 스타일 칩 선택 → 승인 → (검수) → 이어실행.

---

## 2. 블록 I/O 계약 (zod)

```ts
// intro-brief
const IntroBriefInput = z.object({ requestTopic: z.string(), requestUnderstanding: z.record(z.unknown()).optional() });
const FactSchema = z.object({
    key: z.string(), // org|event|date|venue|concept…
    value: z.string(),
    source: z.enum(['user', 'search', 'derived', 'missing']), // 출처 추적(provided 대체)
});
// 노출 규칙: source ∈ {user, search}만 **하드 사실**로 화면 노출. derived=일반화 카피로만, missing=생략.
//   ("6/5·낙산관"이 사용자가 준 건지/검색인지/AI가 요약하다 만든 건지 추적 → 신뢰도·디버깅)
const IntroBriefOutput = z.object({
    mode: z.literal('intro-brief'),
    facts: z.array(FactSchema), // 사용자 입력·source에서만 추출(없으면 source:'missing')
    hook: z.string(),
    build: z.array(z.string()).min(2),
    payoff: z.string(),
    tagline: z.string(),
    suggestedStyle: IntroStyleSchema,
});
//   ⚠️ 락인 #3: 날짜/장소/수치 등 사실은 입력/source에 있을 때만 사용. 없으면 missingFacts로 처리하고
//      카피는 일반화(절대 지어내지 않음). 소개 영상의 날짜·장소 hallucination = 즉시 신뢰도 문제.

// intro-style-options (1차 선택 체크포인트 — countryball-angle-lab 동형)
const IntroStyleOptionsConfig = z.object({
    selectedStyle: IntroStyleSchema.optional(), // 사용자 선택(없으면 정지, auto면 recommended)
    introMode: z.enum(['interactive', 'auto', 'reviewOnly']).default('interactive'),
});
// output: { mode:'intro-style-options', styleOptions:[{id,label,desc,preview}], recommendedChoice,
//           selectedStyle?, styleSelectionStatus:'selected'|'pending' }
//   ※ angle-lab과 동형: selectedStyle 있으면 진행, 없으면 step에서 정지(interactive). resume seed 대상.

// intro-storyboard  → 출력은 IntroSceneContract (feature-spec §3)
const IntroStoryboardInput = IntroBriefOutput.extend({ introStyle: IntroStyleSchema });
// output: { mode:'intro-storyboard', sceneContract: IntroSceneContract }
//   ※ 결정성: cuts[].fromFrame/durFrames 는 완전히 해석된 정수 프레임(HF/Remotion 둘 다 Math.random/Date.now 금지)
//   ※ BGM 비트정렬은 별도 노드 아님 — intro-render 내부에서 내부 BGM 라이브러리 선택 후 처리.

// intro-review (2차 선택 체크포인트, 옵션 — longform-review 동형)
const IntroReviewConfig = z.object({
    introMode: z.enum(['interactive', 'auto', 'reviewOnly']).default('interactive'),
    enableReview: z.boolean().default(false), // 락인 #2: interactive 기본 off
    reviewedOutput: z.record(z.unknown()).optional(), // 사용자 수정 카피/장면
    approved: z.boolean().optional(), // Gate(켰을 때만)
});
//   ⚠️ 락인 #2: 노드는 5개 고정으로 두되, review가 off(기본)면 **pass-through**:
//     output = { ...merged, reviewStatus:'skipped', mediaExecutionAllowed:true } → 정지 안 함.
//     켰을 때만 reviewStatus:'draft'(정지) / 'approved'(통과).
//   ※ execution-engine: isStepReviewStopNode에 'intro-style-options'+'intro-review' 추가 +
//     shouldStopAtStepReviewNode 분기(style-options=선택판정, review=enableReview일 때만 승인판정).

// intro-render
const IntroRenderConfig = z.object({
    introStyle: IntroStyleSchema,
    sceneContract: z.unknown(),
    footageAssets: z.array(z.unknown()).optional(),
});
// output: { mode:'intro', style, video:{ url, previewUrl, downloadUrl, format:'mp4' } } + assets:[{ assetType:'VIDEO', mimeType:'video/mp4', data }]
//   ※ 실행엔진은 assets를 저장하지만 node output에 URL을 자동 주입하지 않음 → 블록 내부에서 S3 저장 후
//     video.url/previewUrl/downloadUrl을 output에 직접 넣어야 함(media-video/countryball-video 동일 패턴).
```

---

## 3. 렌더러 계약 (intro-render → 렌더러)

### 3-A. 익스플레이너 → HyperFrames (직접 호출 — mediaVideoBlock 경유 ❌)

> ⚠️ Codex 교차검증: `mediaVideoBlock`의 HF경로는 `longformGateB`일 때만 활성(`media-video-block.ts:77`) → `mode:'intro'`는 HF로 안 감. **intro-render가 전용 빌더 `buildIntroHyperframesRequest(sceneContract, config)`로 `hyperframesAdapter.renderLongform(req)`를 직접 호출**한다(일반 media-video-block 미접촉 = 경계 유지).
> `req: HyperframesRenderRequest`(실타입, adapter에 정의):

```ts
{
  scenes: HyperframesScene[];        // visualType ∈ event-timeline|comparison|quote-card|process-flow|metric-reveal|source-proof|fact-card(fallback)
  subtitleCues: HyperframesSubtitleCue[];
  motionCues: HyperframesMotionCue[];
  audioUrl: string;                  // 나레이션 (필수) — VO 없으면 buildIntroHyperframesRequest가 무음 트랙 합성해 채움
  backgroundMusic?: false | { url?|path?, volume?, title?, artist? };  // BGM ✅
  outputWidth: number; outputHeight: number; fps?: number; quality?: 'draft'|'standard'|'high';
  signal?; onProgress?;
}
```

→ intro `explainer`는 storyboard를 위 카드형 visualType으로 매핑(빌더). 캐비엇: local asset URL만 prod 차단(remote는 fetch), `audioUrl` 필수(무음 합성은 빌더 책임), 카드형만(키네틱/글래스 불가).

### 3-B. 키네틱/글래스/스크린캐스트 → Remotion 인트로 (신설)

신규 어댑터 `adapters/external/remotion-intro-adapter.ts`:

```ts
export type RemotionIntroRequest = {
    sceneContract: IntroSceneContract; // feature-spec §3
    style: 'kinetic' | 'glass' | 'screencast';
    footageAssets?: Array<{ assetId: string; url?: string; path?: string }>; // screencast 클립
    outputWidth?: number;
    outputHeight?: number;
    fps?: number; // 기본 1920×1080×60
    scale?: 1 | 2; // 2 = 4K
    signal?: AbortSignal;
    onProgress?: (p: number, msg: string) => void | Promise<void>;
};
export interface RemotionIntroAdapter {
    render(req: RemotionIntroRequest, ctx?: BlockExecutorContext): Promise<VideoCompositionResult>;
}
```

구현 = 내가 만든 Remotion 프로젝트를 렌더 서비스화(`@remotion/renderer` `renderMedia`, 또는 Remotion Lambda). sceneContract.cuts → Sequence, footageAssets → `<OffthreadVideo>`, bgm → `<Audio>`. 반환은 HF와 동일한 `VideoCompositionResult{ videoBuffer, sizeBytes, ... }`로 통일.

> route 선택은 `intro-render`가 `config.introStyle`로 결정(feature-spec §4 스텁). 두 어댑터 모두 `VideoCompositionResult` 반환 → 상위 미디어 파이프라인(asset 저장/publish) 공통.

---

## 4. introStyle 필드 (오케스트레이터 + proposal)

- `GenericRequestDecision`에 `introStyle: 'kinetic'|'glass'|'screencast'|'explainer'|null` 추가(AI 추론).
- proposal config: `intro-render.config.introStyle` 기본값 주입.
- 변경 = 기존 노드 config PATCH 경로(대본 톤/이미지 설정 칩과 동일). 신규 엔드포인트 없음.

---

## 5. 가능 여부 매트릭스 (요약 — 상세 feature-spec §11)

| 스타일         | 렌더러         | audioUrl/BGM | 비디오합성         | 현재                             |
| -------------- | -------------- | ------------ | ------------------ | -------------------------------- |
| ④ 익스플레이너 | HF (직접 호출) | ✅           | ❌                 | 🔶 전용 빌더+등록지점 필요(로컬) |
| ① 키네틱       | Remotion(신설) | ✅           | ✅                 | 🔶 어댑터 신설                   |
| ② 글래스       | Remotion(신설) | ✅           | ✅                 | 🔶                               |
| ③ 스크린캐스트 | Remotion(신설) | ✅           | ✅(OffthreadVideo) | 🔶                               |

프로덕션 렌더 배포(HF prod / Remotion Lambda) = 별도 인프라 과제.
