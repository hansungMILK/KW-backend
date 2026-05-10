# Eureka UI Playwright UAT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strengthen Playwright coverage so we can honestly answer whether the frontend lists blocks, opens the agent, adds nodes, and shows node output data.

**Architecture:** Keep the default UAT path free of paid OpenAI calls. Split checks into a deterministic local UI test and an opt-in AI workflow test guarded by environment flags. Store screenshots, body text, console logs, and API traces under `/Users/a0000/Downloads/eureka-ui-check` for user inspection. Use `E2E_OUTPUT_DIR=/path/to/dir` when a paid run needs a separate artifact directory.

**Tech Stack:** Playwright, Vite web app on `127.0.0.1:3001`, local backend API on `localhost:8800`, local WebSocket on `localhost:8801`, Yarn/Nx monorepo.

---

## Scope And Assumptions

- The active branch is `integration/jt-frontend-on-latest-backend`.
- The local app is already running:
    - Web: `http://127.0.0.1:3001`
    - Backend HTTP: `http://localhost:8800`
    - Backend WS: `ws://localhost:8801`
- The frontend app key for local testing is `local-test`.
- Default Playwright tests must not start paid OpenAI image/TTS/video generation.
- Any test that sends an AI workflow prompt must require `E2E_ALLOW_AGENT=1`.
- Any test that starts paid media generation must require `E2E_ALLOW_PAID_RUN=1`.

## Files

- Create: `docs/superpowers/plans/2026-05-10-eureka-ui-playwright-uat.md`
    - Documents the UAT contract, commands, and pass/fail criteria.
- Modify: `tests/e2e/eureka-ui-inspection.spec.ts`
    - Replace loose exploratory flow with assertion-backed checks.
    - Add helper functions for API key dialog, block library, Flow Agent, and screenshot/text capture.
- Modify: `playwright.config.ts`
    - Keep base URL and artifact behavior stable.
- Modify: `.gitignore`
    - Ignore generated `test-results/` and `playwright-report/`.
- Modify: `package.json`
    - Add a targeted `e2e:ui` script so teammates can repeat the same check.

## Pass Criteria

Default no-paid test must prove all of this:

- API key dialog accepts `local-test` and the page does not show `Invalid API key`.
- Block library opens and visibly lists core blocks:
    - `Text Input`
    - `트렌드 수집`
    - `스크립트 생성`
    - `이미지 생성`
    - `음성 생성`
    - `영상 합성`
    - `메타데이터 생성`
- Adding `Text Input` creates a node and persists via `POST /flows` then `PUT /flows/{flowId}`.
- Selecting `Text Input` shows the detail panel with `CONFIGURATION`, `OUTPUTS`, and `Run Block`.
- Filling the Text Input value and clicking `Run Block` shows the actual output value in the UI.
- The body text does not contain:
    - `Unknown block type: unknown`
    - `Invalid API key`
- The summary JSON explicitly records:
    - detected block names
    - detected node names
    - whether local output was visible
    - captured API statuses

Opt-in AI proposal test must prove all of this when `E2E_ALLOW_AGENT=1`:

- The Flow Agent button opens the chat panel.
- The initial helper text explains the agent purpose.
- Sending `입시정보 쇼츠 만들어줘` calls `POST /flows/{flowId}/messages`.
- A non-empty proposal card appears.
- Proposal card shows estimated cost and `$2.00` run cap.
- Clicking `승인` calls `POST /proposals/{proposalId}/approve`.
- Approved workflow places more than one proposed node on canvas.

Opt-in paid run test must prove all of this when `E2E_ALLOW_PAID_RUN=1`:

- Proposal estimated cost is shown before approval.
- The run starts only after explicit opt-in.
- Poll artifacts record run/node/asset state transitions.
- A completed run must expose a `VIDEO` asset.
- If a run hangs, the test must leave `run-polls.json` and screenshots for diagnosis.

## Task 1: Harden Deterministic UI Test

**Files:**

- Modify: `tests/e2e/eureka-ui-inspection.spec.ts`

- [x] **Step 1: Replace loose helper assertions with hard assertions**

Expected behavior:

```ts
expect(libraryText).toContain('Text Input');
expect(libraryText).toContain('트렌드 수집');
expect(libraryText).toContain('이미지 생성');
expect(summary.localOutputVisible).toBe(true);
```

- [x] **Step 2: Fill and run the Text Input node**

Expected Playwright flow:

```ts
await page.getByPlaceholder(/Enter text/i).fill('로컬 출력 검증');
await page.getByRole('button', { name: /Run Block|블록 실행/i }).click();
await expect(page.getByText('로컬 출력 검증')).toBeVisible();
```

- [x] **Step 3: Persist proof artifacts**

Expected output files:

```text
/Users/a0000/Downloads/eureka-ui-check/summary.json
/Users/a0000/Downloads/eureka-ui-check/api-responses.json
/Users/a0000/Downloads/eureka-ui-check/console.json
/Users/a0000/Downloads/eureka-ui-check/04-after-local-run.png
```

- [x] **Step 4: Run the default no-paid UAT**

Run:

```bash
yarn e2e:ui
```

Expected:

```text
1 passed
```

## Task 2: Add Opt-In Agent Proposal Test

**Files:**

- Modify: `tests/e2e/eureka-ui-inspection.spec.ts`

- [x] **Step 1: Guard AI test with `E2E_ALLOW_AGENT=1`**

