# Eureka Flow Backend Guide

이 문서는 이 프로젝트에 참여할 백엔드 개발자 3명을 위한 온보딩 문서입니다.

목표는 3가지입니다.

- 이 프로젝트의 백엔드가 어떤 역할을 하는지 이해하기
- 어디에 어떤 코드를 넣어야 하는지 빠르게 판단하기
- 3명이 동시에 작업해도 충돌을 줄이면서 협업하기

---

## 1. 이 프로젝트가 하는 일

Eureka Flow는 "노드와 엣지로 구성된 워크플로우"를 만들고 실행하는 서비스입니다.

백엔드는 주로 아래 일을 합니다.

- flow, node, edge 데이터를 저장하고 불러오기
- 실행(run) 생성 및 상태 관리
- WebSocket으로 실행 상태 전달
- AI / AWS 같은 외부 서비스 연결
- 프론트와 공유하는 API 계약 관리

중요한 점:

- 이 백엔드는 Express 서버가 아니라 **Serverless Framework + Lambda handler 구조**입니다.
- 로컬에서는 `serverless offline`으로 실행합니다.
- 처음부터 AWS를 알아야 시작할 수 있는 구조는 아닙니다.

---

## 2. 가장 먼저 이해할 핵심 개념

이 프로젝트는 아래 흐름으로 읽으면 됩니다.

1. `serverless.yml`
2. `handlers`
3. `services`
4. `repositories` / `adapters`
5. `libs/contracts`

한 줄로 보면:

`요청 -> handler -> service -> repository/adapter -> 응답`

역할은 이렇게 이해하면 됩니다.

- `handler`: HTTP/WS 진입점
- `service`: 비즈니스 로직
- `repository`: 저장소 접근
- `adapter`: 외부 시스템 접근
- `contracts`: 프론트/백엔드가 같이 쓰는 요청/응답 스키마

---

## 3. 모노레포 구조

```text
KW-backend/
├── apps/
│   ├── backend/                 # 백엔드 앱
│   │   ├── serverless.yml       # 라우팅과 Lambda 연결
│   │   ├── package.json
│   │   └── src/
│   │       ├── config/          # 환경변수 진입점
│   │       ├── handlers/        # HTTP / WebSocket handler
│   │       ├── services/        # 비즈니스 로직
│   │       ├── repositories/    # 저장소 접근
│   │       ├── adapters/        # AWS / AI / 외부 API
│   │       ├── modules/         # block executor / orchestrator
│   │       └── utils/           # 공용 유틸
│   └── web/                     # 프론트엔드 앱
├── libs/
│   ├── contracts/               # 프론트/백엔드 공용 API 계약
│   ├── flows/
│   ├── socket/
│   ├── web-core/
│   ├── ui-kit/
│   ├── shared/
│   └── theme/
├── package.json
└── tsconfig.base.json
```

백엔드 작업자는 우선 아래만 보면 됩니다.

- `apps/backend/serverless.yml`
- `apps/backend/src/**`
- `libs/contracts/**`

---

## 4. 백엔드 폴더 설명

### `apps/backend/src/config`

- 환경변수 읽는 곳입니다.
- 새 env를 추가하면 **여기 먼저 추가**합니다.
- 현재 시작점: `apps/backend/src/config/env.ts`

### `apps/backend/src/handlers`

- HTTP 또는 WebSocket 요청이 처음 들어오는 곳입니다.
- request 파싱, zod 검증, service 호출, response 반환 정도만 담당합니다.
- 큰 로직을 handler에 오래 두지 않는 것이 좋습니다.

### `apps/backend/src/services`

- 실제 비즈니스 로직이 들어갑니다.
- 예: run 생성, proposal 승인/거절, 실행 상태 변경

### `apps/backend/src/repositories`

- 데이터 저장/조회 전용입니다.
- "무슨 데이터를 읽고 쓰는지"만 담당합니다.
- 비즈니스 판단은 service에서 합니다.

### `apps/backend/src/adapters`

- 외부 시스템과 통신하는 코드입니다.
- 예: AWS, Claude, TTS, 이미지 생성, ffmpeg

