# 워크플로우 플랫폼 UAT 설계

작성일: 2026-05-10
대상 브랜치: `integration/jt-frontend-on-latest-backend`

## 1. 제품 기준

이 프로젝트는 단순한 쇼츠 생성기가 아니다. 최종 목표는 사용자가 자연어로 목표를 말하면 필요한 블록 그래프를 제안하고, 사용자가 승인한 뒤, 서버리스 실행 엔진이 그 워크플로우를 실행하는 n8n형 자동화 플랫폼이다.

다만 첫 번째 고품질 시연 템플릿은 한국어 쇼츠 생성 플로우다.

쇼츠 템플릿의 기준 플로우:

1. 주제 정보 수집 또는 구조화
2. 대본과 장면 계획 생성
3. 장면 데이터 정규화
4. 품질/사실성 검수
5. 10-15개 이미지 장면 생성
6. TTS 나레이션 생성
7. 자막, 출처, 배경음악을 포함한 세로형 MP4 합성
8. 최종 메타데이터와 asset URL 생성

UAT는 두 레이어를 모두 검증해야 한다.

- 플랫폼 레이어: 자연어 요청 → 블록 제안 → 승인 → 실행
- 템플릿 레이어: 쇼츠 워크플로우가 중간 데이터와 최종 MP4를 만든다

## 2. 현재 UAT 범위

이번 UAT는 현재 통합 브랜치와 현재 백엔드/API 계약을 검증한다. 새 블록 자동 생성, 플러그인 마켓, 임의 코드 생성, 완전한 n8n 대체 기능은 이번 범위가 아니다.

포함:

- 로컬 API key gate와 인증 흐름
- 채팅 → proposal 생성
- proposal 승인/거절
- 캔버스 노드/엣지 렌더링
- 수동 노드 연결
- 워크플로우 실행 버튼
- run 생성, node 상태 전이, WebSocket 업데이트
- 노드별 출력 확인
- 쇼츠 대본, 장면 프롬프트, 이미지, 오디오, 비디오, 메타데이터 asset 확인
- 이미지 생성 timeout/cancel/failure 처리
- 유료 OpenAI 호출 전 비용 제한

제외:

- 새로운 실행 블록 타입 자동 생성
- 실제 과금/결제 시스템
- 멀티 유저 권한 모델
- AWS prod 배포 smoke
- 프론트 디자인 시스템 교체

## 3. UAT 페르소나

### Persona A. 첫 사용자

목표: 비개발자가 이 제품이 무엇을 하는지 이해하고, 채팅으로 워크플로우를 만들 수 있는가?

검증 항목:

- 첫 화면에서 워크플로우 빌더라는 목적이 보인다.
- 채팅 버튼이 보이고 핵심 컨트롤과 겹치지 않는다.
- "ㅎㅇ" 같은 단순 인사는 블록 생성을 만들지 않는다.
- "최신 한국 뉴스 알려주는 쇼츠 만들어줘" 같은 실제 목표는 proposal을 만든다.
- proposal 카드에 생성될 블록, 예상 비용, 승인 필요 여부가 보인다.
- 사용자가 승인 또는 취소할 수 있다.

합격 기준:

- 문서 없이 proposal 승인 지점까지 갈 수 있다.
- 일반 대화는 일반 답변으로 남는다.
- 워크플로우 의도는 의미 있는 블록 proposal을 만든다.

### Persona B. 워크플로우 사용자

목표: 사용자가 n8n류 도구처럼 블록 그래프를 보고 수정하고 실행할 수 있는가?

검증 항목:

- 승인 후 노드와 엣지가 캔버스에 보인다.
- 노드명이 `unknown`이 아니다.
- 호환 가능한 포트끼리 수동 연결된다.
- 전체 실행 버튼이 줌 컨트롤이나 채팅 버튼과 겹치지 않는다.
- 단일 블록 실행과 전체 워크플로우 실행이 구분된다.
- 프론트가 지원하는 경우 노드 이동 후 undo가 작동한다.

합격 기준:

- 캔버스가 승인된 DAG를 정확히 표현한다.
- `Unknown block type: unknown`이 보이지 않는다.
- 활성 프론트 경로가 제거된 `/nodes/*`, `/edges/*` API에 의존하지 않는다.

