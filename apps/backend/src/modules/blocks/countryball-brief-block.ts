import { CountryballBriefOutputSchema } from './types';
import { openaiAdapter } from '../../adapters/ai/openai-adapter';
import { env } from '../../config/env';

import type { BlockExecutor, BlockExecutorResult } from './types';

export const COUNTRYBALL_BRIEF_SYSTEM_PROMPT = `You are a countryball skit writer brief strategist for Korean YouTube Shorts.
This is not a generic source search and not the final script.

Turn the user's countryball Shorts request and optional sources into a compact production brief that tells the script writer what the user actually wants.
The brief must make the topic actable as one Countryball situation skit before script generation begins.
Do not force one fixed plot. Choose the most useful story angle, cast, location, visual emotion, and payoff for the requested topic.
If the user provides an explicit plot order, preserve that plot order as binding. Do not replace it with a generic countryball angle.
The brief must preserve explicit user plot order.
Internally map the request before writing the brief: targetCountry, targetFeature, comparisonCountries, mainConflict, storyGenre, BGM_Track_A, BGM_Track_B, visualTheme, skitPremise, setting, comicMechanism, emotionalArc, payoff, speechFlavorPlan, and voiceRolePlan.
Choose a skit mechanism from the topic: doubt-test-shock, culture shock, meeting argument, historical reenactment, ranking comparison, rival banter, everyday misunderstanding, what-if chaos, or product showcase. These are writer choices, not hardcoded plots.
Choose recommendedSceneCount based on the story density, not a fixed default. Use 5-16 scenes for a 30-60 second Shorts video unless the user explicitly asks for another count.

Return JSON only:
{
  "targetCountry": "main country or character focus",
  "storyGenre": "history documentary / comedy / satire / infrastructure comparison / emotional challenge / etc",
  "targetFeature": "the concrete feature, event, system, product, culture, or situation to show",
  "mainConflict": "the core problem/tension that makes the skit understandable",
  "skitPremise": "one acted-out countryball situation",
  "setting": "concrete visual location",
  "comicMechanism": "why the skit is entertaining",
  "emotionalArc": "emotion progression",
  "payoff": "final visual or line",
  "recommendedSceneCount": number,
  "scriptVariables": {
    "targetCountry": "주인공 국가볼",
    "targetFeature": "사용자가 요청한 핵심 특징/사건/문화/제품",
    "comparisonCountries": ["대조 국가볼"],
    "mainConflict": "사용자가 요청한 핵심 갈등 또는 상황 변화",
    "storyGenre": "코미디 / 감동 / 풍자 / 정보 / 역사 중 주제에 맞는 장르",
    "BGM_Track_A": "초반 빌드업용 사운드",
    "BGM_Track_B": "클라이맥스 전환용 사운드",
    "visualTheme": "주제에 맞는 감정 변화"
  },
  "storyFlow": ["5-16 ordered beat descriptions, each drawable as action and matching recommendedSceneCount when possible"],
  "cast": [
    { "country": "주인공 국가볼", "role": "role in the skit", "defaultEmotion": "confident", "voiceRole": "main_confident" }
  ],
  "visualTheme": "challenge / comedy / culture shock / panic / emotional / etc",
  "soundMapping": { "opening": "...", "turn": "...", "payoff": "..." },
  "endingPayoff": "the short final image or line",
  "speechFlavorPlan": { "default": "readable Korean", "countryNotes": [] },
  "voiceRolePlan": { "main": "main_confident", "rival": "rival_smug", "panic": "panic_high" },
  "thumbnailTexts": ["short Korean thumbnail text"]
}`;

