# KW-all Agentic Expansion — 구현 계획

> 날짜: 2026-04-09
> 기반: KW-all/main (← KW-backend/main)
> 설계 문서: `2026-04-09-kw-all-agentic-expansion-design.md`

---

## Phase 로드맵

```
P5A: shorts-pack 분리 (현재 코드 → domain pack 구조로 이동)
P5B: generic block definition + dynamic catalog
P5C: prompt-agent-executor (프롬프트형 블록 실행기)
P5D: planner v2 orchestrator (카탈로그 기반 동적 DAG 생성)
P5E: missing block → prompt-agent 블록 자동 생성 + 승인
P5F: generic deliverable/output 일반화
P5G: 프론트 UX 통합
```

---

## P5A: shorts-pack 분리

**목표:** 쇼츠 전용 코드를 domain-pack으로 이동. 코어는 도메인 무관하게.

### 파일 이동

```
FROM                                          → TO
modules/blocks/search-block.ts                → modules/domain-packs/shorts-pack/blocks/search.ts
modules/blocks/content-block.ts               → modules/domain-packs/shorts-pack/blocks/content.ts
modules/blocks/data-block.ts                  → modules/domain-packs/shorts-pack/blocks/data.ts
modules/blocks/analysis-block.ts              → modules/domain-packs/shorts-pack/blocks/analysis.ts
modules/blocks/media-image-block.ts           → modules/domain-packs/shorts-pack/blocks/media-image.ts
modules/blocks/media-tts-block.ts             → modules/domain-packs/shorts-pack/blocks/media-tts.ts
modules/blocks/media-video-block.ts           → modules/domain-packs/shorts-pack/blocks/media-video.ts
modules/blocks/integration-block.ts           → modules/domain-packs/shorts-pack/blocks/integration.ts
modules/orchestrator/prompt-templates.ts      → modules/domain-packs/shorts-pack/prompts/orchestrator.ts
modules/orchestrator/mock-orchestrator.ts     → modules/domain-packs/shorts-pack/mock-proposal.ts
```

### 신규 파일

```
modules/domain-packs/shorts-pack/
  manifest.ts              # pack metadata: name, blocks[], templates[]
  index.ts                 # registerShortsPack(registry) 함수
  templates/
    shorts-8step.json      # 8블록 DAG 템플릿
```

### 변경

```
modules/blocks/types.ts        → BLOCK_TYPES enum 삭제, BlockType = string으로 변경
modules/blocks/block-registry.ts → 동적 등록 (enum 의존 제거)
handlers/http/blocks/list-blocks.ts → registry에서 동적 목록 반환 (하드코딩 제거)
```

### 완료 기준

- shorts-pack 설치/해제가 가능한 구조
- 기존 E2E 테스트 동일하게 통과
- list-blocks가 registry에서 동적으로 반환

---

## P5B: Generic Block Definition + Dynamic Catalog

**목표:** 블록을 DB에 저장/조회 가능하게. 고정 enum 대신 동적 카탈로그.

### 신규 파일

```
libs/contracts/src/http/block-definitions.schema.ts
  → BlockDefinitionSchema (id, type, name, executionMode, systemPrompt, model, ...)
  → BlockDefinitionCreateRequest/Response
  → BlockDefinitionListResponse

apps/backend/src/repositories/block-definition-repository.ts
  → DynamoDB/memDb에 블록 정의 저장

apps/backend/src/services/block-catalog-service.ts
  → listAvailable(), getByType(), register(), unregister()
  → domain-pack loader: loadPack(packName) → bulk register

apps/backend/src/handlers/http/blocks/
  → list-blocks.ts 수정: catalog service에서 조회
  → get-block.ts 신규: GET /blocks/{type}
```

### DynamoDB 테이블 추가 (보정 #1 — 버전 보존 가능한 키)

```yaml
BlockDefinitionsTable:
    PK: type (S)
    SK: version (S)          # "1.0.0", "1.1.0" — 같은 type의 여러 버전 공존
    GSI1: category-index
        PK: category (S)
        SK: createdAt (S)
    GSI2: latest-index       # 최신 버전만 빠르게 조회
        PK: type (S)
        SK: isLatest (S)     # "true" 고정값 — sparse index
```

**조회 패턴:**

- 특정 type의 latest → `GSI2: PK=type, SK="true"`
- 특정 type의 모든 버전 → `PK=type` (version으로 정렬)
- 카테고리별 목록 → `GSI1: PK=category`
- 블록 카탈로그 (latest만) → `GSI2 scan where isLatest="true"`

### 완료 기준

- 블록 정의가 DB에 저장됨
- shorts-pack 설치 시 8개 블록 정의가 DB에 등록
- list-blocks가 DB에서 조회
- 새 블록 정의를 API로 등록 가능