### Persona C. 콘텐츠 검수자

목표: 최종 영상을 믿기 전에 생성된 중간 산출물을 확인할 수 있는가?

검증 항목:

- search/trend 노드 출력이 보인다.
- content/script 노드에서 제목, hook, narration, scene list, image prompt, source reference를 볼 수 있다.
- data 노드에서 정규화된 scene contract를 볼 수 있다.
- analysis 노드에서 승인 여부, issue, warning, fact-check 결과를 볼 수 있다.
- image 노드에서 생성된 이미지 asset 목록과 scene별 prompt를 볼 수 있다.
- TTS 노드에서 오디오 asset과 narration 매핑을 볼 수 있다.
- video 노드에서 최종 MP4 asset, duration, 합성 메타데이터를 볼 수 있다.
- integration 노드에서 제목, 설명, 태그, 최종 URL을 볼 수 있다.

합격 기준:

- 모든 백엔드 블록 출력은 UI 또는 명시 API로 확인 가능하다.
- 출처/사실성 문제는 조용히 통과하지 않고 issue로 보인다.
- 최종 MP4를 다운로드하거나 asset URL로 열 수 있다.

### Persona D. 백엔드 엔지니어

목표: 백엔드가 현재 API와 실행 계약을 지키는가?

검증 항목:

- `GET /blocks`, `GET /blocks/{blockType}`가 카탈로그를 반환한다.
- `POST /flows`, `GET /flows`, `GET /flows/{flowId}`, `PUT /flows/{flowId}`가 작동한다.
- 제거된 legacy nodes/edges route를 활성 프론트가 요구하지 않는다.
- `POST /flows/{flowId}/messages`가 chat 또는 proposal을 반환한다.
- `POST /proposals/{proposalId}/approve`가 flow의 nodes/edges를 반영한다.
- `POST /flows/{flowId}/runs`가 `MISSING_API_KEYS`, `PAID_OPENAI_DISABLED`, `RUN_COST_LIMIT_EXCEEDED`를 지킨다.
- `GET /runs/{runId}`, `GET /runs/{runId}/nodes`, `GET /runs/{runId}/assets`, `GET /assets/{assetId}`로 실행 상태와 산출물을 확인할 수 있다.
- proposal/run/node/asset/flow/node-port WebSocket 이벤트가 도착한다.
- cancel된 run이 뒤늦게 성공 asset 이벤트를 내지 않는다.

합격 기준:

- backend typecheck와 lint가 통과한다.
- 현재 API 계약과 활성 프론트 사용 경로가 맞는다.
- 이미지 요청 hang 때문에 run이 무한 RUNNING에 남지 않는다.

### Persona E. 제품/CEO 리뷰어

목표: 데모가 하드코딩 쇼츠 생성기가 아니라 서버리스 워크플로우 플랫폼으로 보이는가?

검증 항목:

- 시스템이 스스로 워크플로우 빌더 역할을 설명한다.
- 쇼츠는 템플릿으로 보이고, 유일한 제품처럼 보이지 않는다.
- 사용자가 실제 블록, 중간 데이터, 실행 상태를 본다.
- 가치 제안이 명확하다: 채팅으로 설계하고, 캔버스에서 확인하고, 실행으로 asset을 만든다.
- 실패 상태가 정직하고 다음 행동을 알려준다.

합격 기준:

- 리뷰어가 데모 후 제품을 "자연어로 실행 가능한 워크플로우를 만드는 도구"라고 설명할 수 있다.
- 쇼츠 템플릿이 플랫폼 루프를 끝까지 보여준다.

### Persona F. 비용/안전 리뷰어

목표: 유료 테스트가 비용 폭주 없이 진행될 수 있는가?

검증 항목:

- `MAX_RUN_ESTIMATED_COST_USD=2` 이하가 활성화되어 있다.
- `ALLOW_PAID_OPENAI=1`은 명시적으로 켤 때만 켠다.
- 다음 paid smoke는 전체 12-15장이 아니라 2-3장으로 먼저 돌린다.
- 이미지 scene timeout과 max attempts는 안전한 env parser를 탄다.
- 이미지 생성 첫 non-cancel failure 이후 뒤 scene을 새로 시작하지 않는다.
- 긴 작업 중 cancel 경로가 있다.

