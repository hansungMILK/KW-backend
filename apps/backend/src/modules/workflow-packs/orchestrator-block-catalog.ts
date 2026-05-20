import type { AllowedBlockType } from '../orchestrator/response-parser';

export type WorkflowCapability =
    | 'input.text'
    | 'input.image'
    | 'output.preview'
    | 'utility.delay'
    | 'text.transform'
    | 'source.collect'
    | 'text.generate'
    | 'data.structure'
    | 'quality.review'
    | 'image.generate'
    | 'audio.tts'
    | 'video.compose'
    | 'metadata.generate'
    | 'longform.source'
    | 'longform.brief'
    | 'longform.script'
    | 'longform.storyboard'
    | 'longform.scene-json'
    | 'longform.review'
    | 'longform.srt-align'
    | 'longform.motion-compose'
    | 'longform.render'
    | 'longform.qa'
    | 'longform.package';

export interface BlockCatalogEntry {
    blockType: AllowedBlockType;
    label: string;
    capabilities: WorkflowCapability[];
    input: string;
    output: string;
    whenToUse: string;
    whenNotToUse: string;
}

export const ORCHESTRATOR_BLOCK_CATALOG: Record<AllowedBlockType, BlockCatalogEntry> = {
    'input-text': {
        blockType: 'input-text',
        label: '텍스트 입력',
        capabilities: ['input.text'],
        input: 'none',
        output: 'text',
        whenToUse: '사용자가 캔버스에서 실행 시점에 텍스트를 직접 입력해야 하는 수동 플로우',
        whenNotToUse: '채팅 요청 자체에 이미 필요한 주제가 들어 있는 자동 생성 플로우',
    },
    'input-image': {
        blockType: 'input-image',
        label: '이미지 입력',
        capabilities: ['input.image'],
        input: 'none',
        output: 'image',
        whenToUse: '사용자가 캔버스에서 이미지를 직접 넣어야 하는 수동 플로우',
        whenNotToUse: '이미지를 새로 생성하는 요청',
    },
    'output-preview': {
        blockType: 'output-preview',
        label: '결과 미리보기',
        capabilities: ['output.preview'],
        input: 'any',
        output: 'any',
        whenToUse: '최종 산출물을 캔버스에서 바로 확인해야 하는 경우',
        whenNotToUse: '최종 산출물이 별도 asset/video/integration 블록으로 충분히 표시되는 경우',
    },
    'buffer-delay': {
        blockType: 'buffer-delay',
        label: '지연',
        capabilities: ['utility.delay'],
        input: 'any',
        output: 'any',
        whenToUse: '자동화에서 의도적으로 실행 간격을 둬야 하는 경우',
        whenNotToUse: '일반 콘텐츠 생성 플로우',
    },
    'text-transform': {
        blockType: 'text-transform',
        label: '텍스트 변환',
        capabilities: ['text.transform'],
        input: 'text',
        output: 'text',
        whenToUse: '대소문자, trim, 간단한 텍스트 변환이 필요한 경우',
        whenNotToUse: 'AI가 새 내용을 작성하거나 요약해야 하는 경우',
    },
    search: {
        blockType: 'search',
        label: '자료 수집',
        capabilities: ['source.collect'],
        input: 'text query or upstream topic',
        output: 'json sources, keywords, trend score',
        whenToUse: '외부 자료, 최신성, 출처, URL, 사실 검증이 필요한 경우',
        whenNotToUse: '사용자가 단순 변환, 단일 이미지, 내부 텍스트 편집만 요청한 경우',
    },
    content: {
        blockType: 'content',
        label: '콘텐츠 생성',
        capabilities: ['text.generate'],
        input: 'json research or user topic',
        output: 'json script, prompt, message, or content plan',
        whenToUse: '문장, 대본, 설명, 프롬프트, 콘텐츠 구조가 필요한 경우',
        whenNotToUse: '원본 데이터를 그대로 전달만 하면 되는 경우',
    },
    data: {
        blockType: 'data',
        label: '데이터 정규화',
        capabilities: ['data.structure'],
        input: 'json',
        output: 'json structured data',
        whenToUse: '후속 블록이 읽기 쉬운 구조화 데이터가 필요한 경우',
        whenNotToUse: '단일 텍스트 결과만 필요한 간단한 요청',
    },
    analysis: {
        blockType: 'analysis',
        label: '품질 검수',
        capabilities: ['quality.review'],
        input: 'json content or structured data',
        output: 'json reviewed result',
        whenToUse: '사실성, 안전성, 형식, 출처 연결을 검수해야 하는 경우',
        whenNotToUse: '저위험 초안이나 사용자가 검수를 원하지 않는 단순 작업',
    },
    'media-image': {
        blockType: 'media-image',
        label: '이미지 생성',
        capabilities: ['image.generate'],
        input: 'json image prompts',
        output: 'json image assets',
        whenToUse: '이미지 또는 영상 장면 이미지가 필요한 경우',
        whenNotToUse: '텍스트, 데이터, 링크 요약만 필요한 경우',
    },
    'media-tts': {
        blockType: 'media-tts',
        label: '음성 생성',
        capabilities: ['audio.tts'],
        input: 'json narration/script',
        output: 'json audio assets',
        whenToUse: '나레이션, 더빙, 오디오가 필요한 경우',
        whenNotToUse: '텍스트나 이미지 결과만 필요한 경우',
    },
    'media-video': {
        blockType: 'media-video',
        label: '영상 합성',
        capabilities: ['video.compose'],
        input: 'json image/audio/video assets',
        output: 'json video asset',
        whenToUse: '최종 결과가 영상 파일이어야 하는 경우',
        whenNotToUse: '쇼츠/영상/MP4를 명시하지 않은 일반 텍스트·이미지 요청',
    },
    integration: {
        blockType: 'integration',
        label: '메타데이터 생성',
        capabilities: ['metadata.generate'],
        input: 'json final asset/content',
        output: 'json delivery metadata',
        whenToUse: '최종 산출물의 제목, 설명, 태그, 배포 메타데이터가 필요한 경우',
        whenNotToUse: '중간 결과 확인이나 단순 생성 요청',
    },
    'longform-source': {
        blockType: 'longform-source',
        label: '롱폼 자료 수집',
        capabilities: ['longform.source', 'source.collect'],
        input: 'user request, URLs, or topic',
        output: 'json primary sources, supporting sources, source digest, factual spine',
        whenToUse: '롱폼 제작에서 원문과 보조 자료를 먼저 정리해야 하는 경우',
        whenNotToUse: '쇼츠, 단일 이미지, 단순 텍스트 변환 요청',
    },
    'longform-brief': {
        blockType: 'longform-brief',
        label: '롱폼 관점 설계',
        capabilities: ['longform.brief'],
        input: 'longform source digest',
        output: 'json viewer promise, angle, structure, evidence plan',
        whenToUse: '롱폼의 관점과 논리 구조를 잡아야 하는 경우',
        whenNotToUse: '사용자가 쇼츠나 이미지 생성을 요청한 경우',
    },
    'longform-script': {
        blockType: 'longform-script',
        label: '롱폼 대본 작성',
        capabilities: ['longform.script', 'text.generate'],
        input: 'longform brief and source digest',
        output: 'json full script draft, sections, source map',
        whenToUse: '롱폼 내레이션 초안이 필요한 경우',
        whenNotToUse: '쇼츠 장면 대본 또는 단일 텍스트 결과가 필요한 경우',
    },
    'longform-storyboard': {
        blockType: 'longform-storyboard',
        label: '롱폼 스토리보드',
        capabilities: ['longform.storyboard'],
        input: 'longform script sections',
        output: 'json visual chapters and motion intent',
        whenToUse: '대본을 모션그래픽 visual chapter로 바꿔야 하는 경우',
        whenNotToUse: '이미지 프롬프트 중심 쇼츠 장면 생성',
    },
    'longform-scene-json': {
        blockType: 'longform-scene-json',
        label: '롱폼 장면 계약',
        capabilities: ['longform.scene-json'],
        input: 'longform storyboard',
        output: 'json HyperFrames/Remotion scene contract',
        whenToUse: 'renderer가 읽을 장면/모션 계약이 필요한 경우',
        whenNotToUse: '이미 렌더 가능한 비디오 asset이 있는 경우',
    },
    'longform-review': {
        blockType: 'longform-review',
        label: '롱폼 사용자 검수',
        capabilities: ['longform.review'],
        input: 'longform Gate A artifacts',
        output: 'json review artifact and decision state',
        whenToUse: '유료 제작 전 대본/스토리보드/scene JSON을 사용자에게 확인시킬 때',
        whenNotToUse: '승인 없이 바로 실행하는 저비용 텍스트 작업',
    },
    'longform-tts': {
        blockType: 'longform-tts',
        label: '롱폼 음성 생성',
        capabilities: ['audio.tts'],
        input: 'approved longform script',
        output: 'json TTS audio metadata',
        whenToUse: '승인된 롱폼 대본으로 내레이션을 만들 때',
        whenNotToUse: 'Gate A 승인 전',
    },
    'longform-srt-align': {
        blockType: 'longform-srt-align',
        label: '롱폼 자막 정렬',
        capabilities: ['longform.srt-align'],
        input: 'longform audio and script',
        output: 'json TTS-duration-aligned subtitle cues',
        whenToUse: '음성 기준 자막 타이밍이 필요한 경우',
        whenNotToUse: 'TTS 출력 timing cue가 없는 임시 시간 분배',
    },
    'longform-motion-compose': {
        blockType: 'longform-motion-compose',
        label: '롱폼 모션 설계',
        capabilities: ['longform.motion-compose'],
        input: 'scene JSON and subtitle cues',
        output: 'json composition artifact and motion cues',
        whenToUse: 'HyperFrames 모션그래픽 composition을 구성할 때',
        whenNotToUse: '정적 이미지 슬라이드쇼',
    },
    'longform-render': {
        blockType: 'longform-render',
        label: '롱폼 2K 렌더',
        capabilities: ['longform.render', 'video.compose'],
        input: 'composition, audio, subtitles, motion cues',
        output: 'json MP4 preview/download metadata',
        whenToUse: '승인된 롱폼을 실제 2K MP4로 렌더할 때',
        whenNotToUse: 'Gate A 승인 전 또는 비용 한도 초과 시',
    },
    'longform-qa': {
        blockType: 'longform-qa',
        label: '롱폼 QA',
        capabilities: ['longform.qa'],
        input: 'longform render output',
        output: 'json ffprobe and timing QA report',
        whenToUse: 'MP4를 완료 처리하기 전에 검증해야 하는 경우',
        whenNotToUse: '검증이 필요 없는 중간 산출물',
    },
    'longform-package': {
        blockType: 'longform-package',
        label: '롱폼 패키지',
        capabilities: ['longform.package', 'metadata.generate'],
        input: 'QA-passed longform artifacts',
        output: 'json downloadable package',
        whenToUse: 'MP4, SRT, 대본, source digest를 최종 묶음으로 제공할 때',
        whenNotToUse: 'QA를 통과하지 않은 영상',
    },
};

export const getBlockCatalogPrompt = (): string =>
    Object.values(ORCHESTRATOR_BLOCK_CATALOG)
        .map(
            block =>
                `- ${block.blockType}: ${block.label} | capabilities=${block.capabilities.join(
                    ', '
                )} | input=${block.input} | output=${block.output} | use=${block.whenToUse} | avoid=${block.whenNotToUse}`
        )
        .join('\n');
