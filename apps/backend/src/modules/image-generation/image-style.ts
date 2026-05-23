import { env } from '../../config/env';
import { isCountryballShortsRequest } from '../content-profile/content-profile';

export type ImageStyleId =
    | 'explainer-comic'
    | 'countryball-comic'
    | 'animation'
    | 'photo-real'
    | 'research-visual'
    | 'blueprint'
    | 'newspaper'
    | 'app-ui'
    | 'icon-design';

export type ImageQuality = 'low' | 'medium' | 'high';
export type ImageGenerationFormat = 'shorts-frame' | 'single-image';

export type ImageStylePreset = {
    id: ImageStyleId;
    label: string;
    description: string;
    promptPrefix: string;
};

export type ImageGenerationPreferences = {
    model: 'gpt-image-2';
    format: ImageGenerationFormat;
    recommendedStyleId: ImageStyleId;
    imageStyleId: ImageStyleId;
    imageStyleLabel: string;
    imageQuality: ImageQuality;
    sceneCount: number;
    imageEstimatedCostUsd: number;
    textAndOtherEstimatedCostUsd: number;
    estimatedTotalCostUsd: number;
    styleOptions: Array<Pick<ImageStylePreset, 'id' | 'label' | 'description'>>;
    sceneCountOptions: Array<{
        count: number;
        label: string;
    }>;
    qualityOptions: Array<{
        id: ImageQuality;
        label: string;
        estimatedImageCostUsd: number;
    }>;
};

export const GPT_IMAGE_MODEL = 'gpt-image-2' as const;
export const DEFAULT_SHORTS_SCENE_COUNT = 12;
export const SHORTS_SCENE_COUNT_OPTIONS = [8, 12, 16] as const;

export const IMAGE_STYLE_PRESETS: ImageStylePreset[] = [
    {
        id: 'explainer-comic',
        label: '정보전달 만화',
        description: '쇼츠 설명에 맞는 선명한 만화/밈 컷',
        promptPrefix:
            'Korean viral explainer comic style, bold expressive characters, crisp outlines, high contrast, clean mobile composition',
    },
    {
        id: 'countryball-comic',
        label: '컨트리볼 만화',
        description: '국가볼 캐릭터가 사용자 요청 상황을 재연하는 밈/만화 컷',
        promptPrefix:
            'countryball comic reenactment style, round flag-faced countryball characters, expressive eyes, simple arms, meme documentary composition, bold outlines, clean mobile frame, no hateful stereotypes',
    },
    {
        id: 'animation',
        label: '애니메이션',
        description: '감정이 분명한 애니메이션 장면',
        promptPrefix:
            'high-end Korean animation still, cinematic cel-shaded look, expressive faces, dynamic composition, polished lighting',
    },
    {
        id: 'photo-real',
        label: '실사풍',
        description: '현실 사진처럼 보이는 정보 장면',
        promptPrefix:
            'photorealistic editorial image, natural lighting, realistic people and objects, documentary-style composition',
    },
    {
        id: 'research-visual',
        label: '리서치 비주얼',
        description: '자료 조사, 분석, 대시보드 느낌',
        promptPrefix:
            'premium research explainer visual, abstract evidence board, charts and source cards, deep navy background',
    },
    {
        id: 'blueprint',
        label: '블루프린트',
        description: '구조/설계/기술 설명용 청사진',
        promptPrefix:
            'technical blueprint poster style, glowing line art, measured diagrams, precise engineering layout, concise readable labels allowed',
    },
    {
        id: 'newspaper',
        label: '신문/레트로',
        description: '논란, 사건, 이슈 정리용 신문 질감',
        promptPrefix:
            'retro newspaper editorial illustration, halftone texture, dramatic monochrome ink, front-page news composition',
    },
    {
        id: 'app-ui',
        label: '앱/UI 디자인',
        description: '앱 화면, 서비스, 결제 흐름 설명용',
        promptPrefix:
            'polished mobile app UI concept scene, floating interface cards with concise readable text when useful, modern product design lighting',
    },
    {
        id: 'icon-design',
        label: '아이콘/로고',
        description: '간단한 상징물, 아이콘, 로고 느낌',
        promptPrefix:
            'clean icon design system, simple geometric symbol, soft shadows, consistent palette, centered on minimal background',
    },
];

const IMAGE_STYLE_BY_ID = new Map(IMAGE_STYLE_PRESETS.map(style => [style.id, style]));

const GPT_IMAGE_2_VERTICAL_COST_USD: Record<ImageQuality, number> = {
    low: 0.005,
    medium: 0.041,
    high: 0.165,
};