합격 기준:

- 예상 비용이 cap을 넘으면 run 생성이 막힌다.
- 이미지 API hang은 timeout 후 node/run failure로 전이된다.
- cancel된 run은 뒤늦은 asset 저장/성공 이벤트를 만들지 않는다.

## 4. 검증 단계

### Phase 0. 정적 계약 검증

목적: 브라우저 테스트나 유료 호출 전에 브랜치가 구조적으로 안전한지 확인한다.

명령:

```bash
git status --short --branch
npx nx run @flows/backend:typecheck --skip-nx-cache
npx nx run @flows/backend:lint --skip-nx-cache
npx nx run @flows/web:typecheck --skip-nx-cache
npx nx run @flows/web:lint --skip-nx-cache
npx nx build web --skip-nx-cache
rg '"/nodes/|/edges/|/nodes/0/image|/nodes/.*/touch' apps libs
```

합격 기준:

- typecheck와 lint가 통과한다.
- build가 통과하거나, 남은 warning이 명확히 비차단임을 설명할 수 있다.
- 활성 프론트 경로가 제거된 legacy node/edge API를 호출하지 않는다.

### Phase 1. 로컬 no-paid smoke

목적: OpenAI 비용 없이 API, 채팅, proposal, 캔버스, run 상태를 검증한다.

설정:

```bash
ALLOW_PAID_OPENAI=0
ORCHESTRATOR_MODE=mock
MAX_RUN_ESTIMATED_COST_USD=2
```

절차:

1. 백엔드와 프론트를 실행한다.
2. 로컬 앱 API key를 입력한다.
3. "안녕 너는 뭘 할 수 있니?"를 보낸다.
4. proposal이 생기지 않는지 확인한다.
5. "입시정보 쇼츠 만들어줘."를 보낸다.
6. 블록과 비용이 포함된 proposal이 생기는지 확인한다.
7. proposal을 승인한다.
8. 노드와 엣지가 렌더링되는지 확인한다.
9. run을 시작한다.
10. run/node 이벤트가 UI에 반영되는지 확인한다.

합격 기준:

- 일반 대화가 블록 생성을 만들지 않는다.
- 워크플로우 요청은 기대 DAG를 만든다.
- 노드 상태 변화가 보인다.

### Phase 2. 로컬 output inspection

목적: 모든 노드 출력이 사용자에게 보이고 쓸모 있는지 검증한다.

검증 항목:

1. 각 노드를 클릭한다.
2. 로그/output 패널을 연다.
3. 완료된 노드가 계속 "데이터 대기 중..."으로 남지 않는지 확인한다.
4. script, scene prompt, image list, audio list, video asset, metadata가 보이는지 확인한다.

합격 기준:

- 완료 노드는 `outputPayload`를 노출한다.
- 출력이 없으면 이유가 표시된다.
- 사용자가 asset URL을 열거나 복사할 수 있다.

### Phase 3. 제한 paid smoke

목적: 비용을 제한하면서 실제 OpenAI 경로가 작동하는지 확인한다.

설정:

```bash
ALLOW_PAID_OPENAI=1
MAX_RUN_ESTIMATED_COST_USD=2
OPENAI_IMAGE_SCENE_CONCURRENCY=2
OPENAI_IMAGE_SCENE_TIMEOUT_MS=120000
OPENAI_IMAGE_SCENE_MAX_ATTEMPTS=1
OPENAI_IMAGE_TIMEOUT_MS=120000
OPENAI_IMAGE_MAX_ATTEMPTS=1
```

테스트 프롬프트:

```text
최신 한국 뉴스 알려주는 쇼츠 만들어줘.
```

필수 제한:

- 첫 paid smoke는 2-3 scenes만 실행한다.
- MP4 경로가 증명되기 전에는 full 12-15 scenes를 실행하지 않는다.

합격 기준:

- proposal 예상 비용이 cap 아래다.
- search/content/data/analysis가 완료된다.
- 실제 이미지 2-3장이 생성된다.
- TTS 오디오가 생성된다.
- FFmpeg가 MP4를 합성한다.
- MP4가 `~/Downloads` 같은 사용자 확인 가능 경로에 복사된다.