export const countryballBriefBlock: BlockExecutor = {
    blockType: 'countryball-brief',

    async execute(input: unknown, config?: Record<string, unknown>): Promise<BlockExecutorResult> {
        const start = Date.now();
        const requestTopic = extractRequestTopic(input, config);
        const passthrough = readPassthrough(input);

        if (env.orchestratorMode === 'mock') {
            const output = normalizeCountryballBriefOutput(
                {
                    targetCountry: detectTargetCountry(requestTopic),
                    storyGenre: '컨트리볼 상황극',
                    targetFeature: requestTopic,
                    mainConflict: '요청한 상황을 국가볼 캐릭터들이 행동과 반응으로 보여준다',
                    recommendedSceneCount: 5,
                    scriptVariables: {
                        targetCountry: `${detectTargetCountry(requestTopic)}공`,
                        targetFeature: requestTopic,
                        comparisonCountries: [],
                        mainConflict: '요청한 상황을 국가볼 캐릭터들이 행동과 반응으로 보여준다',
                        storyGenre: '컨트리볼 상황극',
                        BGM_Track_A: '빠른 훅',
                        BGM_Track_B: '짧은 임팩트',
                        visualTheme: '상황극',
                    },
                    storyFlow: [
                        '바로 문제 상황에 들어간다',
                        '관련 국가볼들이 짧게 반응한다',
                        '주인공 국가볼이 구체적인 행동을 시작한다',
                        '상황이 커지고 주변 국가볼이 당황한다',
                        '짧은 마지막 한 줄로 끝난다',
                    ],
                    cast: [{ country: detectTargetCountry(requestTopic), role: '주인공', voiceRole: 'main_confident' }],
                    visualTheme: '상황극',
                    soundMapping: { opening: '빠른 훅', payoff: '짧은 임팩트' },
                    endingPayoff: '주인공 국가볼의 짧은 반응으로 마무리',
                },
                requestTopic,
                passthrough
            );
            return { output, durationMs: Date.now() - start };
        }

        const response = await openaiAdapter.chatJson({
            model: env.openaiModel,
            systemPrompt: COUNTRYBALL_BRIEF_SYSTEM_PROMPT,
            userMessage: buildBriefUserMessage(requestTopic, passthrough),
            maxTokens: env.openaiContentMaxTokens,
        });
        const parsed = parseJsonLike(response.content);
        if (!parsed) {
            throw new Error(
                `[countryball-brief] OpenAI returned non-JSON response (length=${response.content.length})`
            );
        }

        const output = normalizeCountryballBriefOutput(parsed, requestTopic, passthrough);
        const validated = CountryballBriefOutputSchema.safeParse(output);
        if (!validated.success) {
            throw new Error(`[countryball-brief] Output schema validation failed: ${validated.error.message}`);
        }

        return { output: validated.data as Record<string, unknown>, durationMs: Date.now() - start };
    },
};

function buildBriefUserMessage(requestTopic: string, input: PassthroughInput): string {
    const parts = [`USER REQUEST:\n${requestTopic}`];
    if (input.requestSpec) parts.push(`REQUEST SPEC:\n${JSON.stringify(input.requestSpec)}`);
    if (input.keywords.length > 0) parts.push(`KEYWORDS:\n${input.keywords.join(', ')}`);
    if (input.articles.length > 0) {
        parts.push(
            [
                'OPTIONAL SOURCES:',
                ...input.articles
                    .slice(0, 5)
                    .map(article =>
                        [
                            `- ${String(article['title'] ?? '')}`,
                            `  URL: ${String(article['url'] ?? '')}`,
                            `  Summary: ${String(article['summary'] ?? article['fullText'] ?? '').slice(0, 800)}`,
                        ].join('\n')
                    ),
            ].join('\n')
        );
    }
    return parts.join('\n\n');
}

type PassthroughInput = {
    requestSpec?: Record<string, unknown>;
    keywords: string[];
    articles: Array<Record<string, unknown>>;
};

function readPassthrough(input: unknown): PassthroughInput {
    if (!isRecord(input)) return { keywords: [], articles: [] };
    return {
        requestSpec: isRecord(input['requestSpec']) ? input['requestSpec'] : undefined,
        keywords: Array.isArray(input['keywords']) ? input['keywords'].map(String) : [],
        articles: Array.isArray(input['articles'])
            ? input['articles'].filter((article): article is Record<string, unknown> => isRecord(article))
            : [],
    };
}

