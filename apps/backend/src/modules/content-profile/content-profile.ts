import { ContentProfileIdSchema, SHORTS_CONTENT_PROFILE_OPTIONS, ScriptToneIdSchema } from '@flows/contracts';

import type { ReviewModeSchema, ScriptToneIntensitySchema } from '@flows/contracts';
import type { z } from 'zod';

export type ScriptToneId = z.infer<typeof ScriptToneIdSchema>;

export type ScriptToneIntensity = z.infer<typeof ScriptToneIntensitySchema>;
export type ReviewMode = z.infer<typeof ReviewModeSchema>;
export type ContentProfileId = z.infer<typeof ContentProfileIdSchema>;
export type NarrativeMode = 'countryball-situation-reenactment';
export type RequestBasis = 'user-requested';

export type ContentProfilePreferences = {
    contentProfileId: ContentProfileId;
    scriptToneId: ScriptToneId;
    scriptToneIntensity: ScriptToneIntensity;
    reviewMode: ReviewMode;
    narrativeMode?: NarrativeMode;
    requestBasis?: RequestBasis;
    toneOptions: Array<{
        id: ScriptToneId;
        label: string;
        description: string;
    }>;
    intensityOptions: Array<{
        id: ScriptToneIntensity;
        label: string;
        description: string;
    }>;
    reviewModeOptions: Array<{
        id: ReviewMode;
        label: string;
        description: string;
    }>;
    profileOptions: Array<{
        id: ContentProfileId;
        label: string;
        description: string;
    }>;
};

export const SCRIPT_TONE_OPTIONS: ContentProfilePreferences['toneOptions'] = [
    {
        id: 'informative-reframe',
        label: '정보전달형',
        description: '문제를 다시 정의하고 핵심을 정리하는 톤',
    },
    {
        id: 'mz-viral',
        label: 'MZ 바이럴형',
        description: '가벼운 트렌드에 맞춘 빠른 말투',
    },
    {
        id: 'news-anchor',
        label: '뉴스앵커형',
        description: '공식 발표와 논란을 차분하게 전달하는 톤',
    },
    {
        id: 'story-dialogue',
        label: '이야기 진행형',
        description: '질문과 답변으로 이어지는 내러티브 톤',
    },
    {
        id: 'calm-explainer',
        label: '차분한 해설형',
        description: '롱폼과 교육형 설명에 맞는 안정적인 톤',
    },
];

export const SCRIPT_TONE_INTENSITY_OPTIONS: ContentProfilePreferences['intensityOptions'] = [
    { id: 'low', label: '절제', description: '톤 특징을 약하게 반영합니다.' },
    { id: 'medium', label: '표준', description: '톤 특징을 자연스럽게 반영합니다.' },
    { id: 'high', label: '강하게', description: '톤 특징을 더 선명하게 반영합니다.' },
];

export const REVIEW_MODE_OPTIONS: ContentProfilePreferences['reviewModeOptions'] = [
    {
        id: 'direct-run',
        label: '바로 실행',
        description: '승인 후 전체 워크플로우를 실행합니다.',
    },
    {
        id: 'script-first',
        label: '대본 검수 후 실행',
        description: '대본 단계에서 멈추고 수정본으로 이어갑니다.',
    },
];

export const CONTENT_PROFILE_OPTIONS: ContentProfilePreferences['profileOptions'] = [
    { id: 'text.explainer.v1', label: '텍스트 설명', description: '글 또는 요약 산출물' },
    { id: 'image.single.v1', label: '단일 이미지', description: '한 장 이미지 산출물' },
    ...SHORTS_CONTENT_PROFILE_OPTIONS,
    { id: 'shorts.story.v1', label: '쇼츠 제작', description: '이전 워크플로우 호환용 쇼츠 프로필' },
    { id: 'longform.explainer.v1', label: '롱폼 해설', description: '3-5분 이상 해설 영상' },
    { id: 'longform.documentary.v1', label: '롱폼 다큐', description: '자료 기반 다큐형 영상' },
];

