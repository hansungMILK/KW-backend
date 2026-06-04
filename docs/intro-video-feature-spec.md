# Spec: `video.intro.v1` — 인트로/프로모 영상 생성 기능

> 목표: "우리 제품 소개 영상 만들어줘" → AI가 카피·타이밍 구성 → **스타일(키네틱 타이포 / Liquid Glass / …) 선택** → **스타일별 렌더(explainer=HyperFrames / kinetic·glass·screencast=Remotion 인트로 어댑터)** → MP4 asset.
> 원칙: **additive**. 기존 일반/롱폼/컨트리볼 블록 안 건드림. 레시피+전용 블록+스타일 enum으로만 추가. 기존 cost guard·Gate·resume 체크포인트 패턴 재사용.

검증된 사실(코드 기준):

- 레시피 = `WorkflowRecipeManifest` (defaultBlocks/defaultEdges/costPolicy) → `workflow-packs/*-pack.ts`, `index.ts`에 등록.
- 블록 = `BlockExecutor { readonly blockType; execute(input, config?, context?): Promise<BlockExecutorResult> }`, `block-registry.ts`에 register.
- 렌더 경로: `longform-render`는 `mediaVideoBlock`(longformGateB 게이트)을 경유하지만, **intro-render는 경유하지 않는다** — explainer만 `hyperframesAdapter.renderLongform`을 직접 호출, kinetic/glass/screencast는 신설 `remotionIntroAdapter` 직접 호출(§11, §4). 일반 media-video-block 미접촉.
- 비용: `openai-orchestrator.ts`의 `COST_ESTIMATES: Record<AllowedBlockType, number>` + recipe `costPolicy`. proposal 패널 `예상 비용` + `checkRunCostLimit` + Gate.

---

## 0.5 Codex 교차검증 반영 (개정 — 초안의 오류 수정)

초안은 **NO-GO**였다. 교차검증으로 드러난 실제 코드 사실과 수정:

1. **(최대 결함) explainer→HF 위임 불가.** `media-video-block.ts:77`의 HF경로는 `longformGateB`일 때만 활성 → `mediaVideoBlock.execute({mode:'intro'})`는 HF로 안 가고 ffmpeg 경로로 빠진다. **수정:** intro-render가 전용 HF request 빌더로 `hyperframesAdapter.renderLongform`을 **직접** 호출(§4 수정됨). 이게 경계(D)도 지킴 — 일반 media-video-block 미접촉.
2. **resume가 countryball 전용.** 내가 짠 `run-service.ts`의 `buildResumeSeedOutput`이 `countryball-angle-lab`만 허용(seed) → intro-review resume 불가. **수정 필요:** `buildResumeSeedOutput` + resume 체크포인트 allowlist를 intro-review까지 확장(§9).
3. **step-stop "1줄"은 틀림.** `shouldStopAtStepReviewNode`는 기본 `return true`라 승인 후에도 멈춤. **수정:** `isStepReviewStopNode`에 intro-review 추가 **+** `shouldStopAtStepReviewNode`에 `!isApprovedIntroReview(outputPayload)` 승인 판정 분기 추가(§9).
4. **HF 능력 미세정정.** visualType은 6 특수 + `fact-card`(unknown fallback 포함) = 카드형 데이터-viz. "프로덕션 막힘"은 과장 — **local asset URL만** `!isLocalStage`에서 차단, 일반 remote URL은 fetch. 단 prod 배선 완성 보증은 없음.
5. **누락 등록 지점**(§12에 추가): run-service provider preflight map, execution-engine render timeout 분기, generic decision prompt/schema의 intro intent+recipeId, frontend `run-mode.ts` reviewKind/카피(현재 `script|countryball-angle`만).
6. **비용 낙관.** intro-render:0.05는 임의값. longform-render=0.5/media-video=0.2 대비 Remotion Lambda(콜드스타트·업로드·폰트·asset fetch) 고려 시 비현실. §10 재추정.
7. **경계.** intro-render는 전용 intro HF 빌더/Remotion 어댑터만 호출. 일반 media-video-block에 intro 분기 추가 금지.

> 결론: 개념·아키텍처 정합은 유지(레시피+블록+route+gate). 단 **렌더 진입(전용 어댑터)·resume seed 확장·step-stop 승인분기·누락 등록지점**을 구현해야 동작. 아래 본문은 이 수정을 반영.

---

## 1. 블록 라인업 & 베스트 흐름 (Codex 2차 반영 — 구조 확정)

```
intro-brief         카피 추출(훅/빌드/페이오프/태그라인)                       [LLM]    cap: intro.brief
intro-style-options  스타일 후보 3~4개 + 추천 → 사용자 선택 (쇼츠 angle-lab 패턴) [LLM]    cap: intro.style-options
intro-storyboard    선택 스타일+카피 → IntroSceneContract                       [LLM/det] cap: intro.storyboard
intro-review        (선택) 최종 카피·장면 승인 게이트                           [-]      cap: intro.review
intro-render        SceneContract+스타일 → MP4 (explainer=HF직접 / 그외=Remotion직접) [render] cap: intro.render
```