export const normalizeImageQuality = (value: unknown): ImageQuality => {
    if (value === 'low' || value === 'medium' || value === 'high') return value;
    const envQuality = env.openaiImageQuality.toLowerCase();
    if (envQuality === 'low' || envQuality === 'high') return envQuality;
    return 'medium';
};

export const normalizeImageStyleId = (value: unknown): ImageStyleId | null => {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    return IMAGE_STYLE_BY_ID.has(normalized as ImageStyleId) ? (normalized as ImageStyleId) : null;
};

export const getImageStylePreset = (id: unknown): ImageStylePreset => {
    return IMAGE_STYLE_BY_ID.get(normalizeImageStyleId(id) ?? 'explainer-comic') ?? IMAGE_STYLE_PRESETS[0];
};

export const getImageSceneCostUsd = (quality: unknown): number => {
    return GPT_IMAGE_2_VERTICAL_COST_USD[normalizeImageQuality(quality)];
};

export const estimateGptImage2CostUsd = (sceneCount: number, quality: unknown): number => {
    return roundUsd(normalizeSceneCount(sceneCount, 1) * getImageSceneCostUsd(quality));
};

export const recommendImageStyleId = (userMessage: string, explicitStyle?: unknown): ImageStyleId => {
    const userRequestedStyle = detectUserRequestedImageStyleId(userMessage);
    if (userRequestedStyle) return userRequestedStyle;

    const explicit = normalizeImageStyleId(explicitStyle);
    if (explicit) return explicit;

    const text = userMessage.toLowerCase();
    if (/리서치|자료|분석|대시보드|research/.test(text)) return 'research-visual';
    if (/청사진|블루프린트|설계도|blueprint|기술|엔지니어/.test(text)) return 'blueprint';
    if (/신문|레트로|논란|대란|사건|news|newspaper/.test(text)) return 'newspaper';
    if (/앱|ui|ux|결제|서비스|화면/.test(text)) return 'app-ui';
    if (/아이콘|로고|icon|logo/.test(text)) return 'icon-design';
    return 'explainer-comic';
};

function detectUserRequestedImageStyleId(userMessage: string): ImageStyleId | null {
    const text = userMessage.toLowerCase();
    if (isCountryballShortsRequest(text)) return 'countryball-comic';
    if (/애니|animation|anime|cel[- ]?shade|셀/.test(text)) return 'animation';
    if (/실사|아이폰|iphone|사진|photo|photoreal|현실|realistic/.test(text)) return 'photo-real';
    if (/만화|웹툰|카툰|comic|cartoon|manga/.test(text)) return 'explainer-comic';
    if (/리서치\s*비주얼|research visual/.test(text)) return 'research-visual';
    if (/청사진|블루프린트|설계도|blueprint/.test(text)) return 'blueprint';
    if (/신문풍|신문\s*느낌|레트로|newspaper/.test(text)) return 'newspaper';
    if (/앱\s*ui|ui\s*디자인|app ui/.test(text)) return 'app-ui';
    if (/아이콘|로고|icon|logo/.test(text)) return 'icon-design';
    return null;
}

export const buildImageGenerationPreferences = (params: {
    userMessage: string;
    sceneCount: number;
    imageQuality?: unknown;
    imageStyleId?: unknown;
    format?: ImageGenerationFormat;
    textAndOtherEstimatedCostUsd?: number;
}): ImageGenerationPreferences => {
    const format = params.format ?? 'shorts-frame';
    const imageQuality = normalizeImageQuality(params.imageQuality);
    const recommendedStyleId = recommendImageStyleId(params.userMessage, params.imageStyleId);
    const preset = getImageStylePreset(recommendedStyleId);
    const sceneCount = normalizeSceneCount(params.sceneCount, DEFAULT_SHORTS_SCENE_COUNT);
    const imageEstimatedCostUsd = estimateGptImage2CostUsd(sceneCount, imageQuality);
    const textAndOtherEstimatedCostUsd = roundUsd(params.textAndOtherEstimatedCostUsd ?? 0);

    return {
        model: GPT_IMAGE_MODEL,
        format,
        recommendedStyleId,
        imageStyleId: recommendedStyleId,
        imageStyleLabel: preset.label,
        imageQuality,
        sceneCount,
        imageEstimatedCostUsd,
        textAndOtherEstimatedCostUsd,
        estimatedTotalCostUsd: roundUsd(imageEstimatedCostUsd + textAndOtherEstimatedCostUsd),
        styleOptions: IMAGE_STYLE_PRESETS.map(style => ({
            id: style.id,
            label: style.label,
            description: style.description,
        })),
        sceneCountOptions:
            format === 'single-image'
                ? [{ count: sceneCount, label: `${sceneCount}장` }]
                : SHORTS_SCENE_COUNT_OPTIONS.map(count => ({
                      count,
                      label: `${count}장`,
                  })),
        qualityOptions: (['low', 'medium', 'high'] as ImageQuality[]).map(quality => ({
            id: quality,
            label: quality,
            estimatedImageCostUsd: estimateGptImage2CostUsd(sceneCount, quality),
        })),
    };
};

