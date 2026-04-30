# Purpose

이 프로젝트의 목표는 사용자가 "나 입시정보관련 쇼츠 만들어줘!"처럼 자연어로 요청하면, 입시/교육 정보를 기반으로 1분 내외의 세로형 쇼츠를 자동 생성하는 것이다.

핵심 산출물은 Sora 같은 단일 비디오 생성 결과가 아니다. 10~15개의 장면 이미지를 만들고, 각 장면에 쇼츠식 제목/자막 구성을 반영한 뒤, OpenAI TTS 더빙과 배경음악을 합성해 MP4 쇼츠로 조립한다.

## Product Shape

- 주제: 입시 정보, 대입 전략, 수능/정시/수시 이슈, 교육 트렌드.
- 형식: 9:16 YouTube Shorts/TikTok/Reels용 1분 내외 영상.
- 장면: 10~15장 이미지 기반 슬라이드형 쇼츠.
- 화면: 상단에는 영상 제목이 반복 노출되고, 장면마다 큰 한글 자막이 들어간다.
- 음성: OpenAI TTS 더빙을 기본으로 한다.
- 음악: 영상 합성 단계에서 낮은 볼륨의 배경음악 또는 대체 배경음을 깐다.
- 기본 OpenAI 모델:
    - 챗봇/오케스트레이터/비전: `gpt-5.4-nano`
    - 이미지: `gpt-image-2`
    - TTS: `gpt-4o-mini-tts`

## Non-goals

- Sora 영상 생성 API로 전체 영상을 한 번에 생성하지 않는다.
- 레거시 API를 즉시 삭제하지 않는다. 명세 API를 구현하고 alias는 프론트 전환 후 제거한다.
- "파일 형식만 MP4인 빈 placeholder"를 최종 영상으로 간주하지 않는다.

## Done Standard

OpenAI API key와 배포 환경이 준비된 상태에서, 사용자의 자연어 요청이 다음 경로를 끝까지 통과해야 한다.

1. `/flows/{flowId}/messages`로 요청 저장 및 Proposal 생성.
2. `proposal.created` WebSocket 발행.
3. Proposal 승인 후 Flow가 READY 상태가 됨.
4. `/flows/{flowId}/runs` 실행 시 누락 API key를 사전 차단.
5. 검색/스크립트/정규화/검수/이미지/TTS/영상/통합 블록이 DAG 순서대로 실행.
6. 최종 MP4, 이미지, 오디오 asset이 저장되고 public URL로 조회 가능.
7. `run.started`, `node.*`, `asset.created`, `run.completed` WebSocket 이벤트가 프론트에서 수신 가능.
