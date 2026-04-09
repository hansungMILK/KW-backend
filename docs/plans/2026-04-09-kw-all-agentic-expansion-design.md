# KW-all Agentic Expansion — 설계 문서

> 날짜: 2026-04-09
> 기반 브랜치: KW-backend/main → KW-all/main
> 목표: 쇼츠 전용 백엔드를 범용 에이전트 오케스트레이션 플랫폼으로 확장

---

## 1. 현재 구조 진단

### 1.1 무엇이 범용 코어인가 (유지)

| 파일/모듈                    | 분류    | 이유                                     |
| ---------------------------- | ------- | ---------------------------------------- |
| execution-engine.ts          | GENERIC | DAG toposort + wave 실행, 블록 타입 모름 |
| run-service.ts               | GENERIC | snapshot, cancel, retry — 도메인 무관    |
| block-registry.ts            | GENERIC | Map<type, executor> 패턴                 |
| response-parser.ts           | GENERIC | zod 기반 JSON 파싱, 스키마 유연          |
| queue adapter                | GENERIC | SQS 추상화                               |
| websocket-service.ts         | GENERIC | flowId 기반 broadcast                    |
| trace-service.ts             | GENERIC | run/node 단위 기록                       |
| all repositories             | GENERIC | memDb/DynamoDB 추상화                    |
| all handlers                 | GENERIC | HTTP 경계만 담당                         |
| middleware, response, logger | GENERIC | 유틸리티                                 |

### 1.2 무엇이 쇼츠 전용 하드코딩인가 (분리 대상)

| 파일                   | 하드코딩 내용                                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| types.ts BLOCK_TYPES   | `['search','content','data','analysis','media-image','media-tts','media-video','integration']` 고정 enum |
| prompt-templates.ts    | "education shorts video platform", 8블록 규칙, 한국어                                                    |
| mock-orchestrator.ts   | 8블록 고정 DAG, 한국어 라벨, 쇼츠 비용표                                                                 |
| claude-orchestrator.ts | COST_ESTIMATES 쇼츠 전용, 한국어 에러 메시지                                                             |
| list-blocks.ts         | 13개 고정 카탈로그 (5 유틸 + 8 쇼츠)                                                                     |
| search-block.ts        | "입시 트렌드" 하드코딩, 교육 시스템 프롬프트                                                             |
| content-block.ts       | 7씬 고정, 쇼츠 스크립트 전용 프롬프트                                                                    |
| integration-block.ts   | hashtags, SEO, "수험생,학부모" 타겟                                                                      |
| analysis-block.ts      | 교육 콘텐츠 금지어 리스트                                                                                |
| data-block.ts          | content→media 파이프라인 전용 정규화                                                                     |

### 1.3 왜 쇼츠 전용처럼 보이는가

Orchestrator가 사용자 요청을 받으면:

1. 고정된 시스템 프롬프트("education shorts")로 Claude 호출
2. 고정된 8블록 타입만 알고 있음
3. 항상 8블록 DAG 반환 (다른 조합 불가)
4. 각 블록 executor가 쇼츠 전용 로직

즉, **실행 인프라는 범용이지만 계획(planning) 계층이 단일 도메인에 잠겨있음.**

---

## 2. 목표 아키텍처

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (React)                       │
│  캔버스 + 채팅 + 블록 카탈로그 + 승인 UI                    │
└───────────────────────┬─────────────────────────────────┘
                        │
┌───────────────────────┴─────────────────────────────────┐
│                 Core Platform (범용)                       │
│                                                           │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ Planner v2  │  │ Block        │  │ Block Proposal │  │
│  │ Orchestrator│→ │ Catalog      │→ │ & Approval     │  │
│  │             │  │ (dynamic)    │  │                │  │
│  └──────┬──────┘  └──────────────┘  └────────────────┘  │
│         │                                                 │
│  ┌──────┴──────────────────────────────────────────────┐ │
│  │            Execution Engine (현재 그대로)              │ │
│  │  DAG toposort → wave execution → traces → assets    │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │         Generic Block Executor                       │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────────┐    │ │
│  │  │ Builtin  │ │ Domain   │ │ Prompt Agent     │    │ │
│  │  │ Blocks   │ │ Packs    │ │ Blocks (dynamic) │    │ │
│  │  │ (utils)  │ │          │ │                  │    │ │
│  │  └──────────┘ └──────────┘ └──────────────────┘    │ │
│  └─────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘

Domain Packs:
  ┌─────────────┐ ┌─────────────┐ ┌───────────┐
  │ shorts-pack │ │ blog-pack   │ │ image-pack│ ...
  │ 8 blocks    │ │ 4 blocks    │ │ 3 blocks  │
  │ + prompts   │ │ + prompts   │ │ + prompts │
  └─────────────┘ └─────────────┘ └───────────┘