DAG: `intro-brief → intro-style-options → intro-storyboard → intro-review(선택) → intro-render`

베스트 흐름 핵심:

- **스타일 = 사용자 선택 노드** `intro-style-options`(쇼츠 angle-lab과 동일 패턴): ①키네틱 ②Liquid Glass ③스크린캐스트 ④익스플레이너 후보+추천을 보여주고 고르게. **선택은 여기 한 곳** — proposal 패널 칩과 이중 검수 만들지 않음.
- **`intro-review`는 옵션**(최종 카피/장면 승인). 무조건 정지 ❌.
- **음악은 visible 노드 아님** → `intro-music-sync` 노드 제거. BGM은 **내부 라이브러리 자동 선택**, 비트 정렬은 `intro-render` **내부 처리**. 사용자 mp3는 **선택적 고급 입력**(`intro-render.config.bgmAssetId`).
- **v1 오디오/푸티지 단순화(동적 노드 삽입 ❌):** kinetic/glass = 무음 또는 BGM only / explainer = HF audioUrl 필수라 intro-render가 무음 트랙 또는 전용 VO 생성(책임 명시) / screencast = 사용자 footage 있을 때만.

### 실행 모드 (`intro-render.config.introMode` 또는 recipe 기본값)

- **interactive (기본):** `intro-style-options`에서 1회 정지(스타일 선택). `intro-review`는 옵션으로 추가 정지.
- **auto:** 추천 스타일 자동 선택, 정지 없이 render까지.
- **reviewOnly:** 스타일 자동, 최종 `intro-review`에서만 정지.

### 스타일 변경 후 재실행 범위

- **같은 contract 호환(kinetic ↔ glass):** IntroSceneContract 그대로 → `intro-render`만 재실행.
- **contract가 달라지는 변경(→ screencast/explainer):** footage/audio/scene 매핑이 달라짐 → `intro-storyboard`부터 재생성. ("항상 render만 재실행"은 과장.)

---

## 2. 타입 추가 (단일 소스 갱신)

### `apps/backend/src/modules/blocks/types.ts` — `BLOCK_TYPES`

```ts
// ... 기존 ...
'intro-brief',
'intro-style-options',
'intro-storyboard',
'intro-review',
'intro-render',
```

### `apps/backend/src/modules/orchestrator/response-parser.ts` — `ALLOWED_BLOCK_TYPES`

동일 5개 추가 (AllowedBlockType = (typeof ALLOWED_BLOCK_TYPES)[number]).

### `apps/backend/src/modules/workflow-packs/orchestrator-block-catalog.ts` — `WorkflowCapability` + `ORCHESTRATOR_BLOCK_CATALOG`

```ts
// WorkflowCapability union 에 추가
| 'intro.brief' | 'intro.style-options' | 'intro.storyboard' | 'intro.review' | 'intro.render'

// ORCHESTRATOR_BLOCK_CATALOG 에 추가 (예시 1개; 나머지 동형)
'intro-render': {
  blockType: 'intro-render',
  label: '인트로 영상 렌더',
  capabilities: ['intro.render'],
  input: 'intro scene contract + style',
  output: 'video',
  whenToUse: '소개/프로모/오프닝 영상을 스타일 템플릿(키네틱·글래스 등)으로 렌더할 때',
  whenNotToUse: '쇼츠/롱폼 본편 영상(별도 파이프라인)',
},
```

### `apps/backend/src/modules/workflow-packs/http-block-catalog.ts` — `BLOCK_CATALOG`

각 신규 블록의 `$definition`(type/label/inputs/outputs/config schema) 추가. `contributionFor()`가 http+orchestrator 둘 다 요구하므로 **둘 다** 채워야 함.
신규 config 필드: `introStyle`, `sceneContract`, `bgmAssetId`, `userFootageAssetId`, `reviewedOutput`(체크포인트), `approved`(Gate).

---

## 3. 핵심 신규 데이터: `IntroSceneContract` (intro-storyboard 출력 = HyperFrames 입력)

`apps/backend/src/modules/blocks/intro/intro-scene-contract.ts`

