# Product API Gap Analysis & Implementation Report — KW-backend/main

## Status: Phase 3 COMPLETE (2026-04-12)

---

## Phase 2: F-표 기반 백엔드 gap 보완

### 1. 이번에 구현한 기능

| #   | 기능                                           | 테스트 결과 | 설명                                                                                                             |
| --- | ---------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------- |
| A   | F-34 API 키 미등록 시 실행 차단                | PASS        | 블록→provider 매핑, block override 우선, 누락 시 422 + missingProviders                                          |
| B   | F-11 단일 블록 실행 제품 API                   | PASS        | POST /flows/{flowId}/nodes/{nodeId}/runs → SINGLE_NODE run                                                       |
| C1  | GET /flows cursor 페이지네이션                 | PASS        | nextCursor 기반, limit+1 peek                                                                                    |
| C2  | GET /runs cursor 페이지네이션                  | PASS        | flowId/status 필터 + cursor                                                                                      |
| C3  | GET /flows/{flowId}/messages cursor            | PASS        | 기존 compat handler에 cursor 추가                                                                                |
| C4  | GET /runs/{runId}/traces cursor                | PASS        | 기존 compat handler에 cursor 추가                                                                                |
| C5  | GET /runs/{runId}/nodes/{nodeId}/traces cursor | PASS        | product handler에 cursor 추가                                                                                    |
| D   | GET /initial-data 계약 정렬                    | PASS        | `{initialData: {availableBlocks, userWorkflows}}` 형태. ownerId는 query param이며 응답 top-level에 포함하지 않음 |
| E1  | WS connect flowId 파라미터                     | PASS        | `?flowId=` + `?channels=` 모두 지원                                                                              |
| E2  | WS pong payload 보정                           | PASS        | `{type: "pong"}` only. action/ts 필드 제거됨 (최종 보정)                                                         |

### 2. 수정 파일 목록

**새로 생성:**

- `apps/backend/src/handlers/http/product-runs/start-single-node-run.ts` — F-11

**수정:**

- `apps/backend/src/services/run-service.ts` — F-34 checkMissingApiKeys() + createSingleNodeRun()
- `apps/backend/src/handlers/http/runs/start-run.ts` — F-34 422 응답 처리
- `apps/backend/src/handlers/http/product-flows/list-flows.ts` — cursor 페이지네이션
- `apps/backend/src/handlers/http/product-runs/list-all-runs.ts` — cursor 페이지네이션
- `apps/backend/src/handlers/http/messages/list-messages.ts` — cursor 파싱 추가
- `apps/backend/src/handlers/http/traces/list-traces.ts` — cursor 지원 리팩터
- `apps/backend/src/handlers/http/product-traces/list-node-traces.ts` — cursor 지원
- `apps/backend/src/handlers/http/product-initial/get-initial-data.ts` — 계약 정렬
- `apps/backend/src/repositories/message-repository.ts` — cursor 지원
- `apps/backend/src/repositories/trace-repository.ts` — cursor 지원 (listByRun + listByRunNode)
- `apps/backend/src/handlers/ws/connect.ts` — flowId query param 지원
- `apps/backend/src/handlers/ws/default.ts` — pong payload 보정
- `apps/backend/serverless.yml` — F-11 라우트 추가

### 3. 테스트 결과 (31개 assertion)

| 카테고리               | 테스트 수 | 결과     |
| ---------------------- | --------- | -------- |
| F-34 API 키 차단       | 4         | ALL PASS |
| F-11 단일 블록 실행    | 4         | ALL PASS |
| Cursor 페이지네이션    | 5         | ALL PASS |
| initial-data 계약      | 4         | ALL PASS |
| Compat API regression  | 9         | ALL PASS |
| Product API regression | 3         | ALL PASS |
| Prefix routing         | 2         | ALL PASS |

### 4. F-표 기능 상태 업데이트

