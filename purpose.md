# Purpose

이 프로젝트의 본질은 **자연어로 지시하면 AI가 자동화 워크플로우를 직접 설계하고 실행해주는 범용 플랫폼**이다.
한 줄로 보면 **"n8n(노드/엣지 자동화) + 서버리스(Lambda) + AI 오케스트레이터"** 다.

사용자가 "이런 거 만들어줘"라고 말하면, AI가 논점을 파악하고, 어떤 블록을 어떤 순서로 놓을지 스스로 설계해
노드/엣지 그래프(Flow)를 만든 뒤, 서버리스 DAG로 실행한다. 산출물은 쇼츠 영상에 한정되지 않으며,
글·이미지·롱폼 영상 등 블록 조합으로 만들 수 있는 무엇이든 자동 생성한다. 쇼츠는 그 위에서 도는 대표 사용 사례 중 하나일 뿐이다.

n8n과의 결정적 차이는, **노드를 사람이 손으로 까는 게 아니라 AI 오케스트레이터가 자연어로부터 워크플로우를 자동 작성한다**는 점이다.

## 핵심 루프 (자연어 → 자동 설계 → 실행)

1. **자연어 입력** — `POST /flows/{flowId}/messages` 로 요청을 저장한다.
2. **논점 파악 (intent 분류)** — `classifyMessageIntent`가 단순 대화(chat)인지 워크플로우 생성 의도(proposal)인지 분류한다.
3. **블록 설계 (proposal 생성)** — `orchestrator.generateProposal`이 block-catalog에서 필요한 블록을 골라(`selectedBlocks`) `workflow-compiler`로 노드/엣지 그래프를 컴파일한다. orchestrator는 `ORCHESTRATOR_MODE`로 mock/openai/claude 교체 가능.
4. **실행** — Proposal 승인 → Flow가 READY → `/flows/{flowId}/runs` → 블록들이 DAG 순서로 실행되고 WebSocket으로 상태가 스트리밍된다.

## Product Shape

- **단위:** 노드(블록) + 엣지로 구성된 워크플로우(Flow). 사람이 ReactFlow 캔버스에서 수동 편집할 수도, AI가 자동 생성할 수도 있으며 둘은 같은 그래프 모델(zod contracts)을 공유한다.
- **도메인:** 특정 주제에 묶이지 않는다(domain-agnostic). 입력 자연어의 주제가 곧 산출물의 주제가 된다.
- **산출물 종류(블록 조합):**
    - **쇼츠 영상:** 9:16 1분 내외, 이미지 10~15장 슬라이드형. 상단 제목 반복 노출 + 장면별 큰 한글 자막 + TTS 더빙 + 배경음악 합성 MP4.
    - **롱폼 영상:** 장문 대본 → 스토리보드 → 장면 계약 → 2K MP4 렌더(HyperFrames 경로). 유료 제작 전 사용자 검수 게이트(Gate A) 통과.
    - **글/이미지 단독:** 영상 없이 텍스트 변환·요약·이미지 생성만으로 끝나는 플로우도 조립 가능.
- **멀티 프로바이더:** 각 블록이 OpenAI/Claude/ElevenLabs 등 어댑터를 호출. provider/모델 교체 가능.
- **기본 프로바이더/모델(쇼츠 프리셋 기준):**
    - 챗봇/오케스트레이터/비전: OpenAI `gpt-5.4-nano`
    - 이미지: OpenAI `gpt-image-2`
    - 음성(TTS): **ElevenLabs 기본** (키 없으면 OpenAI `gpt-4o-mini-tts`로 폴백)

## 쇼츠 프리셋 메모 (대표 사용 사례)

쇼츠의 핵심 산출물은 Sora 같은 단일 비디오 생성 결과가 아니다. 10~15개의 장면 이미지를 만들고,
각 장면에 쇼츠식 제목/자막 구성을 반영한 뒤, TTS 더빙(ElevenLabs 기본, OpenAI 폴백)과 배경음악을 합성해 MP4 쇼츠로 조립한다.
영상 합성 단계에서 낮은 볼륨의 배경음악 또는 대체 배경음을 깐다.

## Non-goals

- Sora 영상 생성 API로 전체 영상을 한 번에 생성하지 않는다(쇼츠/롱폼 모두 장면 조립 방식).
- 레거시 API를 즉시 삭제하지 않는다. 명세 API를 구현하고 alias는 프론트 전환 후 제거한다.
- "파일 형식만 MP4인 빈 placeholder"를 최종 영상으로 간주하지 않는다.
- 특정 도메인(예: 특정 주제 콘텐츠)에 엔진 로직을 하드코딩하지 않는다. 콘텐츠 라인은 별도 블록 모듈로 분리하고, 범용 블록에 도메인 전용 if문을 섞지 않는다.

## Done Standard

OpenAI API key와 배포 환경이 준비된 상태에서, 사용자의 자연어 요청이 다음 경로를 끝까지 통과해야 한다.

1. `/flows/{flowId}/messages`로 요청 저장 및 (워크플로우 의도일 때) Proposal 생성.
2. `proposal.created` WebSocket 발행.
3. Proposal 승인 후 Flow가 READY 상태가 됨.
4. `/flows/{flowId}/runs` 실행 시 누락 API key를 사전 차단.
5. AI가 설계한 블록(예: 검색/스크립트/정규화/검수/이미지/TTS/영상/통합)이 DAG 순서대로 실행.
6. 최종 산출물 asset(MP4, 이미지, 오디오, 텍스트 등)이 저장되고 public URL로 조회 가능.
7. `run.started`, `node.*`, `asset.created`, `run.completed` WebSocket 이벤트가 프론트에서 수신 가능.