```

### 2.1 Core Platform

**변경 없이 유지:**

- execution-engine, run-service, queue, websocket, traces, assets
- repositories, handlers, middleware, contracts

**일반화 대상:**

- Orchestrator → Planner v2
- BLOCK_TYPES enum → Dynamic Block Catalog
- 고정 블록 → Builtin + Domain Pack + Prompt Agent

### 2.2 Block Definition (새 메타데이터 구조)

```typescript
interface BlockDefinition {
    // Identity — 버전 보존을 위해 blockId + version이 복합키
    blockId: string; // "blk-search" or "blk-usr-abc123"
    type: string; // unique type key (latest version의 alias)
    version: string; // semver "1.0.0"
    isLatest: boolean; // true면 type으로 조회 시 이 버전 사용

    // Display
    name: string;
    description: string;
    category: string; // "search" | "content" | "media" | "analysis" | "custom"
    icon?: string;

    // Execution contract — Portable Schema DSL (아래 2.2.1 참조)
    inputSchema: PortableSchema;
    outputSchema: PortableSchema;
    configSchema: PortableSchema;

    // Agent behavior
    executionMode: 'builtin' | 'prompt-agent' | 'domain-pack';
    systemPrompt?: string; // prompt-agent 전용
    promptTemplate?: string; // input binding slots (아래 2.2.2 참조)
    model?: string; // allowlist에서만 선택 가능
    temperature?: number;
    maxTokens?: number;
    outputFormat?: 'json' | 'text' | 'markdown';

    // Security & Cost (보정 #5)
    costBudget?: { maxTokensPerCall: number; maxCallsPerRun: number; maxCostUsd: number };
    requiredSecrets?: string[]; // ["ANTHROPIC_API_KEY"] — secret scope 제한
    allowedModels?: string[]; // ["claude-haiku-4-5"] — model allowlist
    maxExecutionSec?: number;

    // Scope (보정 — 열린 질문 해결)
    scope: 'workspace'; // 현재는 workspace 전용만 지원
    workspaceId?: string;

    // Provenance
    source: 'builtin' | 'domain-pack' | 'ai-generated' | 'user-created';
    domainPack?: string;
    createdBy?: string;
    approved: boolean; // proposal 승인 시 함께 승인됨 (단일 승인)
}
```

#### 2.2.1 Portable Schema DSL (보정 #2)

LLM이 생성 가능하고, executor/프론트 폼/validation에서 일관되게 사용 가능한 제한된 스키마.
JSON Schema subset — 6가지 타입만 허용:

```typescript
interface PortableSchema {
    type: 'object';
    properties: Record<string, PortableField>;
    required?: string[];
}

interface PortableField {
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    description?: string;
    default?: unknown;
    // string constraints
    enum?: string[];
    minLength?: number;
    maxLength?: number;
    // number constraints
    minimum?: number;
    maximum?: number;
    // array constraints
    items?: PortableField;
    minItems?: number;
    maxItems?: number;
    // nested object
    properties?: Record<string, PortableField>;
    required?: string[];
}
```

**왜 이 제약인가:**

- LLM이 안정적으로 생성 가능한 범위
- zod로 런타임 변환 가능 (`portableSchemaToZod()` 유틸)
- 프론트 폼 자동 생성 가능
- JSON Schema 호환 (subset)

#### 2.2.2 Prompt Template + Input Binding (보정 #3)

prompt-agent 블록의 입력 매핑 규칙. upstream 출력이 프롬프트 문자열로 퇴화하지 않도록 구조화.

```typescript
// BlockDefinition.promptTemplate 예시:
`당신은 전문 블로그 작성자입니다.

## 입력 데이터
- 주제: {{input.topic}}
- 키워드: {{input.keywords | join(", ")}}
- 참고 자료: {{input.references | json}}

## 요구사항
- {{config.tone}} 톤으로 작성
- {{config.wordCount}}자 이내

## 출력 형식
JSON으로 반환: { "title": "...", "body": "...", "summary": "..." }`;
```

**바인딩 규칙:**

- `{{input.fieldName}}` — inputSchema의 필드를 참조
- `{{input.fieldName | json}}` — JSON 직렬화
- `{{input.fieldName | join(sep)}}` — 배열 조인
- `{{config.fieldName}}` — configSchema의 필드를 참조
- 바인딩 실패 시 → `[missing: fieldName]` 삽입 + trace 경고 (실행은 계속)

**executor 흐름:**

1. inputSchema로 upstream output 검증
2. promptTemplate에 바인딩 적용 → 완성된 user message
3. systemPrompt + user message → Claude API
4. response를 outputSchema로 검증

### 2.3 Planner v2 Orchestrator

현재: "쇼츠 요청 → 고정 8블록 DAG"
목표: "임의 요청 → 블록 카탈로그 검색 → DAG 설계 → 부족하면 새 블록 제안"

```
사용자: "블로그 글 자동 생성해줘"