```ts
import { z } from 'zod';

export const IntroStyleSchema = z.enum(['kinetic', 'glass', 'screencast', 'explainer']);
export type IntroStyle = z.infer<typeof IntroStyleSchema>;

export const IntroCutSchema = z.object({
    fromFrame: z.number().int(),
    durFrames: z.number().int(),
    kind: z.enum(['word', 'footage', 'logo', 'glass-chain', 'black']),
    // word / slam (kinetic)
    text: z.string().optional(),
    invert: z.boolean().optional(),
    slam: z.boolean().optional(),
    // footage (screencast / demo cut-in)
    footage: z
        .object({
            assetId: z.string(),
            trimStartSec: z.number().default(0),
            playbackRate: z.number().default(1),
            crop: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional(),
            label: z.string().optional(),
            device: z.boolean().optional(), // 폰 카드 프레이밍
        })
        .optional(),
    // logo (close)
    logo: z
        .object({
            wordmark: z.string(),
            tagline: z.string().optional(),
            withText: z.string().optional(), // "with LemonCloud"
            withColors: z.array(z.string()).optional(), // 부분 색상
            animation: z.enum(['blur-shimmer', 'letter-stagger', 'mask-wipe']).default('blur-shimmer'),
        })
        .optional(),
    // glass-chain (Liquid Glass)
    nodes: z.array(z.object({ label: z.string(), from: z.string(), to: z.string() })).optional(),
});

export const IntroSceneContractSchema = z.object({
    style: IntroStyleSchema,
    fps: z.number().default(60),
    width: z.number().default(1920),
    height: z.number().default(1080),
    letterbox: z.number().default(132), // 0 = no bars
    fontFamily: z.string().default('SUIT'),
    bgm: z
        .object({
            assetId: z.string(),
            startSec: z.number().default(0),
            bpm: z.number().optional(),
            beatGridFrames: z.array(z.number()).default([]),
        })
        .optional(),
    cuts: z.array(IntroCutSchema),
});
export type IntroSceneContract = z.infer<typeof IntroSceneContractSchema>;
```

> 이 컨트랙트는 내가 만든 Remotion 영상 구조의 직렬화 — **Remotion 중심 계약**(표현 가능성 증명됨). kinetic/glass/screencast는 `remotionIntroAdapter`가 이 컨트랙트를 **직접** 렌더. explainer(HF)는 이 컨트랙트를 `buildIntroHyperframesRequest`로 **`HyperframesRenderRequest`(카드형 scenes)로 변환**해 사용 — HF는 변환 계약이지 직접 해석이 아님.

---

## 4. 블록 핸들러 스텁 — `apps/backend/src/modules/blocks/intro/`

```ts
// intro-render-block.ts  — mediaVideoBlock 경유 ❌ (longformGateB 게이트 + 경계). 전용 어댑터 직접 호출.
import { hyperframesAdapter } from '../../adapters/external/hyperframes-adapter';
import { remotionIntroAdapter } from '../../adapters/external/remotion-intro-adapter'; // 신설
import { buildIntroHyperframesRequest } from './build-intro-hf-request'; // 신설: SceneContract→HyperframesRenderRequest(+무음오디오)
import { persistIntroVideo } from './persist-intro-video'; // 신설: S3 저장 → {url,previewUrl,downloadUrl}
import type { BlockExecutor, BlockExecutorResult } from '../types';

export const introRenderBlock: BlockExecutor = {
    blockType: 'intro-render',
    async execute(input, config, context): Promise<BlockExecutorResult> {
        const start = Date.now();
        const style = (config?.introStyle as string) ?? 'kinetic';

        let videoBuffer: Buffer;
        if (style === 'explainer') {
            // ⚠️ HF는 audioUrl 필수(hyperframes-adapter.ts:51,70). VO 없으면 빌더가 무음 트랙을 합성해
            //    audioUrl을 채운다(buildIntroHyperframesRequest의 책임). backgroundMusic은 별도.
            const req = buildIntroHyperframesRequest(config?.sceneContract, config);
            ({ videoBuffer } = await hyperframesAdapter.renderLongform(req));
        } else {
            // kinetic/glass/screencast → Remotion 인트로 어댑터 직접 호출
            ({ videoBuffer } = await remotionIntroAdapter.render(
                { sceneContract: config?.sceneContract, style, footageAssets: config?.footageAssets },
                context
            ));
        }

        // ⚠️ Codex: 실행엔진은 assets를 저장하지만 node output에 URL을 자동 주입하지 않음.
        //    media-video/countryball-video처럼 블록 내부에서 S3 저장 후 URL을 output에 넣어야 함.
        const urls = await persistIntroVideo(videoBuffer, context); // {url, previewUrl, downloadUrl}
        return {
            output: { mode: 'intro', style, video: { ...urls, format: 'mp4' } },
            durationMs: Date.now() - start,
            assets: [{ assetType: 'VIDEO', mimeType: 'video/mp4', data: videoBuffer }],
        };
    },
};
```