function normalizeCountryballBriefOutput(
    parsed: unknown,
    requestTopic: string,
    passthrough: PassthroughInput
): Record<string, unknown> {
    const root = isRecord(parsed) ? parsed : {};
    const rawBrief = isRecord(root['countryballBrief']) ? root['countryballBrief'] : root;
    const targetCountry = firstString(rawBrief['targetCountry'], detectTargetCountry(requestTopic));

    const recommendedSceneCount = readRecommendedSceneCount(
        rawBrief['recommendedSceneCount'],
        rawBrief['storyFlow'],
        requestTopic
    );
    const countryballBrief = {
        ...rawBrief,
        targetCountry,
        storyGenre: firstString(rawBrief['storyGenre'], '컨트리볼 상황극'),
        targetFeature: firstString(rawBrief['targetFeature'], requestTopic),
        mainConflict: firstString(rawBrief['mainConflict'], '요청한 상황의 핵심 긴장'),
        skitPremise: firstString(rawBrief['skitPremise'], firstString(rawBrief['mainConflict'], requestTopic)),
        setting: firstString(rawBrief['setting'], '컨트리볼 상황극 무대'),
        comicMechanism: firstString(rawBrief['comicMechanism'], '대사와 리액션으로 핵심 차이를 보여준다'),
        emotionalArc: firstString(rawBrief['emotionalArc'], '문제 제기 -> 반응 -> 행동 -> payoff'),
        payoff: firstString(rawBrief['payoff'], firstString(rawBrief['endingPayoff'], '짧은 마지막 반응')),
        recommendedSceneCount,
        scriptVariables: isRecord(rawBrief['scriptVariables']) ? rawBrief['scriptVariables'] : {},
        storyFlow: ensureStoryFlowLength(
            stringArray(rawBrief['storyFlow']),
            recommendedSceneCount,
            rawBrief,
            requestTopic
        ),
        cast: recordArray(rawBrief['cast']),
        visualTheme: firstString(rawBrief['visualTheme'], '상황극'),
        soundMapping: isRecord(rawBrief['soundMapping']) ? rawBrief['soundMapping'] : {},
        endingPayoff: firstString(rawBrief['endingPayoff'], '짧은 마지막 반응'),
        speechFlavorPlan: isRecord(rawBrief['speechFlavorPlan']) ? rawBrief['speechFlavorPlan'] : {},
        voiceRolePlan: isRecord(rawBrief['voiceRolePlan']) ? rawBrief['voiceRolePlan'] : {},
        thumbnailTexts: stringArray(rawBrief['thumbnailTexts']).slice(0, 5),
    };

    return {
        mode: 'countryball-brief',
        presetId: 'countryball-shorts',
        requestTopic,
        ...(passthrough.requestSpec ? { requestSpec: passthrough.requestSpec } : {}),
        keywords: passthrough.keywords,
        articles: passthrough.articles,
        countryballBrief,
    };
}

function ensureStoryFlowLength(
    storyFlow: string[],
    recommendedSceneCount: number,
    rawBrief: Record<string, unknown>,
    requestTopic: string
): string[] {
    const base = storyFlow.filter(Boolean);
    if (base.length >= recommendedSceneCount) return base.slice(0, recommendedSceneCount);

    const skitPremise = firstString(rawBrief['skitPremise'], requestTopic);
    const mainConflict = firstString(rawBrief['mainConflict'], '핵심 갈등');
    const targetFeature = firstString(rawBrief['targetFeature'], requestTopic);
    const payoff = firstString(rawBrief['payoff'], rawBrief['endingPayoff'], '짧은 마지막 반응');
    const genericBeats = [
        `${skitPremise}를 바로 보여주는 첫 상황`,
        `${mainConflict}에 관련 국가볼들이 짧게 반응한다`,
        `${targetFeature}를 소품이나 행동으로 꺼내 보인다`,
        `상대 국가볼이 오해하거나 의심하며 대사를 주고받는다`,
        `주인공 국가볼이 직접 행동으로 판을 바꾼다`,
        `상황이 커지고 주변 국가볼 표정이 크게 변한다`,
        `핵심 장면을 빠른 컷과 효과음으로 보여준다`,
        `상대 국가볼이 태세를 바꾸며 짧게 인정한다`,
        `${payoff}로 끝낸다`,
    ];

    const output = [...base];
    for (const beat of genericBeats) {
        if (output.length >= recommendedSceneCount) break;
        if (!output.includes(beat)) output.push(beat);
    }
    while (output.length < recommendedSceneCount) {
        output.push(`${targetFeature} 상황극 추가 리액션 ${output.length + 1}`);
    }
    return output;
}