Planner v2:
1. Block Catalog 조회 → 사용 가능한 블록 목록 확인
2. 요청 분석 → 필요한 능력: 리서치, 글쓰기, 이미지, 검토
3. 매칭:
   - 리서치 → search block (있음) ✅
   - 글쓰기 → ?? (없음) ❌
   - 이미지 → media-image block (있음) ✅
   - 검토 → analysis block (있음) ✅
4. 부족한 블록 식별 → "writer-agent" 필요
5. Prompt Agent Block 정의 생성:
   {
     type: "writer-agent",
     name: "블로그 글쓰기 에이전트",
     executionMode: "prompt-agent",
     systemPrompt: "You are a professional Korean blog writer...",
     model: "claude-sonnet-4-5",
     inputSchema: { topic, keywords, tone },
     outputSchema: { title, body, summary },
   }
6. Proposal 생성:
   - 기존 블록 3개 + 새 블록 1개
   - DAG: search → writer-agent → media-image → analysis
   - 새 블록 정의 포함 → 사용자 승인 필요
```

### 2.4 Prompt Agent Block (프롬프트형 에이전트 블록)

코드 없이 실행 가능한 블록. systemPrompt + model + I/O schema만으로 동작.

```
실행 흐름:
1. execution-engine이 block-executor 호출
2. block-executor가 blockType으로 registry 조회
3. builtin 블록이면 → 기존 executor 실행
4. prompt-agent 블록이면 → generic prompt-agent-executor 실행:
   a. BlockDefinition에서 systemPrompt, model 로드
   b. input을 user message로 변환
   c. Claude API 호출
   d. output을 outputSchema로 검증
   e. 결과 반환
```

### 2.5 Domain Pack (예: shorts-pack)

현재 쇼츠 전용 코드를 패키지화:

```
modules/domain-packs/shorts-pack/
  manifest.json          # pack metadata + block list
  blocks/
    search.ts            # 현재 search-block.ts 이동
    content.ts           # 현재 content-block.ts 이동
    data.ts
    analysis.ts
    media-image.ts
    media-tts.ts
    media-video.ts
    integration.ts
  prompts/
    search-prompt.ts
    content-prompt.ts
  templates/
    shorts-8step.json    # 8블록 DAG 템플릿
```

### 2.6 Generic Deliverable (보정 #4 — 조립 책임 분리)

**원칙:** execution-engine은 raw outputs + artifacts만 수집.
최종 조립은 integration block 또는 deliverable-composer 계층이 담당.
engine이 product-aware해지면 안 됨.

```
execution-engine 책임:
  → 각 node output을 runNode.outputPayload에 저장
  → 각 node asset을 assetsTable에 저장
  → run.finalOutputSummary = null (engine은 조립 안 함)

deliverable-composer 책임 (별도 서비스):
  → run 완료 후 호출됨
  → 모든 node output + assets를 읽어서 GenericDeliverable 조립
  → domain-pack이 있으면 pack의 composer 사용
  → 없으면 기본 composer (outputs + artifacts 나열)
```

```typescript
// 기본 GenericDeliverable (engine이 아닌 composer가 생성)
interface GenericDeliverable {
    summary: string;
    outputs: Record<nodeId, unknown>; // 블록별 raw output
    artifacts: Array<{
        type: string;
        url: string;
        label: string;
        mimeType: string;
        metadata: Record<string, unknown>;
    }>;
    metadata: {
        domainPack?: string;
        totalCost?: number;
        blockCount: number;
        completedAt: string;
    };
}