```ts
// intro-review-block.ts  (longform-review 패턴: 스타일·카피 확정 게이트)
export const introReviewBlock: BlockExecutor = {
    blockType: 'intro-review',
    async execute(input, config): Promise<BlockExecutorResult> {
        const start = Date.now();
        const base = toRecord(input);
        const reviewed = parseRecord(config?.reviewedOutput); // 사용자가 캔버스에서 수정한 카피/스타일
        const approved = hasExplicitApproval(config); // Gate
        const merged = reviewed ? { ...base, ...reviewed } : base;
        return {
            output: {
                ...merged,
                introStyle: firstString(config?.introStyle, merged.introStyle) ?? 'kinetic',
                reviewStatus: approved ? 'approved' : 'draft',
                mediaExecutionAllowed: approved, // ← execution-engine의 step-stop 가드가 읽음
            },
            durationMs: Date.now() - start,
        };
    },
};
```

```ts
// intro-brief-block.ts : LLM. brief → {hook, build[], payoff, tagline, suggestedStyle}
// intro-style-options-block.ts : LLM. 스타일 후보 3~4개(label/desc/preview) + recommendedChoice 생성
//   → 사용자 선택(selectedStyle). countryball-angle-lab과 동형(선택 checkpoint).
// intro-storyboard-block.ts : 선택 스타일+카피 → IntroSceneContract (비트 슬롯 배치, slam/logo/footage 컷)
// ※ BGM 비트정렬은 별도 노드 아님 — intro-render 내부에서 내부 BGM 라이브러리 선택 후 처리.
```

`block-registry.ts` 등록:

```ts
import {
    introBriefBlock,
    introStyleOptionsBlock,
    introStoryboardBlock,
    introReviewBlock,
    introRenderBlock,
} from './intro';
registry.set('intro-brief', introBriefBlock);
registry.set('intro-style-options', introStyleOptionsBlock);
registry.set('intro-storyboard', introStoryboardBlock);
registry.set('intro-review', introReviewBlock);
registry.set('intro-render', introRenderBlock);
```

---

## 5. 팩 + 레시피 — `apps/backend/src/modules/workflow-packs/intro-pack.ts`

```ts
import { contributionFor } from './catalog-helpers';
import type { WorkflowPackManifest } from './types';

const introBlockTypes = [
    'intro-brief',
    'intro-style-options',
    'intro-storyboard',
    'intro-review',
    'intro-render',
] as const;

export const introPack: WorkflowPackManifest = {
    packId: 'intro',
    kind: 'recipe',
    displayName: 'Intro / Promo',
    description: '제품 소개·프로모·오프닝 영상. 스타일 템플릿(키네틱 타이포·Liquid Glass 등)으로 렌더.',
    capabilities: ['intro.brief', 'intro.style-options', 'intro.storyboard', 'intro.review', 'intro.render'],
    blocks: introBlockTypes.map(contributionFor),
    recipes: [
        {
            recipeId: 'video.intro.v1',
            displayName: '소개 영상',
            description: '요청 → 카피·타이밍 구성 → 스타일 선택 → MP4. 키네틱/글래스/스크린캐스트.',
            triggerHints: [
                '소개 영상',
                '인트로',
                '오프닝',
                '로고 영상',
                '프로모',
                'promo',
                'teaser',
                '브랜드 영상',
                '애플처럼',
            ],
            outputType: 'video',
            requiredCapabilities: ['intro.brief', 'intro.storyboard', 'intro.review', 'intro.render'],
            defaultBlocks: introBlockTypes.map(blockType => ({
                blockType,
                label: contributionFor(blockType).orchestrator.label,
                ...(blockType === 'intro-render' ? { config: { introStyle: 'kinetic' } } : {}),
            })),
            defaultEdges: introBlockTypes.slice(1).map((_, i) => ({ from: i, to: i + 1 })),
            costPolicy: { estimatedCostUsd: 0.3, hardCapUsd: 1.5, requiresApproval: true }, // 잠정, 실측 후 확정
        },
    ],
};
```

`workflow-packs/index.ts` → `DEFAULT_WORKFLOW_PACKS`에 `introPack` 추가.

---

## 6. 비용 맵 — `openai-orchestrator.ts` `COST_ESTIMATES`

```ts
'intro-brief': 0.01,
'intro-storyboard': 0.02,
'intro-style-options': 0.02,  // LLM 스타일 후보 생성
'intro-review': 0,
'intro-render': 0.25,   // 잠정. Remotion Lambda/HF 렌더 컴퓨트(콜드스타트·업로드 포함). 실측 후 확정.
```

---

## 7. 오케스트레이터 라우팅 — `openai-orchestrator.ts`

1. `GENERIC_REQUEST_DECISION_SYSTEM_PROMPT`의 enum 확장:
   `"intent": "... | intro"`, `"recipeId": "... | video.intro.v1"`, 추가 필드 `"introStyle": "kinetic|glass|screencast|explainer|null"`.
   규칙: "소개/프로모/인트로/오프닝/로고 영상, 'X처럼 만들어줘'(애플 등)" → `video.intro.v1`. "애플처럼/심플/빠른"→kinetic, "글래스/투명/화려"→glass, "화면 보여주는/데모"→screencast.