function extractRequestTopic(input: unknown, config?: Record<string, unknown>): string {
    const fromConfig = firstString(config?.['topic'], config?.['userRequest'], config?.['query']);
    if (fromConfig) return fromConfig.slice(0, 500);
    if (typeof input === 'string') return input.slice(0, 500);
    if (!isRecord(input)) return '컨트리볼 쇼츠';
    return (
        firstString(
            input['requestTopic'],
            input['userRequest'],
            input['originalRequest'],
            input['topic'],
            input['query'],
            isRecord(input['requestSpec']) ? input['requestSpec']['userRequest'] : undefined
        ) ?? '컨트리볼 쇼츠'
    ).slice(0, 500);
}

function detectTargetCountry(text: string): string {
    if (/한국|대한민국|korea/i.test(text)) return '한국';
    if (/일본|japan/i.test(text)) return '일본';
    if (/미국|usa|america/i.test(text)) return '미국';
    if (/중국|china/i.test(text)) return '중국';
    return '주인공 국가볼';
}

function readRecommendedSceneCount(value: unknown, storyFlow: unknown, requestTopic: string): number {
    const explicit = detectRequestedSceneCount(requestTopic);
    if (explicit) return explicit;
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) return Math.min(16, Math.max(5, Math.round(parsed)));
    if (Array.isArray(storyFlow) && storyFlow.length > 0) return Math.min(16, Math.max(5, storyFlow.length));
    return 5;
}

function detectRequestedSceneCount(text: string): number | undefined {
    const match = text.match(/([\d,]{1,7})\s*(?:장|컷|씬|scene|scenes|images?)/i);
    if (!match) return undefined;
    const count = Number(match[1].replace(/,/g, ''));
    return Number.isFinite(count) && count > 0 ? Math.min(24, Math.floor(count)) : undefined;
}

function parseJsonLike(content: string): unknown | null {
    const direct = tryParseJson(content);
    if (direct) return direct;
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) {
        const parsed = tryParseJson(fenced);
        if (parsed) return parsed;
    }
    const extracted = extractFirstJsonObject(content);
    return extracted ? tryParseJson(extracted) : null;
}

function extractFirstJsonObject(content: string): string | null {
    const start = content.indexOf('{');
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < content.length; index += 1) {
        const char = content[index];
        if (inString) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') inString = false;
            continue;
        }
        if (char === '"') inString = true;
        else if (char === '{') depth += 1;
        else if (char === '}') {
            depth -= 1;
            if (depth === 0) return content.slice(start, index + 1);
        }
    }
    return null;
}

function tryParseJson(content: string): unknown | null {
    try {
        return JSON.parse(content.trim());
    } catch {
        return null;
    }
}

function isRecord(input: unknown): input is Record<string, unknown> {
    return input != null && typeof input === 'object' && !Array.isArray(input);
}

function firstString(...values: unknown[]): string | undefined {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
}

function stringArray(input: unknown): string[] {
    if (!Array.isArray(input)) return [];
    return input.map(item => String(item).trim()).filter(Boolean);
}

function recordArray(input: unknown): Array<Record<string, unknown>> {
    if (!Array.isArray(input)) return [];
    return input.filter((item): item is Record<string, unknown> => isRecord(item));
}