---

## P5C: Prompt Agent Executor

**목표:** systemPrompt + model만으로 실행 가능한 범용 블록 실행기.

### 신규 파일

```
apps/backend/src/modules/blocks/prompt-agent-executor.ts
```

### 로직 (보정 #3 — input binding 포함)

```typescript
export const promptAgentExecutor = {
    async execute(definition: BlockDefinition, input: unknown): Promise<BlockExecutorResult> {
        // 1. inputSchema로 upstream output 검증 (PortableSchema → zod 변환)
        // 2. promptTemplate에 input/config binding 적용
        //    - {{input.topic}} → upstream output의 topic 필드
        //    - {{input.keywords | join(", ")}} → 배열 조인
        //    - {{config.tone}} → block config 값
        //    - 바인딩 실패 → "[missing: fieldName]" + trace 경고
        // 3. systemPrompt + 바인딩된 user message → Claude API 호출
        //    - allowedModels 검증: 허용된 모델만 사용
        //    - requiredSecrets 검증: 허용된 secret만 조회
        //    - costBudget 검증: maxTokens 상한 적용
        // 4. response를 outputFormat에 맞게 파싱 (json → JSON.parse, text → raw)
        // 5. outputSchema로 zod validation (PortableSchema → zod)
        // 6. 실패 시 FAILED + trace ERROR
        // 7. 성공 시 output + trace TOOL_RESULT 반환
    },
};
```

### 신규 유틸

```
apps/backend/src/utils/
  portable-schema.ts         # portableSchemaToZod(), validateWithPortableSchema()
  prompt-template.ts         # bindPromptTemplate(template, input, config)
```

````

### block-executor.ts 변경

```typescript
// 현재: registry에서 builtin executor만 찾음
// 변경: registry 미스 시 → BlockDefinitionsTable에서 조회 → prompt-agent-executor 실행

async execute(blockType: string, input: unknown) {
  // 1. builtin registry 확인
  const builtin = blockRegistry.get(blockType);
  if (builtin) return builtin.execute(input);

  // 2. DB에서 block definition 조회
  const definition = await blockDefRepo.getByType(blockType);
  if (!definition) throw new Error(`Unknown block: ${blockType}`);

  // 3. executionMode에 따라 실행
  if (definition.executionMode === 'prompt-agent') {
    return promptAgentExecutor.execute(definition, input);
  }

  throw new Error(`Unsupported execution mode: ${definition.executionMode}`);
}
````

### 완료 기준

- prompt-agent 블록이 systemPrompt + model로 실행됨
- output이 zod schema로 검증됨
- trace에 model, tokens, latency 기록됨
- 기존 builtin 블록은 영향 없음

---

## P5D: Planner v2 Orchestrator

**목표:** 고정 DAG 생성기 → 카탈로그 기반 동적 플래너.

### 변경 파일

```
modules/orchestrator/
  claude-orchestrator.ts → planner-orchestrator.ts (이름 변경 + 로직 확장)
  prompt-templates.ts → planner-prompts.ts (범용 프롬프트)
```

### Planner v2 로직

```
1. Block Catalog 전체 조회 → 사용 가능한 블록 목록
2. 사용자 요청 + 블록 목록 → Claude에게 전달
3. Claude: "이 블록들로 workflow 설계해. 부족하면 새 블록 정의도 포함해"
4. 응답 파싱:
   {
     existingBlocks: [{ type, config }],
     newBlocks: [{ type, name, systemPrompt, model, ... }],  // 새 블록 정의!
     edges: [...],
     summary: "..."
   }
5. Proposal 생성:
   - proposedNodes: existing + new
   - proposedNewBlockDefinitions: [...]  // 새 필드
```

### Planner 시스템 프롬프트 (범용)

```
You are a workflow planner for an AI automation platform.

Available blocks:
{catalog_json}

User request: {user_message}

Design a workflow using available blocks.
If a capability is missing, define a new prompt-agent block.

Return JSON:
{
  "blocks": [
    { "type": "search", "isExisting": true },
    { "type": "writer-agent", "isExisting": false,
      "definition": { "name": "...", "systemPrompt": "...", "model": "...", ... } }
  ],
  "edges": [...],
  "estimatedCostUsd": ...,
  "summary": "..."
}
```

### 완료 기준

- 카탈로그 기반 동적 블록 선택
- 부족한 블록 → 새 정의 생성
- proposal에 새 블록 정의 포함

---

## P5E: Block Proposal Approval + Versioning

**목표:** 새 블록 정의를 승인 후 카탈로그에 설치.

### 변경

```
services/proposal-service.ts
  → approve 시: proposedNewBlockDefinitions가 있으면 BlockDefinitionsTable에 저장
  → 새 블록 status: approved
  → 카탈로그에 즉시 등록