2. `buildAiSelectedGenericWorkflow`에 분기 추가:
    ```ts
    if (decision.recipeId === 'video.intro.v1') {
      return buildWorkflowFromRecipe('video.intro.v1', userMessage, {
        summary: buildAiRecipeSummary(decision, '소개 영상을 스타일 템플릿으로 구성합니다.'),
        blockConfigOverrides: {
          'intro-brief': { topic: ..., requestUnderstanding: decision.understanding },
          'intro-render': { introStyle: decision.introStyle ?? 'kinetic' },
        },
      });
    }
    ```

---

## 8. 스타일 선택 UX (프론트)

`introStyle`은 기존 **proposal 패널의 "대본 톤" 칩 UX와 동일 메커니즘**으로 노출:

- 오케스트레이터가 요청에서 기본 스타일 추론 → proposal config에 `introStyle` 기본값.
- 패널에 칩: `① 키네틱 타이포 / ② Liquid Glass / ③ 스크린캐스트 / ④ 익스플레이너`. 사용자가 선택 → `intro-render.config.introStyle` 패치.
- 스타일 = **렌더 템플릿 id**(`intro/kinetic` 등). 파이프라인은 하나, 템플릿만 다름(DRY).

## 9. 체크포인트 / Gate / Resume 재사용

두 체크포인트, 모드로 제어:

- **`intro-style-options` = 1차 선택 체크포인트 = `countryball-angle-lab` 동형** (스타일 후보 선택). 쇼츠 앵글 선택과 같은 흐름.
- **`intro-review` = 2차 선택 체크포인트(옵션)** = `longform-review` 동형 (최종 카피·장면 승인). introMode에 따라만 정지.

**step-stop (execution-engine, 수정):**

- `isStepReviewStopNode`에 `'intro-style-options'`, `'intro-review'` 추가(멤버십).
- `shouldStopAtStepReviewNode` 분기 추가(없으면 기본 `return true`라 승인 후에도 멈춤 — Codex):
    - `if (blockType==='intro-style-options') return introMode!=='auto' && !hasSelectedIntroStyle(outputPayload);` (선택 전이면 정지)
    - `if (blockType==='intro-review') return shouldReviewIntro(introMode) && !isApprovedIntroReview(outputPayload);`

**resume (run-service — additive only):** `buildResumeSeedOutput`의 **countryball 분기는 한 글자도 안 건드린다.** intro 분기만 **추가**:

```ts
const bt = getBlockType(node);
if (bt === 'countryball-angle-lab') {
    /* 기존 그대로 — 변경 0 */ return countryballSeed;
}
if (bt === 'intro-style-options') {
    return buildIntroStyleSeed(node);
} // ← 신규 additive
return null;
```

> **⚠️ 동결 원칙(필수, 리팩터 금지):** **공유 추상화 추출 ❌, countryball 이관 ❌, countryball resume 일반화 ❌.** intro는 자기 전용 헬퍼(`isSelectedIntroStyleOutput`, `buildIntroStyleSeed`)와 전용 계약만 가지며 **countryball을 import/수정하지 않는다.** 공용 실행엔진 함수에는 **기존 분기를 바꾸지 않고 intro 분기만 additive로 추가**한다:
>
> ```ts
> if (blockType === 'countryball-angle-lab') return !isSelectedCountryballAngleOutput(output); // 그대로
> if (blockType === 'intro-style-options') return !isSelectedIntroStyleOutput(output); // 신규 additive
> ```
>
> 같은 식으로 `isStepReviewStopNode` 멤버십에 intro 타입만 OR 추가(기존 countryball/longform 동작 불변).

---

## 10. 스타일별 예상 비용 (1편, gpt-5.4-nano + HyperFrames 가정, 거친 추정)

> ⚠️ Codex 지적 반영: 초안의 렌더 $0.05/총 $0.08은 낙관. 렌더 컴퓨트(Remotion Lambda 콜드스타트+업로드+폰트/asset fetch, 또는 HF spawn)는 기존 `longform-render=0.5`/`media-video=0.2` 대역. 아래는 보수 재추정.

| 스타일             | LLM(brief+story) | 렌더       | 이미지             | VO(선택)    | **합계(추정)**  |
| ------------------ | ---------------- | ---------- | ------------------ | ----------- | --------------- |
| ① 키네틱 타이포    | $0.03            | $0.2~0.4   | $0                 | —           | **~$0.23~0.45** |
| ② Liquid Glass     | $0.03            | $0.2~0.4   | $0                 | —           | **~$0.23~0.45** |
| ③ 스크린캐스트     | $0.03            | $0.25~0.45 | $0(사용자 footage) | —           | **~$0.28~0.5**  |
| ④ 익스플레이너(HF) | $0.03            | $0.2~0.5   | +$0.04~0.49/장     | +$0.05~0.15 | **~$0.3~1.1**   |

