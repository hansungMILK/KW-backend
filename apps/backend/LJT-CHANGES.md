# 이진태 — Blocks / Flows / Infra 변경 내역 (P1 → P2 → P3)

## P1 — 명세 경로 신규 추가

| API                       | 핸들러                                   |
| ------------------------- | ---------------------------------------- |
| `GET /blocks`             | `src/handlers/http/blocks/get-blocks.ts` |
| `GET /blocks/{blockType}` | `src/handlers/http/blocks/get-block.ts`  |
| `POST /flows`             | `src/handlers/http/flows/create-flow.ts` |
| `GET /flows`              | `src/handlers/http/flows/list-flows.ts`  |
| `GET /flows/{flowId}`     | `src/handlers/http/flows/get-flow.ts`    |
| `PUT /flows/{flowId}`     | `src/handlers/http/flows/put-flow.ts`    |

- `PUT /flows/{flowId}` — nodes >= 1이면 DRAFT → READY 자동 전이
- `GET /blocks/{blockType}` — 없는 타입이면 404 `BLOCK_NOT_FOUND`

## P2 — lifecycle 기능 추가 + IaC

| API                              | 핸들러                                      |
| -------------------------------- | ------------------------------------------- |
| `DELETE /flows/{flowId}`         | `src/handlers/http/flows/delete-flow.ts`    |
| `POST /flows/{flowId}/archive`   | `src/handlers/http/flows/archive-flow.ts`   |
| `POST /flows/{flowId}/unarchive` | `src/handlers/http/flows/unarchive-flow.ts` |
| `POST /flows/{flowId}/duplicate` | `src/handlers/http/flows/duplicate-flow.ts` |

- `DELETE` cascade: Messages/Proposals 삭제, Runs/Assets 보존
- `archive`: READY 상태만 가능, 409 이미 ARCHIVED
- `unarchive`: ARCHIVED 상태만 가능
- `duplicate`: DRAFT 상태로 복제

**IaC (serverless.yml)**

- DDB 9테이블 + GSI 정의 (Flows, Connections, Messages, Proposals, Runs, RunNodes, Traces, Assets, Settings)
- IAM: DynamoDB CRUD + KMS + WebSocket ManageConnections
- KMS key (real stage only, local은 base64 fallback)

## P3 — 레거시 경로 제거

| 제거된 경로               | 대체 경로                          |
| ------------------------- | ---------------------------------- |
| `GET /flows/{id}/load`    | `GET /flows/{flowId}`              |
| `POST /flows/{id}/save`   | `PUT /flows/{flowId}`              |
| `POST /flows/{id}/upsert` | `PUT /flows/{flowId}`              |
| `POST /flows/{id}` (meta) | `PUT /flows/{flowId}`              |
| `GET /blocks/0/list`      | `GET /blocks`                      |
| `/nodes/*` 7개            | `PUT /flows/{flowId}` (nodes 배열) |
| `/edges/*` 5개            | `PUT /flows/{flowId}` (edges 배열) |

## 잔류 레거시 (타 팀원 P3에서 제거 예정)

- `/chat/analyze`, `/flows/{flowId}/chat/init` → 강연경
- `/workflows/*` → 민경욱

## 머지 전 확인사항

- [ ] **이정택 P3 완료** — `flows.ts`, `nodes.ts`, `edges.ts`, `blocks.ts` 레거시 경로 호출 제거 확인