| 기능                      | 이전      | 이후     | 비고                                                        |
| ------------------------- | --------- | -------- | ----------------------------------------------------------- |
| F-01 블록 카탈로그        | 부분 완료 | **완료** | scenario 필터 동작 확인 (admission-shorts 8, news-shorts 6) |
| F-02 플로우 생성          | 완료      | 완료     |                                                             |
| F-03 플로우 목록          | 부분 완료 | **완료** | cursor 페이지네이션 추가                                    |
| F-04 플로우 상세          | 완료      | 완료     |                                                             |
| F-05 플로우 저장          | 완료      | 완료     |                                                             |
| F-06 채팅+AI 제안         | 완료      | 완료     |                                                             |
| F-07 채팅 이력            | 완료      | **완료** | cursor 추가                                                 |
| F-08 제안 승인            | 완료      | 완료     |                                                             |
| F-09 제안 거절            | 완료      | 완료     |                                                             |
| F-10 전체 실행            | 완료      | 완료     |                                                             |
| F-11 단일 블록 실행       | **미완**  | **완료** | POST /flows/{flowId}/nodes/{nodeId}/runs                    |
| F-12 실행 이력(플로우)    | 부분 완료 | **완료** | cursor 페이지네이션 추가                                    |
| F-13 실행 이력(전체)      | 완료      | **완료** | cursor 추가                                                 |
| F-14 실행 상세            | 완료      | 완료     |                                                             |
| F-15 블록 재실행          | 완료      | 완료     |                                                             |
| F-16 실행 취소            | 완료      | 완료     |                                                             |
| F-17 실시간 상태          | 부분 완료 | **완료** | WS E2E 전체 이벤트 수신 검증 완료                           |
| F-18 플로우 삭제          | 완료      | 완료     |                                                             |
| F-19 플로우 복제          | 완료      | 완료     |                                                             |
| F-21 추적 로그            | 부분 완료 | **완료** | cursor 추가                                                 |
| F-22 WS 연결관리          | 부분 완료 | **완료** | flowId param + pong {type:"pong"} only                      |
| F-31 상태 전이            | 완료      | 완료     |                                                             |
| F-32 API 키 설정          | 완료      | 완료     |                                                             |
| F-33 블록별 키 오버라이드 | 완료      | 완료     |                                                             |
| F-34 키 미등록 차단       | **미완**  | **완료** | 422 MISSING_API_KEYS                                        |
| F-35 보관 해제            | 완료      | 완료     |                                                             |

### 5. 남은 Gap (Phase 3에서 해소됨)

| 항목                   | 이전 상태     | Phase 3 이후 | 비고                                                     |
| ---------------------- | ------------- | ------------ | -------------------------------------------------------- |
| F-01 scenario 파라미터 | 미구현        | **해소**     | admission-shorts 8블록, news-shorts 6블록 필터 동작 확인 |
| F-12 cursor            | 미추가        | **해소**     | cursor 페이지네이션 추가 완료                            |
| F-17 WS E2E            | 미검증        | **해소**     | WS E2E 스크립트로 전체 이벤트 수신 검증                  |
| F-22 heartbeat         | 클라이언트 측 | 제외         | 프론트 구현 범위                                         |

---

---

## Phase 3: Runtime Hardening + 최종 검증 (2026-04-12)

### 1. 런타임 보정 항목

| #   | 항목                    | 설명                                                                                                                                   |
| --- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | KMS encrypt/decrypt     | settingsRepo에 DynamoDB 경로 + KMS 암호화 추가, prod에서 KMS_KEY_ID 필수                                                               |
| H2  | serverless.yml IAM      | kms:Encrypt/Decrypt, execute-api:ManageConnections 권한 추가                                                                           |
| H3  | BatchWrite retry        | message/proposal deleteByFlow → paginated Query + BatchWriteCommand + UnprocessedItems 5회 재시도 + 지수백오프 + jitter + 명시적 throw |
| H4  | DynamoDB cursor         | run/message/trace → LastEvaluatedKey/ExclusiveStartKey 기반 base64 cursor                                                              |
| H5  | Trace sparse GSI        | runNodeKey-occurredAt-index GSI로 블록별 trace 조회 최적화                                                                             |
| H6  | WebSocket raw event     | payload wrapper 제거, raw event 직접 전송                                                                                              |
| H7  | Pong 보정               | `{type:"pong"}` only (action/ts 제거)                                                                                                  |
| H8  | Block catalog scenarios | admission-shorts 8블록 + news-shorts 6블록, scenarios 필드 추가                                                                        |
| H9  | Contracts schema 확장   | Product API용 zod schemas 6파일 (blocks, flows, runs, traces, assets, proposals)                                                       |

### 2. 최종 smoke test 결과 (77개 assertion, 2026-04-12)