참고: 기존 쇼츠 1편 = $0.772. 키네틱/글래스는 **이미지 생성이 없어** 여전히 쇼츠보다 쌀 수 있으나, 렌더 컴퓨트가 지배적 변수. recipe `costPolicy.estimatedCostUsd`는 **실측 후 확정**(초안 0.08 → 잠정 0.3), `hardCapUsd: 1.5`. intro-render `COST_ESTIMATES`도 0.05→**0.25(잠정)**로 상향.

---

## 11. 렌더러 현실 (코드 추적 결과 — 스펙의 핵심 제약)

`apps/backend/src/adapters/external/hyperframes-adapter.ts`를 추적한 사실:

- HF 어댑터는 **카드형 데이터-viz visualType만** 렌더: `event-timeline`, `comparison`, `quote-card`, `process-flow`, `metric-reveal`, `source-proof` + `fact-card`(unknown fallback 포함) (내부 `<div class="visual-*">` HTML 생성). **범용 HTML/GSAP 러너가 아님** — 키네틱 워드슬램·글래스칩·영상클립용 타입 없음.
- 입력 = `HyperframesRenderRequest { scenes[], subtitleCues[], motionCues[], audioUrl(필수 나레이션), backgroundMusic?(BGM ✅), outputWidth/Height, fps, quality }`. `spawn`으로 `hyperframes` CLI 실행(실연결, renderSuccessCount 41).
- ❌ **외부 비디오 클립 합성 없음** (scene 스키마에 클립 필드 없음) → **스크린캐스트·데모 footage 컷인 불가**.
- ❌ **키네틱 타이포·Liquid Glass용 visualType 없음** → 내 Apple식 룩은 현 어댑터로 직접 렌더 불가.
- ⚠️ `isLocalStage` 게이트는 **local asset URL만** prod에서 차단("local asset URLs disabled outside local/offline"); 일반 remote URL(S3 등)은 fetch됨. 단 HF prod 렌더 배선 완성 보증은 없음(마이그레이션 중).
- ✅ HF 프로젝트(`dev/ClaudeHyerframes`) 자체는 HTML/CSS/GSAP + glass(G1/G2/G3, **backdrop-filter 금지**, filter:blur 허용) + 결정성 강제 — 하지만 **eureka-flow 어댑터는 그 능력을 노출하지 않음**(6개 템플릿만).

### 결론: 스타일별 렌더 route 분기 (`intro-render`)

| 스타일              | 렌더러                                                    | 현재 가능?                                                                                          |
| ------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **④ 익스플레이너**  | **HF** (카드형 visualType 재사용)                         | 🔶 전용 intro HF 빌더 + `hyperframesAdapter` 직접 호출 필요(mediaVideoBlock 경유 불가). 카드형 한정 |
| **① 키네틱 타이포** | **Remotion 인트로 route**(내가 만든 코드 = 렌더 서비스화) | 🔶 Remotion 어댑터 신설 필요                                                                        |
| **② Liquid Glass**  | Remotion 인트로 route (backdrop-filter 사용 가능)         | 🔶 동상                                                                                             |
| **③ 스크린캐스트**  | Remotion(OffthreadVideo 클립 합성)                        | 🔶 동상 (HF는 영상 합성 불가, Remotion은 네이티브)                                                  |

→ 즉 **HF=익스플레이너 전용, 키네틱/글래스/스크린캐스트=Remotion 인트로 렌더**. HF에 키네틱/글래스를 넣으려면 HF CLI에 신규 visualType 템플릿 + 프로덕션 배선이 필요(별도 과제). **Remotion이 이 Apple식 인트로엔 더 맞음**(영상 합성·CSS 글래스 네이티브). 단 Remotion 상용 라이선스 고려.

### 갱신 출시 순서

1. **v1: ④ 익스플레이너** — HF 카드형 재사용. 단 "코드 거의 없음"은 아님: 전용 intro→HF request 빌더(`buildIntroHyperframesRequest`) + 레시피/블록 wiring + §12 등록지점들 필요. 로컬 한정 캐비엇.
2. **v1.5: ① 키네틱** — Remotion 인트로 렌더 어댑터(`rendererRoute:'remotion-intro'`) 신설 + intro-render route 분기.
3. **v2: ② 글래스 / ③ 스크린캐스트** — 같은 Remotion route 확장.

- 프로덕션 렌더 배포(Remotion Lambda or HF prod)는 별도 인프라 과제로 분리.

---

## 12. 파일 체크리스트

신규:

- `blocks/intro/intro-scene-contract.ts`, `intro-brief-block.ts`, `intro-style-options-block.ts`, `intro-storyboard-block.ts`, `intro-review-block.ts`, `intro-render-block.ts`, `build-intro-hf-request.ts`, `persist-intro-video.ts`, `index.ts`
- `workflow-packs/intro-pack.ts`
- spec(이 문서)