// shorts-pack의 composer는 이걸 확장:
interface ShortsDeliverable extends GenericDeliverable {
    title: string;
    hashtags: string[];
    video: { url; durationSec; width; height };
    audio: { url; durationSec };
    // ... 쇼츠 전용 필드
}
```

**왜 이렇게 분리하는가:**

- 블로그 pack → 결과는 markdown + images
- 이미지 pack → 결과는 gallery
- 쇼츠 pack → 결과는 video + metadata
- engine에 이 모든 분기를 넣으면 core가 도메인 의존적이 됨

---

## 3. 대안 비교

| 방향                       | 설명                                   | 장점                                         | 단점                                       | 추천        |
| -------------------------- | -------------------------------------- | -------------------------------------------- | ------------------------------------------ | ----------- |
| A. 쇼츠 강화               | 현재 구조에 쇼츠 기능만 추가           | 빠름                                         | 확장 불가, 다른 도메인 못함                | ❌          |
| B. 코드 생성형             | 사용자가 JS/Python 블록 작성           | 유연함                                       | 보안 위험, 샌드박스 필요, 캡스톤 범위 초과 | ❌          |
| **C. 프롬프트 에이전트형** | **카탈로그 + AI가 프롬프트 블록 생성** | **코드 없이 확장, 안전, 기존 인프라 재사용** | 프롬프트 품질에 의존                       | **✅ 추천** |

**C를 추천하는 이유:**

1. 현재 execution-engine 100% 재사용
2. 새 블록 = systemPrompt + model + schema → 코드 생성 불필요
3. 보안: LLM 호출만 하므로 임의 코드 실행 위험 없음
4. 캡스톤 발표: "AI가 필요한 에이전트를 스스로 설계하고 실행한다" → 임팩트 큼

---

## 4. 보안/운영 리스크 대응 (보정 #5 — 구체화)

| 리스크           | 대응                                                                                                | 구현 위치             |
| ---------------- | --------------------------------------------------------------------------------------------------- | --------------------- |
| 모델 남용        | `allowedModels` allowlist — 블록별 사용 가능 모델 제한. 기본값: `['claude-haiku-4-5']`              | BlockDefinition       |
| 토큰 폭주        | `costBudget.maxTokensPerCall` (기본 4096) + `maxCallsPerRun` (기본 1)                               | prompt-agent-executor |
| 비용 폭주        | `costBudget.maxCostUsd` per block + run-level 합산 상한 ($1 기본)                                   | execution-engine      |
| Secret 범위      | `requiredSecrets` 명시. executor는 해당 secret만 settings에서 조회 가능. 미명시 secret 요청 시 거부 | prompt-agent-executor |
| Runaway 실행     | `maxExecutionSec` per block (기본 30초) + run-level timeout (기본 300초)                            | execution-engine      |
| 프롬프트 인젝션  | output을 PortableSchema 기반 zod로 검증 + 예상치 못한 필드 strip                                    | prompt-agent-executor |
| 과도한 블록 생성 | workspace당 사용자 생성 블록 상한 (기본 50개)                                                       | block-catalog-service |
| 승인 우회        | 새 블록은 반드시 proposal 승인과 함께 승인됨 (단일 게이트)                                          | proposal-service      |

### Secret Scope 규칙

```
블록 정의:   requiredSecrets: ["ANTHROPIC_API_KEY"]
실행 시:     executor가 settings.getKeyForProvider("anthropic") 호출
             → 허용됨 ✅

블록 정의:   requiredSecrets: ["ANTHROPIC_API_KEY"]
실행 시:     executor가 settings.getKeyForProvider("openai") 호출
             → 거부 ❌ + trace ERROR
```

### 승인 정책 (열린 질문 해결)

```
사용자: "블로그 글 만들어줘"
→ Planner: proposal { existingBlocks + newBlocks }
→ 사용자에게 한 번에 표시:
  "4개 블록 중 1개가 새로 생성됩니다. [승인] [거절]"
→ 승인 시: 새 블록 정의 저장 + DAG 배치 (단일 승인)
→ 별도 2단계 승인 불필요 (캡스톤 범위에서 과도)
```

---

## 5. 프론트 UX 흐름

```
사용자: "블로그 글 자동 생성해줘"

채팅창:
┌─────────────────────────────────────────┐
│ AI: 4개 블록이 필요합니다.                │
│                                         │
│ ✅ 리서치 (기존 블록)                     │
│ 🆕 블로그 작성기 (새 에이전트 블록)        │
│    - 프롬프트: "전문 블로그 작성자..."     │
│    - 모델: Claude Sonnet                 │
│ ✅ 이미지 생성 (기존 블록)                │
│ ✅ 품질 검수 (기존 블록)                  │
│                                         │
│ 예상 비용: $0.05                         │
│                                         │
│ [새 블록 승인 + 배치] [수정 요청] [거절]   │
└─────────────────────────────────────────┘

승인 시:
1. 새 블록 정의 → BlockDefinitionsTable 저장
2. 기존 + 새 블록 → flow에 DAG 배치
3. 실행 → 기존 engine 그대로 사용
```

---

## 6. 현재 구조에서의 변경 분류

| 구분              | 대상                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| **유지 (0 변경)** | execution-engine, run-service, queue, ws, traces, assets, repositories, handlers, middleware, contracts 구조 |
| **일반화**        | block-registry (dynamic), block-executor (prompt-agent 지원), orchestrator (planner v2)                      |
| **분리**          | 8개 쇼츠 블록 → shorts-pack, 쇼츠 프롬프트 → shorts-pack/prompts                                             |
| **신규**          | BlockDefinitionsTable, prompt-agent-executor, planner v2 prompt, domain-pack loader, block approval handler  |