### `apps/backend/src/modules`

- 현재 프로젝트의 워크플로우 실행용 모듈이 들어 있습니다.
- `blocks`: block executor 구현
- `orchestrator`: AI가 제안을 만드는 로직

### `libs/contracts`

- 프론트와 백엔드가 같이 쓰는 스키마입니다.
- `zod schema + type infer` 방식으로 관리합니다.
- API 요청/응답 구조가 바뀌면 **여기를 먼저 수정**합니다.

---

## 5. 실제 요청은 어떻게 흐르나

예를 들어 프론트가 flow 실행을 요청하면 대체로 이런 순서입니다.

```text
Frontend
  -> serverless.yml route
  -> handler
  -> service
  -> repository / adapter
  -> response
  -> (필요하면 WebSocket broadcast)
```

코드를 읽을 때는 보통 이 순서로 따라가면 됩니다.

- `serverless.yml`에서 어떤 path가 어떤 handler로 연결되는지 본다
- handler에서 어떤 service를 부르는지 본다
- service가 어떤 repository / adapter를 쓰는지 본다
- request/response shape는 `libs/contracts`에서 확인한다

---

## 6. 팀원 로컬 테스트 실행 방법

테스트 대상 브랜치:

```bash
codex/content-profile-longform-20260513
```

여러 명이 테스트할 때는 한 사람의 Mac에 접속하는 방식보다, 각자 자기 PC에서 같은 브랜치를 내려받아 `localhost`로 실행하는 방식을 권장합니다.

### 프로젝트 받기

처음 받는 경우:

```bash
git clone https://github.com/hansungMILK/KW-backend.git
cd KW-backend
git fetch origin
git checkout codex/content-profile-longform-20260513
yarn install
```

이미 프로젝트가 있는 경우:

```bash
cd KW-backend
git fetch origin
git checkout codex/content-profile-longform-20260513
git pull --ff-only
yarn install
```

### 준비

아래 파일이 이미 있으면 새로 만들 필요 없습니다.

```bash
apps/backend/.env
apps/web/.env.local
```

없을 때만 생성합니다.

**Mac / Linux**

```bash
cp apps/backend/.env.example apps/backend/.env
cp apps/web/.env.example apps/web/.env.local
```

**Windows PowerShell**

```powershell
Copy-Item apps/backend/.env.example apps/backend/.env
Copy-Item apps/web/.env.example apps/web/.env.local
```

**Windows CMD**

```cmd
copy apps\backend\.env.example apps\backend\.env
copy apps\web\.env.example apps\web\.env.local
```

### OpenAI 키 넣기

`apps/backend/.env` 파일을 열고 아래 값을 확인하거나 수정합니다.

```env
APP_API_KEY=local-test
ORCHESTRATOR_MODE=openai
AI_PROVIDER=openai
ALLOW_PAID_OPENAI=true
MAX_RUN_ESTIMATED_COST_USD=2
OPENAI_API_KEY=전달받은_OpenAI_API_Key
```

주의:

- `OPENAI_API_KEY`는 GitHub에 커밋하면 안 됩니다.
- 단톡방이나 README에 직접 올리지 말고, 개인 `apps/backend/.env`에만 넣습니다.
- 실제 유료 호출이 나가므로 `MAX_RUN_ESTIMATED_COST_USD=2`는 유지합니다.

### 프론트 설정 확인

`apps/web/.env.local` 파일에 아래 값이 들어 있으면 됩니다.

```env
VITE_ENV=LOCAL
VITE_PROJECT=FLOWS
VITE_API_URL=http://localhost:8800
VITE_WS_ENDPOINT=ws://localhost:8801
VITE_LOCAL_APP_API_KEY=local-test
```

### 백엔드 실행

**Mac / Linux**

```bash
yarn workspace @flows/backend start
```

**Windows**

```powershell
yarn workspace @flows/backend start:win
```

로컬에서 뜨는 기본 포트:

- HTTP API: `http://localhost:8800`
- WebSocket API: `ws://localhost:8801`

### 프론트 실행

**Mac / Linux**