수정(additive):

- `blocks/types.ts`(BLOCK_TYPES), `orchestrator/response-parser.ts`(ALLOWED_BLOCK_TYPES)
- `workflow-packs/orchestrator-block-catalog.ts`(capability+catalog), `http-block-catalog.ts`(BLOCK_CATALOG), `index.ts`(pack 등록)
- `blocks/block-registry.ts`(register)
- `orchestrator/openai-orchestrator.ts`(COST_ESTIMATES + **generic decision prompt/schema에 intro intent+`video.intro.v1` recipeId** + 빌더 분기)
- `services/execution-engine.ts`(**isStepReviewStopNode 멤버십 + shouldStopAtStepReviewNode 승인분기** + **render timeout 분기에 intro-render 추가**)
- `services/run-service.ts`(**provider preflight map에 intro-\* 추가** + **buildResumeSeedOutput를 intro-review까지 확장**)
- `apps/web/.../pages/run-mode.ts`(**reviewKind에 'intro' 추가** + 버튼/안내 카피)
- 신설 어댑터: `adapters/external/remotion-intro-adapter.ts` + intro→HF request 빌더 `buildIntroHyperframesRequest`

테스트(기존 패턴):

- `intro-storyboard-block.spec.ts`(카피→SceneContract, zod 통과), `registry.spec.ts`(video.intro.v1 등록), `run-service.spec.ts`(intro-review resume), `execution-engine.spec.ts`(intro-review step-stop)

경계 확인: `content-block/media-*-block`에 intro/introStyle 로직 0건(기존 rg 가드와 동일 규율).

