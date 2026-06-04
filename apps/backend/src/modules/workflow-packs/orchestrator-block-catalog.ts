import type { AllowedBlockType } from '../orchestrator/response-parser';

export type WorkflowCapability =
    | 'input.text'
    | 'input.image'
    | 'output.preview'
    | 'utility.delay'
    | 'text.transform'
    | 'source.collect'
    | 'countryball.brief'
    | 'countryball.angle-lab'
    | 'countryball.writer-brain'
    | 'countryball.script'
    | 'countryball.data'
    | 'countryball.analysis'
    | 'countryball.image'
    | 'countryball.tts'
    | 'countryball.video'
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
    | 'longform.package'
    | 'blog.brief'
    | 'blog.research'
    | 'blog.outline'
    | 'blog.draft'
    | 'blog.image-plan'
    | 'blog.images'
    | 'blog.seo'
    | 'blog.assemble'
    | 'blog.export';

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
    'countryball-brief': {
        blockType: 'countryball-brief',
        label: '컨트리볼 기획 브리프',
        capabilities: ['countryball.brief'],
        input: 'json sources, request spec, and user countryball intent',
        output: 'json countryball source brief: target feature, conflict, visual facts, cast candidates',
        whenToUse: '사용자가 컨트리볼/국가볼/폴란드볼 쇼츠를 명시했을 때 search 뒤에서 전용 기획 재료를 정리하는 경우',
        whenNotToUse: '일반 쇼츠, 롱폼, 단일 이미지, 일반 텍스트 요청',
    },
    'countryball-angle-lab': {
        blockType: 'countryball-angle-lab',
        label: '컨트리볼 앵글 선택',
        capabilities: ['countryball.angle-lab'],
        input: 'countryball brief, user request, and optional sources',
        output: 'three selectable countryball skit angles plus recommended choice',
        whenToUse: '컨트리볼 대본 작성 전 작가 AI가 서로 다른 상황극 앵글 3개를 제안해야 할 때',
        whenNotToUse: '사용자가 이미 확정 대본을 제공했거나 일반 쇼츠 요청일 때',
    },
    'countryball-writer-brain': {
        blockType: 'countryball-writer-brain',
        label: '컨트리볼 작가 설계',
        capabilities: ['countryball.writer-brain'],
        input: 'selected countryball angle and optional user adjustment',
        output: 'binding writer brain, story brief, information control, and script rules',
        whenToUse: '선택된 앵글을 실제 장면 흐름과 강의 금지 규칙으로 확장해야 할 때',
        whenNotToUse: '일반 쇼츠, 롱폼, 단일 이미지, 일반 텍스트 요청',
    },
    'countryball-script': {
        blockType: 'countryball-script',
        label: '컨트리볼 대본 생성',
        capabilities: ['countryball.script'],
        input: 'countryball writer brain, story brief, and information control',
        output: 'json countryball dialogue skit contract with scenes, dialogueLines, captionOverlay, sfx, edit beats',
        whenToUse: '컨트리볼 전용 상황극 대본과 장면 계약을 작성할 때',
        whenNotToUse: '일반 쇼츠 대본, 롱폼 대본, 단일 이미지 프롬프트',
    },
    'countryball-data': {
        blockType: 'countryball-data',
        label: '컨트리볼 데이터 정규화',
        capabilities: ['countryball.data'],
        input: 'countryball script contract',
        output: 'json normalized countryball scenes preserving dialogueLines and captionOverlay',
        whenToUse: '컨트리볼 scene/caption/voice 계약을 후속 블록이 읽기 쉽게 정규화할 때',
        whenNotToUse: '일반 쇼츠 장면 정규화',
    },
    'countryball-analysis': {
        blockType: 'countryball-analysis',
        label: '컨트리볼 품질 검수',
        capabilities: ['countryball.analysis'],
        input: 'normalized countryball scenes',
        output: 'json countryball QA result plus normalized scenes for parallel media generation',
        whenToUse: '컨트리볼 대화 중심성, 행동 장면, captionOverlay 계약을 검수할 때',
        whenNotToUse: '일반 사실성/출처 검수',
    },
    'countryball-image': {
        blockType: 'countryball-image',
        label: '컨트리볼 이미지 생성',
        capabilities: ['countryball.image', 'image.generate'],
        input: 'countryball scenes with screenAction, cast, visualTone, props, expressionChanges',
        output: 'json countryball image assets and image prompts',
        whenToUse: '컨트리볼 장면을 정보패널이 아닌 상황극 컷 이미지로 생성할 때',
        whenNotToUse: '일반 쇼츠 이미지 생성',
    },
    'countryball-tts': {
        blockType: 'countryball-tts',
        label: '컨트리볼 음성 생성',
        capabilities: ['countryball.tts', 'audio.tts'],
        input: 'countryball dialogueLines with voiceRole',
        output: 'json role-voice TTS audio and subtitle cues',
        whenToUse: '국가볼 대사를 role-based ElevenLabs voice로 생성할 때',
        whenNotToUse: '일반 나레이션 TTS',
    },
    'countryball-video': {
        blockType: 'countryball-video',
        label: '컨트리볼 영상 합성',
        capabilities: ['countryball.video', 'video.compose'],
        input: 'countryball image assets, role-voice audio, captionOverlay, and timing cues',
        output: 'json countryball MP4 video asset',
        whenToUse: '컨트리볼 전용 captionOverlay와 dialogue 중심 영상 합성을 할 때',
        whenNotToUse: '일반 쇼츠 영상 합성',
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
    'blog-brief': {
        blockType: 'blog-brief',
        label: '블로그 브리프',
        capabilities: ['blog.brief'],
        input: 'user blog topic',
        output: 'json blog brief with keyword, audience, intent, angle, sourced facts',
        whenToUse: '네이버 복붙 완성형 블로그를 쓰기 전 키워드/독자/인텐트/각도를 정리할 때',
        whenNotToUse: '쇼츠/롱폼 기획, 단일 이미지 프롬프트',
    },
    'blog-research': {
        blockType: 'blog-research',
        label: '블로그 근거 수집',
        capabilities: ['blog.research', 'source.collect'],
        input: 'blog brief',
        output: 'json brief plus collected sources for factual topics (passthrough otherwise)',
        whenToUse: '사실형 블로그 주제의 근거를 search 블록으로 수집할 때',
        whenNotToUse: '근거가 필요 없는 창작/의견형 글',
    },
    'blog-outline': {
        blockType: 'blog-outline',
        label: '블로그 아웃라인',
        capabilities: ['blog.outline'],
        input: 'blog brief and optional sources',
        output: 'json H1 + 8–10 H2 outline with per-section length, supports a selection checkpoint',
        whenToUse: '블로그 목차를 만들고 사용자 목차 편집 체크포인트가 필요할 때',
        whenNotToUse: '본문 작성, 단일 이미지 생성',
    },
    'blog-draft': {
        blockType: 'blog-draft',
        label: '블로그 본문 초안',
        capabilities: ['blog.draft', 'text.generate'],
        input: 'selected blog outline plus grounded facts',
        output: 'json per-section blog body paragraphs',
        whenToUse: '아웃라인을 섹션별 본문으로 작성할 때(한 방 생성 금지)',
        whenNotToUse: '목차 설계, 영상 대본',
    },
    'blog-image-plan': {
        blockType: 'blog-image-plan',
        label: '블로그 이미지 배치 설계',
        capabilities: ['blog.image-plan'],
        input: 'drafted blog sections',
        output: 'json image slots with placement/sectionId/purpose/promptSource/caption/alt',
        whenToUse: '블로그 본문 내 이미지의 위치 계약을 설계할 때(개수가 아닌 위치)',
        whenNotToUse: '이미지 포함 토글이 꺼진 경우는 빈 슬롯을 반환',
    },
    'blog-images': {
        blockType: 'blog-images',
        label: '블로그 이미지 생성',
        capabilities: ['blog.images', 'image.generate'],
        input: 'blog image slots',
        output: 'json image slots with generated imageUrl filled (media-image 위임)',
        whenToUse: '이미지 슬롯의 promptSource로 본문 이미지를 생성할 때',
        whenNotToUse: '이미지 포함 토글이 꺼진 경우',
    },
    'blog-seo': {
        blockType: 'blog-seo',
        label: '블로그 SEO/AEO',
        capabilities: ['blog.seo', 'metadata.generate'],
        input: 'blog title and outline',
        output: 'json meta title/description/keywords and AEO summary',
        whenToUse: '블로그 메타데이터와 구조/AEO 요약을 생성할 때',
        whenNotToUse: '영상 배포 메타데이터',
    },
    'blog-assemble': {
        blockType: 'blog-assemble',
        label: '블로그 문서 조립',
        capabilities: ['blog.assemble'],
        input: 'drafted sections, image slots, seo, facts',
        output: 'json complete BlogDocument plus Naver-like previewModel',
        whenToUse: '본문과 이미지 슬롯을 placement대로 결합해 구조화 문서를 완성할 때',
        whenNotToUse: '마크다운만 필요한 단순 출력',
    },
    'blog-export': {
        blockType: 'blog-export',
        label: '블로그 내보내기',
        capabilities: ['blog.export'],
        input: 'BlogDocument',
        output: 'json naverHtml, markdown, imageManifest for copy-paste',
        whenToUse: '네이버 에디터 붙여넣기용 HTML/마크다운/이미지 매니페스트를 만들 때',
        whenNotToUse: '구조화 문서 조립 이전 단계',
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