```bash
yarn web:start
```

**Windows**

```powershell
yarn web:start:win
```

프론트 주소:

- `http://localhost:3000`

### API Key 입력

브라우저에서 API Key 입력창이 뜨면 아래 값을 입력합니다.

```text
local-test
```

### 테스트 예시

채팅창에 아래처럼 입력합니다.

```text
쇼츠 만들어줘. 주제는 토트넘 강등 위기
```

링크 기반 테스트:

```text
쇼츠 만들어줘. 주제는 이 링크 내용을 정보전달 유튜버처럼 만들어줘.
https://example.com/article
```

### 자주 나는 문제

`현재 OpenAI 실제 호출이 꺼져 있습니다`

- `apps/backend/.env`에서 `ALLOW_PAID_OPENAI=true`인지 확인합니다.
- 수정 후 백엔드를 껐다가 다시 켜야 합니다.

`Invalid API key`

- 브라우저 입력값이 `local-test`인지 확인합니다.
- `apps/backend/.env`에 `APP_API_KEY=local-test`가 있는지 확인합니다.
- 수정 후 백엔드를 재시작합니다.

예전 워크플로우가 계속 남아 있음

백엔드를 끄고 로컬 DB를 지운 뒤 다시 실행합니다.

```bash
rm -rf apps/backend/.local-db
```

브라우저 상태도 초기화하려면 개발자도구 Console에서 실행합니다.

```js
localStorage.removeItem('flows-current-flow-id');
localStorage.removeItem('x-api-key');
location.reload();
```

요약:

1. `codex/content-profile-longform-20260513` 브랜치로 이동
2. `apps/backend/.env`에 OpenAI 키 입력
3. `ALLOW_PAID_OPENAI=true` 확인
4. 백엔드 실행: `yarn workspace @flows/backend start`
5. 프론트 실행: `yarn web:start`
6. 접속: `http://localhost:3000`
7. API Key: `local-test`

---

## 7. 로컬에서 데이터가 어디 저장되는가

로컬 실행에서는 일부 데이터가 파일 기반 저장소로 저장됩니다.

- 현재 기준 진입점: `apps/backend/src/adapters/aws/dynamodb.ts`
- local 파일 저장 디렉토리: `apps/backend/.local-db/` 기준으로 생각하면 됩니다

즉, 로컬에서 테스트하다가 데이터를 초기화하고 싶으면 `.local-db`를 지우면 됩니다.

주의:

- 현재 프로젝트는 아직 구현 중이라 저장소가 완전히 통일된 상태는 아닙니다.
- 그래서 local/mock 기준으로 개발한다고 생각하는 것이 가장 편합니다.

---

## 8. 어디에 어떤 코드를 넣어야 하나

### 새 HTTP endpoint를 추가할 때

1. `libs/contracts`에 request/response schema 추가
2. `apps/backend/src/handlers/http/...`에 handler 추가
3. 필요하면 `services`에 비즈니스 로직 추가
4. 필요하면 `repositories`에 저장 로직 추가
5. `apps/backend/serverless.yml`에 route 연결

### 새 WebSocket 동작을 추가할 때

1. `handlers/ws` 확인
2. 필요 시 `services/websocket-service.ts` 활용
3. event payload가 바뀌면 `libs/contracts` 수정

### 새 외부 API 연동을 추가할 때

1. `adapters/...`에 구현
2. handler에서 직접 호출하지 말고 service 또는 module에서 사용
3. env가 필요하면 `config/env.ts`에 먼저 추가

### 새 비즈니스 규칙을 추가할 때

- `services`에 넣습니다.
- repository는 가능한 한 "읽기/쓰기"만 하게 둡니다.

---

## 9. 협업 규칙

이 프로젝트에서는 아래 규칙만 지켜도 협업이 훨씬 쉬워집니다.

### 규칙 1. API shape를 바꾸면 `libs/contracts`부터 수정

프론트와 백엔드가 서로 다른 shape를 생각하면 바로 깨집니다.

### 규칙 2. 새 env는 `config/env.ts`부터 추가

`process.env`를 파일마다 흩뿌리지 않습니다.