```

---

## 13. v1 기본값 · 구현 우선순위 · 워크드 예시

### v1 기본값 (고정)
- **`introMode = 'interactive'`** — `intro-style-options`에서만 정지. **`intro-review`는 기본 off**(사용자가 "최종 검수도 할래" 켤 때만 정지).
- 성공 기준: **"스타일 하나 고르면 영상이 나온다"**. 사용자는 렌더러/BGM sync/HF/Remotion을 모른 채 "느낌"만 고른다.

### 구현 우선순위 (additive only — **리팩터 금지, 작동 중 플로우 동결**)
1. **baseline 확인** — 현재 countryball/shorts 기준 테스트 먼저 실행해 green 확인(건드리기 전 기준선).
2. **intro 타입/카탈로그/팩만 추가** — `BLOCK_TYPES`/`ALLOWED_BLOCK_TYPES`/catalog/pack/index에 intro만 OR-추가(기존 항목 불변).
3. **intro-style-options용 step-stop/resume 분기 별도 추가** — 기존 countryball 분기 그대로, intro 분기만 additive(§9).
4. **countryball-angle-lab 로직은 0 수정.**
5. **intro 블록 추가** — `intro-brief`(락인#3) / `intro-style-options`(락인#1: 전용 계약) / `intro-storyboard`(결정성) / `intro-review`(락인#2: 기본 off=pass-through) / `intro-render`.
6. **intro-render 전용 진입** — explainer=HF builder, kinetic/glass/screencast=Remotion 어댑터 **직접** 호출(§4).
7. **회귀 테스트**(아래 성공기준).

### 성공 기준 (이걸로 PASS 판정)
- ✅ 기존 **countryball/shorts 테스트 green** (특히 angle 선택 후 `countryball-writer-brain`으로 이어짐, 일반 쇼츠가 기존 pack으로 감)
- ✅ **intro 신규 플로우 green** (intro만 `video.intro.v1`로, style 선택→storyboard→render)
- ✅ **일반 `content-block`/`media-video-block`에 intro 분기 0건** (rg 가드)
- ✅ **intro가 countryball 계약 import 0건** (rg 가드)

> 우회 아님 — **작동 중 플로우를 보호하는 안정적 신규 플로우 추가**. 공용 실행엔진 등록만 불가피하나, 전부 기존 분기 불변 + intro 분기 additive.

### 워크드 예시 — "한성대 AI 캡스톤 소개 영상"
입력:
> "한성대학교에서 이번에 AI 캡스톤을 하는데 소개 영상 만들어줘. 한성대, AI 캡스톤, 6/5 낙산관, 기업과 함께 AI 기술들을 합쳐 선보이는 전시회."

흐름:
1. `POST /messages` → `classifyMessageIntent`='proposal'(만들어줘) → `generateProposal` recipeId=`video.intro.v1`, introMode='interactive', 추천 introStyle(키워드 없음 → 전시 티저라 'kinetic' 추천). 캔버스에 5노드 + `proposal.created`.
2. 승인 → `POST /runs {executionMode:'step'}`.
3. **`intro-brief`** 실행 — 요청에서 사실/카피 추출:
   - facts: `{org:'한성대학교', event:'AI 캡스톤', date:'6/5', venue:'낙산관', concept:'기업과 함께 AI 기술을 합쳐 선보이는 전시회'}`
   - copy: hook `"AI가, 한자리에."` / build `["한성대 AI 캡스톤","기업과 함께","AI 기술이 모이다"]` / payoff `"6.5 · 낙산관."` / tagline `"한성대학교 AI 캡스톤 전시회"`
4. **`intro-style-options`** 실행 — 후보 4개(키네틱/글래스/스크린캐스트/익스플레이너)+미리보기+추천(키네틱) 생성 → **step 정지**(selectedStyle 없음). `run.completed{stoppedForReview, reviewNodeId=<intro-style-options>}`.
5. **사용자: 스타일 카드 4개 중 선택** (예: ② Liquid Glass) → `config.selectedStyle='glass'` 패치.
6. `POST /runs {resumeFromNodeId:<intro-style-options>}` → `buildResumeSeedOutput`의 **intro 전용 분기**(`buildIntroStyleSeed`)가 그 노드를 `selectedStyle='glass'`로 COMPLETED seed → 상류(brief) 재실행 X. (countryball 분기 불변)
7. **`intro-storyboard`** — copy+glass → `IntroSceneContract`: 글래스 Spotlight 바("한성대 AI 캡스톤"), 글래스 fact-chip(6/5·낙산관·기업협업), 슬램 `"6.5 · 낙산관."`, 로고 `"한성대학교 AI 캡스톤 전시회"`. cuts.fromFrame 정수 확정. (intro-review off → 정지 없음)
8. **`intro-render`** — style=glass → `remotionIntroAdapter.render(contract,'glass')`. 내부 BGM 자동선택+비트정렬. → MP4 → S3 저장 → `output.video.url`.
9. `asset.created(VIDEO)` + `run.completed`. **사용자: 완성 영상 미리보기/다운로드.**
10. 다른 느낌으로 → selectedStyle 변경 후 6번부터. (glass↔kinetic은 컷종류가 달라 contract 변경 → `intro-storyboard`부터 재생성. kinetic↔kinetic류 호환이면 render만.)

> 사용자 체감: "소개 영상 만들어줘 → 스타일 카드 4개 중 하나 클릭 → 잠시 후 완성." 내부(브리프/스토리보드/BGM/렌더러)는 안 보임.

---

## 14. 모델 책임 / 품질 출처 (중요 — "nano로 저 퀄이 나오나?" 해소)

**핵심 오해 정정: 모션그래픽 비주얼은 LLM(nano)이 만들지 않는다.** 내가 만든 영상의 퀄리티는 **손으로 짠 렌더 템플릿 코드(Remotion React/CSS/GSAP — 레터박스·폰트·이징·글래스·셔머)**에서 나왔지, 어떤 LLM이나 이미지모델이 그린 게 아니다.

| 단계 | 담당 | 품질 좌우 |
|---|---|---|
| 의도분류·레시피·스타일추천·**카피**(hook/build/payoff/tagline) | **LLM `gpt-5.4-nano`**(env `OPENAI_ORCHESTRATOR_MODEL`로 교체 가능) | 카피의 말맛·사실추출 |
| **프레임 타이밍·비트싱크**(cuts[].fromFrame/durFrames) | **결정성 코드**(numpy 비트분석 + 레이아웃) — LLM 아님 | 코드가 보장 |
| **비주얼 크래프트**(글래스·키네틱·모션·폰트) | **렌더 템플릿 코드**(Remotion/HF) — 한 번 만들면 고정 | **여기서 100% 결정** |
| 이미지 생성 | 키네틱/글래스는 **0장**(CSS/텍스트). 익스플레이너만 선택적 `gpt-image-2`/`nano-banana` | — |

**결론:**
- **비주얼 천장 = 팀이 한 번 만드는 템플릿 품질.** 매 렌더가 그걸 그대로 상속 → 어떤 LLM을 쓰든 비주얼은 동일하게 고품질. nano여도 내가 보여준 퀄리티 **재현 가능**(코드라서).
- **nano가 영향을 주는 곳 = 카피 말맛 + 사실추출뿐.** nano-tier라 카피가 다소 밋밋할 수 있음 → 완화책: (a)카피는 짧고 zod 검증+재시도, (b)사용자가 style/review 체크포인트에서 수정 가능, (c)`OPENAI_ORCHESTRATOR_MODEL` 한 줄로 상위 모델 교체.
- **타이밍은 LLM에 안 맡김(결정성 코드).** → HF/Remotion의 `Math.random`/`Date.now` 금지 규칙도 자동 충족, nano 품질과 무관.

> 한 줄: **nano는 "무슨 말을 넣을지"만 정하고, "어떻게 멋지게 보일지"는 템플릿 코드가 정한다.** 그래서 저 퀄리티는 nano로도 나온다 — 정확히는 nano와 **무관하게** 템플릿이 만든다.
```