export const enrichImageNodeConfig = (
    config: Record<string, unknown> | undefined,
    preferences: ImageGenerationPreferences
): Record<string, unknown> => {
    return {
        ...(config ?? {}),
        count: preferences.sceneCount,
        imageModel: GPT_IMAGE_MODEL,
        imageQuality: preferences.imageQuality,
        imageStyleId: preferences.imageStyleId,
        imageStyleLabel: preferences.imageStyleLabel,
    };
};

export const buildGptImage2ScenePrompt = (params: {
    styleId?: unknown;
    title?: string;
    caption?: string;
    narration?: string;
    visualPrompt?: string;
    sourceLabel?: string;
    presetImageRules?: string;
    format?: 'shorts-frame' | 'single-image';
}): string => {
    const preset = getImageStylePreset(params.styleId);
    const visualPrompt = sanitizeVisualPromptForStyle(preset.id, params.visualPrompt);
    const scene = compactPromptText(
        [
            visualPrompt,
            params.narration ? `Narration meaning: ${params.narration}` : undefined,
            params.caption ? `Subtitle meaning: ${params.caption}` : undefined,
            params.title ? `Persistent topic title meaning: ${params.title}` : undefined,
            params.sourceLabel ? `Factual source context: ${params.sourceLabel}` : undefined,
        ]
            .filter(Boolean)
            .join(' '),
        700
    );
    const format = params.format ?? 'shorts-frame';

    return [
        format === 'shorts-frame'
            ? 'Create one vertical 9:16 central illustration for a Korean YouTube Shorts video.'
            : 'Create one complete vertical 9:16 image.',
        `Visual style: ${preset.promptPrefix}.`,
        'Composition: one clear main subject, readable silhouette, strong foreground/background separation, mobile-first framing.',
        'Camera and lighting: cinematic depth, controlled contrast, professional finish, no clutter.',
        format === 'shorts-frame'
            ? 'Leave safe negative space near the top and bottom because the video compositor will add Korean title and subtitles.'
            : undefined,
        'Do not add unrelated text, fake logos, URLs, watermarks, or final-video title/subtitle bands. Short Korean or English in-scene signage, labels, screen text, or document text is allowed when it directly supports the scene.',
        'Factual visualization: represent the source claim visually without inventing exact documents, official seals, or fake screenshots.',
        compactPromptText(params.presetImageRules, 260),
        'If the scene brief contains art-style words that conflict with Visual style, follow Visual style and keep only the subject/action/setting.',
        `Scene: ${scene || 'Korean information explainer scene based on the user request.'}`,
    ]
        .filter(Boolean)
        .join(' ');
};

function sanitizeVisualPromptForStyle(styleId: ImageStyleId, prompt: string | undefined): string | undefined {
    if (!prompt) return prompt;

    const conflictPatterns: Partial<Record<ImageStyleId, RegExp[]>> = {
        'photo-real': [
            /\bcomic[- ]?style\b/gi,
            /\bcomic\b/gi,
            /\bcartoon\b/gi,
            /\bmanga\b/gi,
            /\banime\b/gi,
            /\banimation\b/gi,
            /\banimated\b/gi,
            /\bcel[- ]?shaded\b/gi,
        ],
        animation: [
            /\bphotorealistic\b/gi,
            /\brealistic photo\b/gi,
            /\breal photo\b/gi,
            /\biPhone photo\b/gi,
            /\bdocumentary photo\b/gi,
        ],
    };

    const patterns = conflictPatterns[styleId];
    if (!patterns) return prompt;

    return patterns
        .reduce((text, pattern) => text.replace(pattern, ' '), prompt)
        .replace(/\s+/g, ' ')
        .trim();
}

export const roundUsd = (value: number): number => Math.round(value * 1000) / 1000;

export function normalizeSceneCount(value: unknown, fallback: number): number {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
    return Math.max(1, Math.floor(fallback));
}

function compactPromptText(value: string | undefined, maxLength: number): string {
    if (!value) return '';
    const compact = value.replace(/\s+/g, ' ').trim();
    if (compact.length <= maxLength) return compact;
    return `${compact.slice(0, maxLength - 1).trim()}...`;
}