```

### 신규 엔드포인트

```
GET /blocks/definitions          — 모든 블록 정의 (builtin + user-created)
GET /blocks/definitions/{type}   — 단일 블록 정의 상세
DELETE /blocks/definitions/{type} — 사용자 생성 블록 삭제 (builtin 삭제 불가)
```

### 버전 관리

- 동일 type 재생성 시 version 증가 (1.0.0 → 1.1.0)
- 이전 버전은 보존 (run snapshot에서 참조)

### 완료 기준

- 승인 시 새 블록이 카탈로그에 등록
- 다음 요청에서 해당 블록 사용 가능
- 버전 관리 동작

---

## P5F: Generic Deliverable

**목표:** 쇼츠 전용 IntegrationOutput → 범용 GenericDeliverable.

### 변경 (보정 #4 — engine 밖으로 조립 분리)

```
신규:
  apps/backend/src/services/deliverable-composer.ts
    → run 완료 후 호출
    → node outputs + assets 수집 → GenericDeliverable 조립
    → domain-pack composer가 있으면 위임 (shorts-pack → ShortsDeliverable)

변경:
  execution-engine.ts
    → run 완료 시 deliverableComposer.compose(runId) 호출
    → engine 자체는 raw data만 저장, 조립 로직 없음

  modules/domain-packs/shorts-pack/
    → composer.ts 추가: shortsComposer(outputs, assets) → ShortsDeliverable

삭제:
  modules/blocks/types.ts → IntegrationOutputSchema (shorts-pack으로 이동)
```

### Deliverable Composer 구조

```typescript
// 기본 composer (domain-pack 없을 때)
interface GenericDeliverable {
    summary: string;
    outputs: Record<nodeId, unknown>;
    artifacts: Array<{ type; url; label; mimeType; metadata }>;
    metadata: { domainPack?; totalCost?; blockCount; completedAt };
}

// domain-pack composer interface
interface DeliverableComposer {
    compose(outputs: Record<string, unknown>, assets: Asset[]): GenericDeliverable;
}

// shorts-pack composer는 ShortsDeliverable 반환 (GenericDeliverable 확장)
```

### 완료 기준

- execution-engine이 deliverable 조립 로직을 갖지 않음
- deliverable-composer가 별도 서비스로 존재
- domain-pack이 자체 composer 제공 가능
- pack 없으면 기본 composer가 outputs + artifacts 나열
- 프론트가 범용 결과 렌더링 가능

---

## P5G: 프론트 UX 통합

**목표:** 새 블록 생성/승인 UX + 범용 결과 렌더링.

### 프론트 변경 범위

```
apps/web/src/app/features/
  agent/
    ChatPanel.tsx          → 새 블록 제안 카드 표시
    PreflightCard.tsx      → "🆕 새 에이전트 블록" 배지 + 승인 UI
  flows/
    components/
      BlockCatalog.tsx     → 동적 카탈로그 (API에서 조회)
      NodeBlock.tsx        → prompt-agent 블록 표시 (아이콘 구분)
      ResultPanel.tsx      → GenericDeliverable 렌더링
```

### 완료 기준

- 채팅에서 새 블록 제안 시 UI에 표시
- 승인 버튼 → 블록 등록 + 캔버스 배치
- 동적 블록 카탈로그 표시
- 범용 결과 렌더링

---

## 마이그레이션 전략

### 하위 호환 유지

모든 phase에서:

1. 기존 mock mode 테스트 통과
2. shorts-pack이 설치된 상태 = 현재 동작과 동일
3. compat API 유지

### 단계별 검증

```
P5A 후: shorts-pack 분리 + 기존 E2E 통과
P5B 후: 동적 카탈로그 + shorts-pack 자동 등록 + E2E 통과
P5C 후: 프롬프트형 블록 수동 등록 → 실행 성공
P5D 후: "블로그 글 만들어줘" → 새 블록 포함 proposal 생성
P5E 후: 승인 → 블록 설치 → 재실행 성공
P5F 후: GenericDeliverable로 모든 결과 반환
P5G 후: 프론트에서 전체 흐름 동작
```

---

## 타임라인 추정

| Phase    | 예상       | 의존성          |
| -------- | ---------- | --------------- |
| P5A      | 1일        | 없음            |
| P5B      | 1일        | P5A             |
| P5C      | 0.5일      | P5B             |
| P5D      | 1일        | P5B + P5C       |
| P5E      | 0.5일      | P5D             |
| P5F      | 0.5일      | P5A             |
| P5G      | 2일        | P5D + P5E + P5F |
| **합계** | **~6.5일** |                 |
