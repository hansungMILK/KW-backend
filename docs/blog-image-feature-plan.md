# Plan: 블로그 작성기(네이버 복붙 완성형) + 이미지 생성(N≤12) — eureka-flow

> 목표(정정): ① **네이버 블로그에 바로 복붙 가능한 완성형 글** — 앱 출력이 실제 블로그처럼 보이고, 이미지가 본문 흐름의 자연스러운 위치에 삽입. ② **단독 이미지 생성 N장(최대 12)**, 다중 주제·옵션 지원.
> 원칙: additive(기존 쇼츠/컨트리볼/롱폼 동결), 기존 recipe 라우팅 재사용. **Markdown만 던지는 블로그 출력 = 실패.**

## 0. 현재 상태 (코드 확인 — 둘 다 이미 존재하나 빈약)

- **블로그 `text.blog.v1`** (`text-pack.ts`): `content(blog-article)` + `output-preview(markdown)`. → **단일 블록 한 방 + 마크다운 출력** = 목표(네이버 복붙 완성형) 미달.
- **이미지 `image.single.v1`** (`media-pack.ts`): `content(single-image, scenes:1)` + `media-image(count:1)`. `detectRequestedSceneCount`(cap 24)가 "N장" 파싱하나 content가 scenes:1 고정 → 불일치. 다중주제·옵션 없음.
- 라우팅: `GENERIC_REQUEST_DECISION` recipeId enum(하드코딩) + `buildAiSelectedGenericWorkflow` 분기.

## 1. 블로그 자동화 업계 플로우 (서치)

5계층: 리서치→브리프→**아웃라인(H1+H2 8~10+H3)**→**섹션별 초안**→품질게이트(팩트·EEAT)→SEO/AEO. 핵심: 아웃라인-퍼스트 + 섹션 드래프팅 + 근거기반(환각 금지). 한 방 생성 ❌.

## 2. 블로그 v2 — "네이버 복붙 완성형" (정정된 핵심 설계)

**왜 마크다운 조립이 부족한가:** 네이버 블로그는 마크다운 에디터가 아니다. 사용자가 원하는 경험 = (a) 앱 안에서 네이버 블로그처럼 보임, (b) 이미지가 "이 문단 다음" 자연스러운 위치, (c) 복사 버튼→네이버 에디터 붙여넣기 시 구조 유지, (d) alt/caption 정리, (e) 이미지 파일 다운로드.

### 플로우 (신규 `blog` pack, additive — 컨트리볼/intro처럼 격리)

```
blog-brief          키워드·독자·인텐트·각도
blog-research       (사실형) 근거 수집 — 기존 search 재사용
blog-outline        H1 + H2 8~10 + H3 + 섹션 분량   ← 선택 체크포인트(사용자 목차 편집)
blog-draft          아웃라인 기반 섹션별 작성(근거 인용, 환각 금지)
blog-image-plan ★   이미지 슬롯(위치·역할·캡션) 설계 — "개수"가 아니라 "위치 계약"
blog-images         슬롯대로 이미지 생성 — media-image 재사용 (이미지 포함 토글 시)
blog-seo            메타 title/desc, 키워드, 구조/스키마, AEO 요약
blog-assemble       섹션 본문 + 이미지 슬롯 결합 → 구조화 문서(JSON, 마크다운 아님)
blog-render-preview ★ 네이버 블로그형 미리보기(제목/대표이미지/소제목/본문/이미지/캡션/강조박스)
blog-export     ★   4종 출력(아래)
```

DAG: `blog-brief → blog-research → blog-outline(⏸) → blog-draft → blog-image-plan → blog-images → blog-seo → blog-assemble → blog-render-preview → blog-export`

### ★ blog-image-plan — 위치 계약(개수 아님)

이미지를 "본문 6장"으로 만들면 안 됨. 각 이미지는 **본문 내 역할+위치**가 먼저:

```json
{
    "imageSlots": [
        {
            "slotId": "hero",
            "placement": "afterTitle",
            "purpose": "글 첫인상 대표 이미지",
            "promptSource": "전체 글 요약",
            "caption": "한눈에 보는 한국 새벽배송의 속도감"
        },
        {
            "slotId": "section-2-1",
            "placement": "afterSectionHeading",
            "sectionId": "h2-2",
            "purpose": "새벽 문 앞 배송 장면 시각화",
            "caption": "밤에 주문한 상품이 아침 전에 도착하는 장면"
        }
    ]
}
```

→ blog-images는 각 슬롯 `promptSource`로 생성, caption/alt 동반. blog-assemble이 `placement`/`sectionId` 따라 본문 정확한 위치에 끼움. (이미지 포함은 토글 — "이미지도 넣어줘"면 on, 기본 추천.)

### ★ 출력단 4종 (blog-export) — 이게 핵심, 빠지면 실패

1. **Naver-like Preview** — 앱 내 네이버 블로그처럼(제목·대표이미지·소제목·본문·이미지·캡션·강조박스). 주 사용자 화면.
2. **Copy Rich Text** — 네이버 에디터 붙여넣기용 **클립보드 `text/html` + `text/plain` 둘 다** 세팅(제목/소제목/문단/이미지 순서 보존 목표).
3. **Markdown** — 백업/개발자용. **주출력으로 쓰면 안 됨.**
4. **Image Package** — 생성 이미지 다운로드(zip) — 네이버에서 외부 이미지가 깨질 때 수동 업로드용 + 삽입 가이드.