### 규칙 3. handler는 얇게 유지

handler 안에서는 되도록 이것만 합니다.

- 입력 읽기
- 스키마 검증
- service 호출
- 응답 반환

### 규칙 4. repository에는 비즈니스 판단을 넣지 않기

repository는 "저장/조회"만 담당합니다.

### 규칙 5. 외부 연동은 adapter로 빼기

Claude, OpenAI, AWS, 이미지 API 같은 것은 adapter로 보냅니다.

### 규칙 6. generic `types/` 폴더는 만들지 않기

타입은 아래 원칙으로 둡니다.

- 공용 계약 타입: `libs/contracts`
- 저장 타입: repository 옆
- 외부 API 타입: adapter 옆
- 내부 타입: service/module 옆

### 규칙 7. PR 하나에는 한 가지 목적만 담기

좋은 예:

- flow save API 수정
- run status 로직 수정
- settings API 추가

나쁜 예:

- run 수정 + README 대수정 + UI 수정 + env 구조 변경

---

## 10. 3명이 협업할 때 추천 작업 분리

초기에는 레이어 단위보다 **기능 단위 분리**가 더 안전합니다.

추천 예시는 아래와 같습니다.

- A: `flows / nodes / edges`
- B: `runs / execution / traces / assets`
- C: `messages / proposals / settings / websocket`

공용으로 자주 충돌하는 파일:

- `libs/contracts/**`
- `apps/backend/serverless.yml`
- `apps/backend/src/config/env.ts`

이 파일을 건드릴 때는 먼저 서로 알려주고 작업하는 것이 좋습니다.

---

## 11. 백엔드 초심자를 위한 읽는 순서

처음 코드를 읽을 때는 아래 순서를 추천합니다.

1. `apps/backend/serverless.yml`
2. `apps/backend/src/handlers/http/health.ts`
3. `flows` 관련 handler 하나
4. `run-service.ts`
5. `flow-repository.ts`
6. `libs/contracts/src/http/*`

이 순서로 보면 "라우팅 -> 요청 처리 -> 로직 -> 저장 -> 계약" 흐름이 잡힙니다.

---

## 12. 자주 쓰는 명령어

아래 명령어는 **Mac / Linux / Windows(PowerShell · CMD)** 모두 동일하게 동작합니다.

```bash
# backend 실행
yarn workspace @flows/backend start

# frontend 실행
yarn web:start

# 전체 lint
yarn lint

# 자동 수정 lint
yarn lint:fix

# 포맷팅
yarn prettier

# Nx 의존성 그래프 보기
yarn graph

# backend 타입 확인
npx tsc -p apps/backend/tsconfig.json --noEmit
```

> **Windows 참고** — `#` 주석은 PowerShell에서 그대로 사용 가능합니다. CMD에서는 `rem` 또는 `::` 을 사용하세요. `yarn` 명령어 자체는 변경 없이 동일합니다.

---

## 13. 작업 전에 체크할 것

- 내가 바꾸는 API shape가 `libs/contracts`와 맞는가
- env를 새로 쓰면 `config/env.ts`에 추가했는가
- handler에 로직이 너무 많이 들어가 있지 않은가
- 외부 API 호출을 adapter로 뺐는가
- 같은 기능을 다른 사람이 동시에 작업 중이지 않은가

---

## 14. 현재 기준으로 기억하면 좋은 한 줄 요약

- 이 프로젝트 백엔드는 **serverless handler 기반**이다
- API 계약은 **`libs/contracts`** 에서 관리한다
- 환경변수 진입점은 **`apps/backend/src/config/env.ts`** 이다
- 저장은 **repository**, 외부 연동은 **adapter**, 로직은 **service**
- 3명 협업 시에는 **기능 단위로 나눠서 작업**하는 것이 가장 안전하다

---

## 15. 커밋 메시지 형식

```text
type(scope): description

예시
feat(runs): add retry node handler
fix(flows): validate flow id before save
docs(readme): rewrite backend onboarding guide
```

---

## License

This project is licensed under the MIT License. See `LICENSE`.