### Phase 4. 전체 템플릿 smoke

목적: 실제 시연 템플릿을 검증한다.

Phase 3 통과 후에만 실행한다.

설정:

- 사용자가 명시적으로 올리기 전까지 `MAX_RUN_ESTIMATED_COST_USD=2`를 유지한다.
- 먼저 10-12 scenes를 실행하고, 필요할 때만 15 scenes로 올린다.

합격 기준:

- 최종 MP4가 재생된다.
- 제목/자막/source overlay는 이미지 생성물이 아니라 compositor가 담당한다.
- 라이선스 안전 BGM이 설정된 경우에만 BGM이 포함된다.
- 최종 run status가 `COMPLETED`다.

## 5. 버튼/UI 체크리스트

### Canvas

- 첫 노드 추가 버튼이 라이브러리를 연다.
- 사이드바/라이브러리에서 text/image input node를 추가할 수 있다.
- 호환 가능한 포트 연결이 된다.
- 잘못된 연결은 시각적으로 거절된다.
- 줌 컨트롤이 워크플로우 실행 버튼과 겹치지 않는다.
- 채팅 버튼이 고정 컨트롤과 겹치지 않는다.
- 프론트 상태 모델이 지원하는 경우 노드 이동 undo가 작동한다.

### Chat

- 최초 빈 상태에서 agent가 무엇을 할 수 있는지 설명한다.
- Enter 후 입력창이 완전히 비워진다.
- 응답 대기 중 loading 상태가 보인다.
- markdown이 읽기 쉽고 `**`가 그대로 남아 가독성을 해치지 않는다.
- proposal card는 workflow intent일 때만 나온다.

### Node Detail

- 선택한 노드의 title, block type, status, input, output, logs가 보인다.
- 완료된 노드의 output이 보인다.
- 실패한 노드는 error code와 message를 보여준다.
- 실행 중 노드는 progress를 보여준다.

### Run Controls

- 전체 워크플로우 실행과 단일 블록 실행이 구분된다.
- flow가 READY가 아니면 실행 버튼이 비활성화되거나 이유를 알려준다.
- 긴 유료 작업 중 cancel이 가능하다.

## 6. 백엔드 API 체크리스트

UAT 필수 route:

- `GET /blocks`
- `GET /blocks/{blockType}`
- `POST /flows`
- `GET /flows`
- `GET /flows/{flowId}`
- `PUT /flows/{flowId}`
- `GET /flows/{flowId}/messages`
- `POST /flows/{flowId}/messages`
- `GET /flows/{flowId}/proposals`
- `GET /proposals/{proposalId}`
- `POST /proposals/{proposalId}/approve`
- `POST /proposals/{proposalId}/reject`
- `POST /flows/{flowId}/runs`
- `GET /flows/{flowId}/runs`
- `GET /runs`
- `GET /runs/{runId}`
- `GET /runs/{runId}/nodes`
- `GET /runs/{runId}/nodes/{nodeId}`
- `GET /runs/{runId}/traces`
- `GET /runs/{runId}/nodes/{nodeId}/traces`
- `GET /runs/{runId}/assets`
- `GET /assets/{assetId}`
- `GET /settings/api-keys`
- `PUT /settings/api-keys`
- `DELETE /settings/api-keys/{provider}`
- `POST /settings/api-keys/{provider}/verify`

P3에서 제거된 route는 활성 프론트가 요구하면 안 된다.

- `/nodes/*`
- `/edges/*`
- `/flows/{id}/load`
- `/flows/{id}/save`
- `/flows/{id}/upsert`
- `/chat/analyze`
- `/flows/{flowId}/chat/init`
- `/workflows/*`

## 7. WebSocket 체크리스트

필수 이벤트:

- `proposal.created`
- `run.started`
- `node.started`
- `node.progress`
- `node.completed`
- `node.failed`
- `asset.created`
- `run.completed`
- `run.failed`
- `flow`
- `node/port`
- `system/pong`
- `system/info`

합격 기준:

- 브라우저가 수동 새로고침 없이 상태 업데이트를 받는다.
- API key가 브라우저 로그에 노출되지 않는다.
- heartbeat 실패 후 reconnect가 작동한다.