Expected behavior:

```ts
test.skip(process.env.E2E_ALLOW_AGENT !== '1', 'Set E2E_ALLOW_AGENT=1 to call the AI proposal endpoint');
```

- [x] **Step 2: Open Flow Agent through the actual title**

Expected selector:

```ts
await page.getByTitle('Flow Agent').click();
await expect(page.getByText('무엇을 만들까요?')).toBeVisible();
```

- [x] **Step 3: Send prompt and assert real proposal surface**

Expected assertions:

```ts
await page.locator('textarea').last().fill('입시정보 쇼츠 만들어줘');
await page.keyboard.press('Enter');
await expect(page.getByText(/개 블록 생성/)).toBeVisible({ timeout: 30000 });
await expect(page.getByText('승인')).toBeVisible();
```

- [x] **Step 4: Approve and assert multiple workflow nodes**

Expected assertions:

```ts
await page.getByText('승인').click();
await expect(page.getByText('트렌드 수집')).toBeVisible({ timeout: 15000 });
await expect(page.getByText('영상 합성')).toBeVisible({ timeout: 15000 });
```

## Task 3: Repository Hygiene

**Files:**

- Modify: `.gitignore`
- Modify: `package.json`

- [x] **Step 1: Ignore Playwright generated output**

Add:

```gitignore
test-results/
playwright-report/
```

- [x] **Step 2: Add repeatable script**

Add:

```json
"e2e:ui": "playwright test tests/e2e/eureka-ui-inspection.spec.ts --project=chromium"
```

- [x] **Step 3: Verify no generated local artifacts are staged**

Run:

```bash
git status --short
```

Expected:

```text
test-results/ is not shown
playwright-report/ is not shown
```

## Task 4: Report The Result In Product Terms

**Files:**

- Read: `/Users/a0000/Downloads/eureka-ui-check/summary.json`
- Read: `/Users/a0000/Downloads/eureka-ui-check/api-responses.json`

- [x] **Step 1: Summarize what is proven**

Report:

```text
블록 나열: 통과/실패
수동 노드 추가: 통과/실패
출력 데이터 표시: 통과/실패
Flow Agent 열림: 통과/실패
AI proposal: 기본 테스트에서는 스킵 / opt-in 테스트에서 통과/실패
```

- [x] **Step 2: Summarize what is not yet proven**

Report:

```text
실제 OpenAI 이미지 생성, TTS, FFmpeg MP4 생성은 이 no-paid UI UAT 범위가 아님.
그 경로는 별도 paid smoke에서 2달러 한도와 cancel/timeout 보호를 켠 뒤 검증해야 함.
```

## Verification Commands

Run in this order:

```bash
yarn e2e:ui
npx nx run @flows/web:typecheck --skip-nx-cache
npx nx run @flows/web:lint --skip-nx-cache
git diff --check
```

Optional AI proposal check:

```bash
E2E_ALLOW_AGENT=1 yarn e2e:ui
```

Optional paid media check:

```bash
E2E_OUTPUT_DIR=/Users/a0000/Downloads/eureka-paid-run-check E2E_ALLOW_PAID_RUN=1 E2E_AGENT_PROMPT='일론머스크 일대기를 다룬 쇼츠 만들어줘' yarn e2e:ui
```

Do not run the paid media check unless the operator explicitly accepts real OpenAI image/TTS/video cost.

## Current Result

- `yarn e2e:ui`: PASS. Default no-paid UI UAT passed, with the AI proposal test intentionally skipped unless `E2E_ALLOW_AGENT=1`.
- `npx nx run @flows/web:typecheck --skip-nx-cache`: PASS.
- `npx nx run @flows/web:lint --skip-nx-cache`: PASS. Existing ESLint ignore-file deprecation warning only.
- `git diff --check`: PASS.
- Proof artifacts are written to `/Users/a0000/Downloads/eureka-ui-check`.
- Proven: block catalog listing, Text Input node addition, detail panel visibility, Run Block execution, and visible output data.
- Not proven in default test: AI proposal, approval-generated multi-node workflow, paid image/TTS/video run, and MP4 creation.

## Paid Run Result 2026-05-10

- Prompt: `일론머스크 일대기를 다룬 쇼츠 만들어줘`
- Proposal/approval: PASS.
- Estimated cost displayed by UI/API: `$0.92`, run cap `$2.00`.
- Full paid media execution generated:
    - 12 image assets
    - 1 narration audio asset
    - 1 MP4 video asset
- Saved MP4: `/Users/a0000/Downloads/eureka-paid-run-check/elon-musk-paid-run-output.mp4`
- MP4 verification:
    - duration: `59.975s`
    - video: H.264, `1080x1920`
    - audio: AAC
- Initial full run did not reach `COMPLETED` because the final `integration` node stayed `RUNNING` at 25% after video creation.
- Root fix applied after diagnosis:
    - OpenAI text/JSON calls now support timeout and abort signals.
    - `integration-block` passes the execution abort signal into optional metadata enhancement.
    - `integration-block` limits optional AI metadata enhancement to 15s and falls back to deterministic metadata.
- Post-fix targeted verification:
    - Reused the generated media-video output.
    - Ran only the `integration` node as a single-node run.
    - Result: `COMPLETED`, node progress `100`, output includes final `video`, `artifacts`, `hashtags`, and `seoMetadata`.
- Full 12-image paid run was not repeated after the fix to avoid extra OpenAI image-generation cost.