| 도메인                                                         | PASS   | FAIL  | 비고                                                              |
| -------------------------------------------------------------- | ------ | ----- | ----------------------------------------------------------------- |
| Blocks (8) + Initial Data (3) + Compat (6)                     | 17     | 0     | scenario/category 필터, 404, prefix routing 모두 확인             |
| Flows CRUD (17)                                                | 17     | 0     | 생성→저장→READY전이→복제→보관→해제→삭제 전체 lifecycle + 409 거부 |
| Messages (4) + Proposals (8)                                   | 12     | 0     | AI 제안 생성(deterministic fallback), cursor, 승인/거절/409       |
| Runs (10) + Traces (3) + Assets (3) + Results (3) + Export (3) | 21     | 0     | 전체/단일실행, 취소/재실행 409, trace cursor, export stub         |
| Settings (10)                                                  | 10     | 0     | 단건+일괄 CRUD + 마스킹 + 검증 + 삭제 + invalid provider 422      |
| **합계**                                                       | **77** | **0** |                                                                   |

### 3. 실패 0건 (Phase 3 수정 후)

이전 2건 모두 해소됨:

- PUT /settings/api-keys `{keys:[...]}` 일괄 저장 → **구현 완료** (200, `{items:[...]}`)
- Invalid provider → **422 UNPROCESSABLE_ENTITY로 통일** (PUT/DELETE/VERIFY 모두)

### 4. F-표 기능 최종 상태

| 기능                      | 상태     | 비고                                                          |
| ------------------------- | -------- | ------------------------------------------------------------- |
| F-01 블록 카탈로그        | **완료** | scenario 필터 동작 확인 (admission-shorts 8, news-shorts 6)   |
| F-02 플로우 생성          | 완료     |                                                               |
| F-03 플로우 목록          | 완료     | cursor + status 필터                                          |
| F-04 플로우 상세          | 완료     |                                                               |
| F-05 플로우 저장          | 완료     | DRAFT→READY 자동 전이 확인                                    |
| F-06 채팅+AI 제안         | 완료     | deterministic fallback 동작                                   |
| F-07 채팅 이력            | 완료     | cursor + limit                                                |
| F-08 제안 승인            | 완료     | 캔버스 배치 + READY 전이                                      |
| F-09 제안 거절            | 완료     | 409 이미 처리됨                                               |
| F-10 전체 실행            | 완료     |                                                               |
| F-11 단일 블록 실행       | 완료     | SINGLE_NODE                                                   |
| F-12 실행 이력(플로우)    | 완료     | cursor                                                        |
| F-13 실행 이력(전체)      | 완료     | flowId/status 필터 + cursor                                   |
| F-14 실행 상세            | 완료     | flowSnapshot 포함                                             |
| F-15 블록 재실행          | 완료     | FAILED만 허용, 409                                            |
| F-16 실행 취소            | 완료     | COMPLETED면 409                                               |
| F-17 실시간 상태          | 완료     | WS E2E: run.started→node.started→node.completed→run.completed |
| F-18 플로우 삭제          | 완료     | 메시지/제안 연쇄삭제, 실행이력 보존                           |
| F-19 플로우 복제          | 완료     | DRAFT 상태로 복제                                             |
| F-21 추적 로그            | 완료     | run-level + node-level + cursor                               |
| F-22 WS 연결관리          | 완료     | flowId param + pong {type:"pong"} only                        |
| F-31 상태 전이            | 완료     | DRAFT→READY→ARCHIVED→READY, 409 가드                          |
| F-32 API 키 설정          | 완료     | CRUD + 마스킹                                                 |
| F-33 블록별 키 오버라이드 | 완료     | config.apiKeyOverride 우선                                    |
| F-34 키 미등록 차단       | 완료     | 422 MISSING_API_KEYS                                          |
| F-35 보관 해제            | 완료     | ARCHIVED→READY                                                |

### 5. 제외 범위

- YouTube/TikTok 실제 업로드 (export adapter는 stub)
- 프론트 Canvas 기능 (F-20, F-23~F-30)
- agentic planner v2 / prompt-agent block 생성
- AWS 배포 실검증 (KMS, DynamoDB, API Gateway)

---

## Phase 1 (이전 구현)

### 구현한 제품 API 11개

- GET /blocks/{blockType}, GET /blocks
- POST /flows, GET /flows, GET /flows/{flowId}, PUT /flows/{flowId}, DELETE /flows/{flowId}
- POST /flows/{flowId}/duplicate, POST /flows/{flowId}/archive, POST /flows/{flowId}/unarchive
- GET /runs, GET /runs/{runId}/nodes/{nodeId}/traces
- GET /initial-data