const SCRIPT_TONE_IDS = new Set<ScriptToneId>(ScriptToneIdSchema.options);
const CONTENT_PROFILE_IDS = new Set<ContentProfileId>(ContentProfileIdSchema.options);

const contentProfileFamily = (id: ContentProfileId): string => id.split('.')[0] ?? id;

const profileOptionsFor = (contentProfileId: ContentProfileId): ContentProfilePreferences['profileOptions'] => {
    const family = contentProfileFamily(contentProfileId);
    if (family === 'shorts') {
        return [...SHORTS_CONTENT_PROFILE_OPTIONS];
    }
    return CONTENT_PROFILE_OPTIONS.filter(option => contentProfileFamily(option.id) === family);
};

export const isCountryballShortsRequest = (value: unknown): boolean => {
    if (typeof value !== 'string') return false;
    const text = value.trim().toLowerCase();
    if (!text) return false;
    if (
        /컨트리\s*볼|country\s*ball|countryball|poland\s*ball|polandball|폴란드\s*볼|국가\s*볼|국가\s*의인화/.test(text)
    ) {
        return true;
    }
    const nationalBall =
        /(?:한국|대한민국|조선|일본|미국|중국|러시아|영국|프랑스|독일|북한|남한|korea|japan|usa|china|russia)[-_\s]*볼/.test(
            text
        );
    const shortsOrStyle = /쇼츠|shorts|릴스|reels|틱톡|tiktok|상황극|재연|스타일|형식/.test(text);
    return nationalBall && shortsOrStyle;
};

export const normalizeScriptToneId = (value: unknown): ScriptToneId => {
    if (typeof value !== 'string') return 'informative-reframe';
    const normalized = value.trim().toLowerCase();
    if (SCRIPT_TONE_IDS.has(normalized as ScriptToneId)) return normalized as ScriptToneId;
    if (/뉴스\s*앵커|뉴스앵커|앵커\s*톤|앵커형|보도\s*톤|news\s*anchor/.test(normalized)) return 'news-anchor';
    if (/mz|바이럴|유행어|밈|viral|meme/.test(normalized)) return 'mz-viral';
    if (/대화|이야기|스토리|story|dialogue|narrative/.test(normalized)) return 'story-dialogue';
    if (/차분|해설|calm|explainer/.test(normalized)) return 'calm-explainer';
    return 'informative-reframe';
};

export const normalizeScriptToneIntensity = (value: unknown): ScriptToneIntensity => {
    if (value === 'low' || value === 'medium' || value === 'high') return value;
    if (typeof value !== 'string') return 'medium';
    const normalized = value.trim().toLowerCase();
    if (/약|절제|low/.test(normalized)) return 'low';
    if (/강|세게|high/.test(normalized)) return 'high';
    return 'medium';
};

export const normalizeReviewMode = (value: unknown): ReviewMode => {
    if (value === 'script-first' || value === 'direct-run') return value;
    if (typeof value !== 'string') return 'direct-run';
    const normalized = value.trim().toLowerCase();
    if (/대본\s*검수|검수\s*후|script[-_ ]?first|review/.test(normalized)) return 'script-first';
    return 'direct-run';
};

export const normalizeContentProfileId = (value: unknown): ContentProfileId | null => {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    return CONTENT_PROFILE_IDS.has(normalized as ContentProfileId) ? (normalized as ContentProfileId) : null;
};