### 현실 + 완료 기준 (정직)

"네이버 바로 복붙"은 **100% 코드 보장 불가** — 네이버 에디터가 외부 이미지 URL/HTML 스타일/캡션을 얼마나 보존하는지는 **실제 붙여넣기 테스트** 필요. 그래서 수용 기준:

- ✅ 앱 미리보기가 블로그처럼 보임
- ✅ 복사 버튼 → 네이버 에디터 붙여넣기 시 **제목/소제목/문단/이미지 순서 유지**
- ✅ 이미지 안 붙을 때 대비 **다운로드 + 수동 삽입 가이드**
- ❌ **Markdown만 던지는 출력 = 실패**
- → **실제 네이버 수동 붙여넣기 테스트가 최종 수용 게이트**(코드 자동검증으로 못 잡음)

원칙: 환각 금지(FactSchema{source} 재사용), blog-outline 선택 체크포인트(angle-lab/intro 패턴 — 일반화 말고 전용 분기), 전부 additive.

> **블로그 v2 + 이미지 삽입 + 출력단은 기능적으로 분리 금지.** 사용자에겐 "네이버 블로그 글 써줘, 이미지도 넣어줘" = **한 기능**. 내부 구현만 단계적.

## 3. 단독 이미지 생성 N장(≤12) — 제품 설계

신규/확장 recipe `image.gen.v1`(single.v1은 N=1 케이스로 흡수).

- **파싱**: count(`detectRequestedSceneCount`, 이 recipe **cap 12**) + 다중 주제("63빌딩, 에펠타워" → 2주제).
- **분배 규칙**: 명시 count 우선. "63빌딩, 에펠타워 두장" → 2장(각 1). "에펠타워 4장" → 같은 주제 4변형. count<주제수면 주제 우선.
- **content(image-prompt 모드)가 N프롬프트 생성**(scenes:1 고정 제거) → **media-image count=N(cap 12)**.
- **옵션(선택으로 — proposal 칩/필드, 대본톤 칩 패턴; AI 자동추론+오버라이드):**
    - 장수 1–12 / 스타일(사진·일러스트·3D·시네마틱·아네메·수채화·로고) / 비율(1:1·16:9·9:16·4:3, media-image 사이즈 매핑 기존) / 참조이미지(input-image) / N주제×1 vs 1주제×N변형
- **비용**: gpt-image-2 ~$0.04/장 → 12장 ~$0.5. cap 12 + `checkRunCostLimit` + proposal 예상비용(기존 이미지설정 패턴).

## 4. 코드 변경 (전부 additive, 기존 동결)

- **이미지(작은 변경, 빠른 승):** image 분기에서 content `scenes = count ?? #subjects ?? 1`(1 고정 제거), media-image `count` 동일, recipe cap 12. 옵션(style/aspect/refAsset/count) → recipe config + proposal plumbing. enum/triggerHints 다중장 의도.
- **블로그(큰 변경):** 신규 `blog` pack + 블록 `blog-brief/research/outline/draft/image-plan/images/seo/assemble/render-preview/export`. recipe `text.blog.v2`. orchestrator enum/builder 분기. outline 체크포인트(전용 분기). **프론트: Naver-like preview 렌더 + Copy(rich text clipboard) + Image zip 다운로드 UI** (web 신규, 일반 컴포넌트 미접촉).
- 불변식: BLOCK_TYPES⟺ALLOWED⟺등록팩 일치 → 신규 블록 타입/카탈로그/팩/registry 동시(intro 2A 교훈).

## 5. 단계적 출시 (구현 순서)

1. **이미지 N≤12 단독 기능** (작은 변경, 빠른 승 — "63빌딩,에펠타워 두장" 동작)
2. **블로그 v2 본문 생성** (brief→research→outline⏸→draft→seo→assemble)
3. **블로그 이미지 삽입 설계** (blog-image-plan + blog-images, 슬롯 위치 계약)
4. **네이버 블로그형 preview/export** (blog-render-preview + blog-export 4종)
5. **실제 네이버 붙여넣기 수동 테스트** (수용 게이트)
    > 2~4는 사용자에겐 한 기능 — 내부 단계일 뿐. 4 없이는 "블로그 생성"은 되지만 "네이버 복붙 완성형"은 아님.

각 단계 후: 기존 쇼츠/컨트리볼/롱폼 테스트 green + 신규 green + 경계 가드(일반 블록 침투 0).

---

출처(서치):

- [MediaJunction — AI SEO content workflow](https://www.mediajunction.com/blog/ai-for-seo-content-a-step-by-step-workflow)
- [ClientCues — SEO posts via AI workflows](https://www.clientcues.com/company/blog/posts/how-i-generated-10-seo-blog-posts-in-one-afternoon-using-ai-workflows/)
- [Metaflow — AI content pipelines](https://metaflow.life/blog/ai-content-pipelines)
- [Ideogram — Batch generation](https://docs.ideogram.ai/using-ideogram/features-and-tools/batch-generation)
- [xAI — Image generation (batch/aspect)](https://docs.x.ai/developers/model-capabilities/images/generation)