## 8. 실패/복구 시나리오

### API key 누락

OpenAI key 없이 워크플로우 run을 시도한다.

기대 결과:

- `MISSING_API_KEYS`가 반환된다.
- UI가 어떤 provider가 빠졌는지 보여준다.
- 유료 호출이 발생하지 않는다.

### 유료 호출 비활성화

`ALLOW_PAID_OPENAI=0`으로 설정한다.

기대 결과:

- 유료 OpenAI 호출이 `PAID_OPENAI_DISABLED`로 막힌다.
- UI가 성공처럼 보이지 않는다.

### 비용 한도 초과

`MAX_RUN_ESTIMATED_COST_USD=0.01`처럼 낮게 설정한다.

기대 결과:

- run 생성이 `RUN_COST_LIMIT_EXCEEDED`로 막힌다.
- 응답에 estimated cost와 maximum cost가 포함된다.

### 이미지 timeout

통제된 로컬 테스트에서 `OPENAI_IMAGE_SCENE_TIMEOUT_MS`를 낮게 설정한다.

기대 결과:

- `media-image`가 실패한다.
- run이 `FAILED`로 전이된다.
- 첫 non-cancel failure 이후 뒤 scene을 새로 시작하지 않는다.

### 사용자 cancel

이미지 생성 중 cancel한다.

기대 결과:

- run이 `CANCELLED`로 전이된다.
- 노드가 뒤늦게 `COMPLETED`가 되지 않는다.
- late asset이 성공 이벤트로 저장/브로드캐스트되지 않는다.

## 9. UAT 산출물

각 UAT 실행은 짧은 report를 남긴다.

포함 항목:

- 날짜와 branch SHA
- secret을 제외한 주요 환경변수
- 사용한 prompt
- flowId, proposalId, runId
- proposal, canvas, node output, final asset 스크린샷
- 생성된 MP4 경로
- 실행 전 예상 비용
- 실패 시 실제 오류
- 페르소나별 pass/fail 표

권장 경로:

```text
docs/uat-reports/YYYY-MM-DD-<run-id>.md
```

## 10. 실행 승인 gate

아래 조건이 모두 참이 아니면 paid smoke를 시작하지 않는다.

- backend typecheck 통과
- backend lint 통과
- web typecheck 통과
- web lint 통과
- 활성 프론트가 제거된 legacy API를 호출하지 않음
- OpenAI key가 의도적으로 설정됨
- `ALLOW_PAID_OPENAI=1`이 의도적으로 설정됨
- `MAX_RUN_ESTIMATED_COST_USD <= 2`
- 첫 paid smoke scene count는 2-3으로 제한

아래 조건이 모두 참이 아니면 "UAT 통과"라고 말하지 않는다.

- no-paid smoke 1회 이상 통과
- 제한 paid smoke 1회 이상에서 재생 가능한 MP4 생성
- 노드별 output 확인 가능
- 실패/비용 guard가 관찰되었거나 targeted test로 고정됨

## 11. 현재 알려진 주의점

- `purpose.md`는 현재 첫 템플릿인 입시 쇼츠 생성에 좁게 적혀 있다. 데모 방향으로는 유효하지만 최종 제품 범위로 읽으면 안 된다.
- 제품 설명은 "채팅이 워크플로우를 제안하고, 캔버스가 노출하고, 실행이 asset을 만든다"여야 한다.
- 쇼츠 생성은 Sora식 원샷 비디오가 아니라 이미지 + TTS + FFmpeg 합성 구조를 유지한다.
- 생성 이미지는 제목/자막 band를 직접 만들면 안 된다. 최종 제목, 자막, 출처, BGM은 compositor가 담당한다.

## 12. Spec self-review

- placeholder 섹션 없음
- 새 기능 구현이 아니라 UAT/검증 범위에 집중함
- paid smoke는 비용 cap과 scene count 제한을 명확히 가짐
- UX, 백엔드, 콘텐츠 품질, 비용 안전, 제품 포지셔닝 관점을 모두 포함함
- 제거된 legacy API는 기대 경로가 아니라 호환 리스크로 다룸