export const inferContentProfileId = (params: {
    userMessage: string;
    outputType?: string;
    hasMediaVideo?: boolean;
    hasMediaImage?: boolean;
}): ContentProfileId => {
    const text = params.userMessage.toLowerCase();
    if (/롱폼|longform|긴\s*영상|다큐|documentary|5분|10분/.test(text)) {
        return /다큐|documentary/.test(text) ? 'longform.documentary.v1' : 'longform.explainer.v1';
    }
    if (isCountryballShortsRequest(params.userMessage)) {
        return 'shorts.countryball.v1';
    }
    if (/쇼츠|shorts|릴스|reels|틱톡|tiktok/.test(text) || params.hasMediaVideo || params.outputType === 'video') {
        return 'shorts.info.v1';
    }
    if (params.outputType === 'image' || params.hasMediaImage) return 'image.single.v1';
    return 'text.explainer.v1';
};

export const buildContentProfilePreferences = (params: {
    userMessage: string;
    outputType?: string;
    hasMediaVideo?: boolean;
    hasMediaImage?: boolean;
    scriptToneId?: unknown;
    scriptToneIntensity?: unknown;
    contentProfileId?: unknown;
    reviewMode?: unknown;
}): ContentProfilePreferences => {
    const contentProfileId =
        normalizeContentProfileId(params.contentProfileId) ??
        inferContentProfileId({
            userMessage: params.userMessage,
            outputType: params.outputType,
            hasMediaVideo: params.hasMediaVideo,
            hasMediaImage: params.hasMediaImage,
        });

    const scriptToneId =
        params.scriptToneId != null
            ? normalizeScriptToneId(params.scriptToneId)
            : contentProfileId === 'shorts.countryball.v1'
              ? 'story-dialogue'
              : normalizeScriptToneId(params.userMessage);

    return {
        contentProfileId,
        scriptToneId,
        scriptToneIntensity: normalizeScriptToneIntensity(params.scriptToneIntensity ?? params.userMessage),
        reviewMode: normalizeReviewMode(params.reviewMode ?? params.userMessage),
        ...(contentProfileId === 'shorts.countryball.v1'
            ? {
                  narrativeMode: 'countryball-situation-reenactment' as const,
                  requestBasis: 'user-requested' as const,
              }
            : {}),
        toneOptions: SCRIPT_TONE_OPTIONS,
        intensityOptions: SCRIPT_TONE_INTENSITY_OPTIONS,
        reviewModeOptions: REVIEW_MODE_OPTIONS,
        profileOptions: profileOptionsFor(contentProfileId),
    };
};

const CONTENT_PROFILE_CONTEXT_BLOCKS = new Set([
    'search',
    'countryball-brief',
    'countryball-script',
    'countryball-data',
    'countryball-analysis',
    'countryball-image',
    'countryball-tts',
    'countryball-video',
    'content',
    'data',
    'analysis',
    'media-image',
    'media-tts',
    'media-video',
    'integration',
    'longform-source',
    'longform-brief',
    'longform-script',
    'longform-storyboard',
    'longform-scene-json',
    'longform-review',
    'longform-tts',
    'longform-srt-align',
    'longform-motion-compose',
    'longform-render',
    'longform-qa',
    'longform-package',
]);

export const enrichContentProfileNodeConfig = (
    config: Record<string, unknown> | undefined,
    preferences: Pick<
        ContentProfilePreferences,
        'contentProfileId' | 'scriptToneId' | 'scriptToneIntensity' | 'reviewMode' | 'narrativeMode' | 'requestBasis'
    >,
    blockType: string
): Record<string, unknown> | undefined => {
    if (!CONTENT_PROFILE_CONTEXT_BLOCKS.has(blockType)) return config;
    const base = config ?? {};
    return {
        ...base,
        contentProfileId: preferences.contentProfileId,
        reviewMode: preferences.reviewMode,
        ...(preferences.narrativeMode ? { narrativeMode: preferences.narrativeMode } : {}),
        ...(preferences.requestBasis ? { requestBasis: preferences.requestBasis } : {}),
        ...(blockType === 'content' || blockType === 'longform-script'
            ? {
                  scriptToneId: preferences.scriptToneId,
                  scriptToneIntensity: preferences.scriptToneIntensity,
              }
            : {}),
    };
};
