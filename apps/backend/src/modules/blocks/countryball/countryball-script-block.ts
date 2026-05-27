import {
    COUNTRYBALL_NARRATIVE_MODE,
    COUNTRYBALL_PRESET_ID,
    COUNTRYBALL_ROLE_VOICE_FALLBACKS,
    compactCountryballText,
    normalizeCountryballVoiceRole,
} from './countryball-scene-contract';
import { openaiAdapter } from '../../../adapters/ai/openai-adapter';
import { env } from '../../../config/env';
import { CountryballScriptOutputSchema } from '../types';

import type { BlockExecutor, BlockExecutorResult } from '../types';
import type {
    CountryballCaptionOverlay,
    CountryballCastMember,
    CountryballDialogueLine,
    CountryballScene,
} from './countryball-scene-contract';

export const COUNTRYBALL_SCRIPT_SYSTEM_PROMPT = `You are a Korean Countryball YouTube Shorts skit writer.
Countryball is not a narrator explainer style. It is a short situation skit where countryballs show the user's requested topic through action, reactions, expressions, props, and fast dialogue.

Hard rules:
- Do not use a fixed plot template. Choose the cast, location, conflict, rhythm, and ending that fit the topic.
- The explicit user plot is binding. If the user says "ignore -> test -> surprise -> reorder", preserve that beat order and translate it into Countryball skit scenes.
- If the input includes a recommended or user-selected scene count, return exactly the requested scene count. If no count is provided, choose the number of scenes from story density and keep the returned scenes length equal to that choice.
- The whole output must feel like one continuous skit, not disconnected facts.
- Before writing scenes, use the brief's scriptVariables or infer them: targetCountry, targetFeature, comparisonCountries, mainConflict, storyGenre, BGM_Track_A, BGM_Track_B, visualTheme, skitPremise, setting, comicMechanism, emotionalArc, payoff, speechFlavorPlan, and voiceRolePlan.
- Use the brief's skitPremise, setting, comicMechanism, emotionalArc, payoff, and storyFlow as the spine when present.
- Use a Shorts-native dramatic arc when it fits: context/setup, build-up, turning point/BGM switch, showcase/climax, resolution/ending. Do not force this arc when the user plot clearly needs a different shape.
- Most information must be carried by short countryball dialogue and visible action, not narrator explanation.
- Each normal scene should be a call-and-response beat between countryballs unless it is a title, silent reaction, or ending payoff scene.
- The first 3 seconds must start with a visible problem, strange situation, or direct line.
- narratorLine is null by default. Use it only for a short title card, time jump, or ending meta caption.
- Every normal scene needs screenAction, scenePurpose, expressionChanges, sfx, editBeat, and captionOverlay.
- captionOverlay is for video editing, not image generation. Dialogue captions should anchorTarget "speaker".
- Image prompts must avoid embedded Korean text. Captions are added later in video.
- Use role-based voices, not fixed country voices: narrator_short, main_tired, main_confident, rival_smug, rival_angry, neutral_serious, panic_high, deep_serious, old_teacher.
- Korean dialogue should have light Countryball character flavor without becoming unreadable. 미국 볼 uses 외국인 교포 말투.
- 일본 볼 may use short natural gag lines only when useful, such as "말도 안 되므니다!", "잠깐만 데스!", or "이건 반칙데스!".
- Do not mechanically append suffixes to every sentence. If a Korean sentence already ends with 요, 네요, 합니다, 하지, or 입니다, do not append 데스.
- Unknown countries use neutral readable Korean unless the brief provides a speechFlavorPlan.

Return JSON only:
{
  "title": "short Korean title",
  "topic": "topic",
  "recommendedSceneCount": number,
  "cast": [
    { "country": "주인공 국가볼", "role": "main character", "defaultEmotion": "confident", "voiceRole": "main_confident" }
  ],
  "scenes": [
    {
      "sceneId": "scene-01",
      "sceneNumber": 1,
      "timeRange": "0-3s",
      "scenePurpose": "why this scene exists",
      "location": "visual location",
      "visualTone": "comedy|panic|serious|satirical|emotional|hopeful",
      "screenAction": "visible countryball action, not explanation",
      "dialogueLines": [
        { "country": "주인공 국가볼", "line": "short subtitle-ready line", "tone": "confident", "voiceRole": "main_confident" }
      ],
      "expressionChanges": ["eyes, sweat, tears, shock, smirk, etc"],
      "sfx": ["short sound cue"],
      "editBeat": "zoom/cut/pause/BGM change",
      "narratorLine": null,
      "captionOverlay": [
        { "type": "dialogue", "text": "short line", "speakerCountry": "주인공 국가볼", "anchorTarget": "speaker", "preferredPosition": "middle-right", "style": "yellowBlack" }
      ],
      "props": ["visible props"],
      "durationSec": 4
    }
  ],
  "thumbnailTexts": ["short Korean thumbnail text"]
}`;

export const countryballScriptBlock: BlockExecutor = {
    blockType: 'countryball-script',

    async execute(input: unknown, config?: Record<string, unknown>): Promise<BlockExecutorResult> {
        const start = Date.now();
        const topic = extractTopic(input, config);
        const brief = extractBrief(input);
        const sceneCount = resolveSceneCount(input, config, brief);

        if (env.orchestratorMode === 'mock') {
            const output = normalizeCountryballScriptOutput(
                buildFallbackScript(
                    topic,
                    brief,
                    sceneCount ?? readSceneCount(brief?.['recommendedSceneCount'], 5) ?? 5
                ),
                topic,
                brief,
                sceneCount
            );
            return { output, durationMs: Date.now() - start };
        }

        const response = await openaiAdapter.chatJson({
            model: env.openaiModel,
            systemPrompt: COUNTRYBALL_SCRIPT_SYSTEM_PROMPT,
            userMessage: buildScriptUserMessage(topic, brief, sceneCount, input),
            maxTokens: env.openaiCountryballContentMaxTokens,
        });
        const parsed = parseJsonLike(response.content);
        if (!parsed) {
            throw new Error(
                `[countryball-script] OpenAI returned non-JSON response (length=${response.content.length})`
            );
        }

        const output = normalizeCountryballScriptOutput(parsed, topic, brief, sceneCount);
        const validated = CountryballScriptOutputSchema.safeParse(output);
        if (!validated.success) {
            throw new Error(`[countryball-script] Output schema validation failed: ${validated.error.message}`);
        }

        return { output: validated.data as Record<string, unknown>, durationMs: Date.now() - start };
    },
};

function buildScriptUserMessage(
    topic: string,
    brief: Record<string, unknown> | undefined,
    sceneCount: number | undefined,
    input: unknown
): string {
    return [
        `USER REQUEST:\n${topic}`,
        sceneCount
            ? `SCENE COUNT:\n${sceneCount}\nReturn exactly ${sceneCount} scenes.`
            : 'SCENE COUNT:\nAI_DECIDES\nChoose a scene count from 5-16 based on story density, then return that exact number of scenes.',
        brief ? `COUNTRYBALL BRIEF:\n${JSON.stringify(brief)}` : undefined,
        isRecord(input) && Array.isArray(input['articles'])
            ? `OPTIONAL SOURCES:\n${JSON.stringify(input['articles']).slice(0, 5000)}`
            : undefined,
        [
            'Write a complete countryball dialogue skit contract.',
            'Preserve the explicit user plot order when the request contains one.',
            'COUNTRYBALL SKIT SPINE: Use skitPremise, setting, comicMechanism, emotionalArc, payoff, storyFlow, speechFlavorPlan, and voiceRolePlan from the brief. If they are present, they are binding.',
            'Include recommendedSceneCount equal to scenes.length.',
            'Do not write narrator-only explanation.',
            'Do not put captions inside image prompts.',
            'The final scenes must be understandable from countryball action, expression, and dialogue.',
        ].join('\n'),
    ]
        .filter(Boolean)
        .join('\n\n');
}

function buildFallbackScript(
    topic: string,
    brief: Record<string, unknown> | undefined,
    sceneCount: number
): Record<string, unknown> {
    const cast = normalizeCast(brief?.['cast'], topic, brief);
    const primary = cast[0] ?? defaultCast(topic)[0];
    const secondary = cast[1] ?? defaultCast(topic)[1];
    const flow = Array.isArray(brief?.['storyFlow']) ? brief?.['storyFlow'].map(String).filter(Boolean) : [];
    const title = compactCountryballText(brief?.['targetFeature'], topic).slice(0, 40);
    return {
        title,
        topic,
        recommendedSceneCount: sceneCount,
        cast,
        scenes: Array.from({ length: sceneCount }, (_, index) => {
            const sceneNumber = index + 1;
            const beat = compactCountryballText(flow[index % Math.max(1, flow.length)], topic);
            const firstLine = dialogueLineFromBeat(beat, primary.country);
            const secondLine = dialogueLineFromBeat(beat, secondary.country);
            return {
                sceneId: `scene-${String(sceneNumber).padStart(2, '0')}`,
                sceneNumber,
                timeRange: timeRangeForScene(sceneNumber, sceneCount),
                scenePurpose: beat,
                location: compactCountryballText(
                    brief?.['location'],
                    compactCountryballText(brief?.['visualTheme'], title)
                ),
                visualTone: compactCountryballText(brief?.['visualTheme'], 'skit'),
                screenAction: `${primary.country} and ${secondary.country} countryballs visibly act out: ${beat}`,
                dialogueLines: [
                    {
                        country: primary.country,
                        line: firstLine,
                        tone: compactCountryballText(primary.defaultEmotion, 'reactive'),
                        voiceRole: primary.voiceRole ?? 'main_confident',
                    },
                    {
                        country: secondary.country,
                        line: secondLine,
                        tone: compactCountryballText(secondary.defaultEmotion, 'reactive'),
                        voiceRole: secondary.voiceRole ?? 'panic_high',
                    },
                ],
                expressionChanges: [`${primary.country} expression changes`, `${secondary.country} reaction changes`],
                sfx: stringArray(brief?.['sfx']).slice(0, 3),
                editBeat: compactCountryballText(brief?.['editBeat'], `Cut on beat ${sceneNumber}`),
                narratorLine:
                    sceneNumber === 1
                        ? { text: compactCountryballText(topic).slice(0, 24), voiceRole: 'narrator_short' }
                        : null,
                captionOverlay: [
                    {
                        type: sceneNumber === 1 ? 'title' : 'dialogue',
                        text: sceneNumber === 1 ? compactCountryballText(topic).slice(0, 24) : firstLine,
                        speakerCountry: sceneNumber === 1 ? undefined : primary.country,
                        anchorTarget: sceneNumber === 1 ? 'topBand' : 'speaker',
                        preferredPosition: sceneNumber === 1 ? 'upper-center' : 'middle-right',
                        style: sceneNumber === 1 ? 'titleBand' : 'yellowBlack',
                    },
                ],
                props: stringArray(brief?.['props']).slice(0, 5),
                durationSec: 4,
            };
        }),
        thumbnailTexts: stringArray(brief?.['thumbnailTexts']).slice(0, 5),
    };
}

function normalizeCountryballScriptOutput(
    parsed: unknown,
    topic: string,
    brief: Record<string, unknown> | undefined,
    sceneCount: number | undefined
): Record<string, unknown> {
    const root = isRecord(parsed) ? parsed : {};
    const title = compactCountryballText(root['title'], compactCountryballText(brief?.['targetFeature'], topic));
    const cast = normalizeCast(root['cast'], topic, brief);
    const resolvedSceneCount = resolveOutputSceneCount(root, brief, sceneCount);
    const scenes = normalizeScenes(root['scenes'], cast, topic, resolvedSceneCount);
    return {
        mode: 'countryball-script',
        presetId: COUNTRYBALL_PRESET_ID,
        narrativeMode: COUNTRYBALL_NARRATIVE_MODE,
        title,
        topic,
        cast,
        scenes,
        thumbnailTexts: stringArray(root['thumbnailTexts']).slice(0, 5),
        metadata: {
            title,
            topic,
            presetId: COUNTRYBALL_PRESET_ID,
            contentProfileId: 'shorts.countryball.v1',
            narrativeMode: COUNTRYBALL_NARRATIVE_MODE,
            imageStyleId: 'countryball-comic',
            recommendedSceneCount: scenes.length,
            ...(brief ? { countryballBrief: brief } : {}),
        },
    };
}

function normalizeCast(
    input: unknown,
    topic: string,
    brief: Record<string, unknown> | undefined
): CountryballCastMember[] {
    const rawCast = Array.isArray(input) ? input : Array.isArray(brief?.['cast']) ? (brief?.['cast'] as unknown[]) : [];
    const members = rawCast.filter(isRecord).map((item, index) => ({
        country: compactCountryballText(
            item['country'],
            index === 0 ? detectTargetCountry(topic) : `국가볼${index + 1}`
        ),
        role: compactCountryballText(item['role'], index === 0 ? '주인공' : '상대역'),
        defaultEmotion: compactCountryballText(item['defaultEmotion'], index === 0 ? 'confident' : 'surprised'),
        voiceRole: normalizeCountryballVoiceRole(
            item['voiceRole'],
            COUNTRYBALL_ROLE_VOICE_FALLBACKS[index % COUNTRYBALL_ROLE_VOICE_FALLBACKS.length]
        ),
    }));
    if (members.length > 0) return members;
    return defaultCast(topic);
}

function defaultCast(topic: string): CountryballCastMember[] {
    return [
        {
            country: detectTargetCountry(topic),
            role: '주인공',
            defaultEmotion: 'confident',
            voiceRole: 'main_confident',
        },
        { country: '상대 국가볼', role: '상대역', defaultEmotion: 'surprised', voiceRole: 'panic_high' },
    ];
}

function dialogueLineFromBeat(beat: string, speaker: string): string {
    const compactBeat = compactCountryballText(beat, speaker).replace(/[.!?。！？]+$/g, '');
    return compactBeat.length > 24 ? `${compactBeat.slice(0, 22)}...` : compactBeat;
}

function normalizeScenes(
    input: unknown,
    cast: CountryballCastMember[],
    topic: string,
    sceneCount: number
): CountryballScene[] {
    const rawScenes = Array.isArray(input) ? input.filter(isRecord) : [];
    const fallback = buildFallbackScript(topic, { cast }, sceneCount)['scenes'] as CountryballScene[];
    if (rawScenes.length > 0 && rawScenes.length !== sceneCount) {
        throw new Error(
            `[countryball-script] Scene count mismatch: expected ${sceneCount}, received ${rawScenes.length}. Regenerate the script with the requested scene count.`
        );
    }
    const sourceScenes = rawScenes.length > 0 ? rawScenes : fallback;
    return sourceScenes.map((scene, index) => normalizeScene(scene, index, cast, fallback[index] ?? fallback[0]));
}

function normalizeScene(
    scene: Record<string, unknown> | CountryballScene,
    index: number,
    cast: CountryballCastMember[],
    fallback: CountryballScene
): CountryballScene {
    const sceneNumber = typeof scene['sceneNumber'] === 'number' ? scene['sceneNumber'] : index + 1;
    const dialogueLines = normalizeDialogueLines(scene['dialogueLines'], cast, fallback.dialogueLines);
    const captionOverlay = normalizeCaptionOverlay(
        scene['captionOverlay'],
        dialogueLines,
        sceneNumber,
        fallback.captionOverlay
    );
    return {
        sceneId: compactCountryballText(scene['sceneId'], `scene-${String(sceneNumber).padStart(2, '0')}`),
        sceneNumber,
        timeRange: compactCountryballText(scene['timeRange'], fallback.timeRange),
        scenePurpose: compactCountryballText(scene['scenePurpose'], fallback.scenePurpose),
        location: compactCountryballText(scene['location'], fallback.location),
        visualTone: compactCountryballText(scene['visualTone'], fallback.visualTone),
        screenAction: compactCountryballText(scene['screenAction'], fallback.screenAction),
        dialogueLines,
        expressionChanges:
            stringArray(scene['expressionChanges']).length > 0
                ? stringArray(scene['expressionChanges'])
                : fallback.expressionChanges,
        sfx: stringArray(scene['sfx']).length > 0 ? stringArray(scene['sfx']) : fallback.sfx,
        editBeat: compactCountryballText(scene['editBeat'], fallback.editBeat),
        narratorLine: normalizeNarratorLine(scene['narratorLine']),
        captionOverlay,
        props: stringArray(scene['props']).length > 0 ? stringArray(scene['props']) : fallback.props,
        imagePrompt: compactCountryballText(scene['imagePrompt']),
        durationSec:
            typeof scene['durationSec'] === 'number' && scene['durationSec'] > 0
                ? scene['durationSec']
                : fallback.durationSec,
    };
}

function normalizeDialogueLines(
    input: unknown,
    cast: CountryballCastMember[],
    fallback: CountryballDialogueLine[]
): CountryballDialogueLine[] {
    if (!Array.isArray(input)) return fallback;
    const lines: CountryballDialogueLine[] = [];
    input.forEach((item, index) => {
        if (!isRecord(item)) return;
        const castMember = cast[index % Math.max(1, cast.length)];
        const country = compactCountryballText(item['country'], castMember?.country ?? '국가볼');
        const line = normalizeSpeechFlavor(country, compactCountryballText(item['line'] ?? item['text']));
        if (!line) return;
        lines.push({
            country,
            line: line.slice(0, 54),
            tone: compactCountryballText(item['tone'], '빠르게'),
            voiceRole: normalizeCountryballVoiceRole(item['voiceRole'], castMember?.voiceRole ?? 'main_confident'),
            captionEmphasis: stringArray(item['captionEmphasis']).slice(0, 3),
            pauseAfterMs: typeof item['pauseAfterMs'] === 'number' ? item['pauseAfterMs'] : undefined,
        });
    });
    return lines.length > 0 ? lines : fallback;
}

function normalizeSpeechFlavor(country: string, line: string): string {
    const normalized = line.replace(/\s+/g, ' ').trim();
    if (!/일본|japan/i.test(country)) return normalized;
    return normalized
        .replace(/(요|네요|합니다|입니다|하죠|하지요)[.。!！?？]*\s*(데스|です)[!！.。?？]*$/i, '$1!')
        .replace(/\.{2,}\s*(데스|です)[!！.。?？]*$/i, '!');
}

function normalizeCaptionOverlay(
    input: unknown,
    dialogueLines: CountryballDialogueLine[],
    sceneNumber: number,
    fallback: CountryballCaptionOverlay[]
): CountryballCaptionOverlay[] {
    if (Array.isArray(input)) {
        const overlays = input.filter(isRecord).map(item => normalizeOverlay(item, dialogueLines, sceneNumber));
        if (overlays.length > 0) return overlays;
    }
    const first = dialogueLines[0];
    if (!first) return fallback;
    return [
        {
            type: sceneNumber === 1 ? 'title' : 'dialogue',
            text: sceneNumber === 1 ? first.line.slice(0, 28) : first.line,
            speakerCountry: sceneNumber === 1 ? undefined : first.country,
            anchorTarget: sceneNumber === 1 ? 'topBand' : 'speaker',
            preferredPosition: sceneNumber === 1 ? 'upper-center' : 'middle-right',
            style: sceneNumber === 1 ? 'titleBand' : 'yellowBlack',
            emphasisWords: first.captionEmphasis,
        },
    ];
}

function normalizeOverlay(
    item: Record<string, unknown>,
    dialogueLines: CountryballDialogueLine[],
    sceneNumber: number
): CountryballCaptionOverlay {
    const first = dialogueLines[0];
    const type = ['dialogue', 'action', 'reaction', 'title', 'ending'].includes(String(item['type']))
        ? (String(item['type']) as CountryballCaptionOverlay['type'])
        : sceneNumber === 1
          ? 'title'
          : 'dialogue';
    return {
        type,
        text: compactCountryballText(item['text'], first?.line ?? ''),
        speakerCountry: compactCountryballText(item['speakerCountry'], type === 'dialogue' ? first?.country : ''),
        anchorTarget: normalizeAnchorTarget(item['anchorTarget'], type),
        preferredPosition: normalizePosition(item['preferredPosition'], type),
        style: normalizeCaptionStyle(item['style'], type),
        emphasisWords: stringArray(item['emphasisWords']).slice(0, 3),
        avoidZones: stringArray(item['avoidZones']).slice(0, 4),
    };
}

function normalizeAnchorTarget(
    input: unknown,
    type: CountryballCaptionOverlay['type']
): CountryballCaptionOverlay['anchorTarget'] {
    if (input === 'speaker' || input === 'sceneCenter' || input === 'topBand' || input === 'bottomBand') return input;
    if (type === 'title') return 'topBand';
    if (type === 'dialogue' || type === 'reaction') return 'speaker';
    return 'sceneCenter';
}

function normalizePosition(
    input: unknown,
    type: CountryballCaptionOverlay['type']
): CountryballCaptionOverlay['preferredPosition'] {
    const value = String(input ?? '');
    const allowed: CountryballCaptionOverlay['preferredPosition'][] = [
        'upper-left',
        'upper-center',
        'upper-right',
        'middle-left',
        'center',
        'middle-right',
        'lower-left',
        'lower-center',
        'lower-right',
    ];
    if (allowed.includes(value as CountryballCaptionOverlay['preferredPosition']))
        {return value as CountryballCaptionOverlay['preferredPosition'];}
    if (type === 'title') return 'upper-center';
    if (type === 'ending') return 'lower-center';
    return 'middle-right';
}

function normalizeCaptionStyle(
    input: unknown,
    type: CountryballCaptionOverlay['type']
): CountryballCaptionOverlay['style'] {
    if (
        input === 'whiteBlack' ||
        input === 'yellowBlack' ||
        input === 'redBlack' ||
        input === 'smallWhite' ||
        input === 'titleBand'
    ) {
        return input;
    }
    if (type === 'title') return 'titleBand';
    if (type === 'reaction') return 'redBlack';
    return 'yellowBlack';
}

function normalizeNarratorLine(input: unknown): CountryballScene['narratorLine'] {
    if (typeof input === 'string') {
        const text = compactCountryballText(input);
        return text && text.length <= 32 ? text : null;
    }
    if (isRecord(input)) {
        const text = compactCountryballText(input['text']);
        return text && text.length <= 32
            ? { text, voiceRole: compactCountryballText(input['voiceRole'], 'narrator_short') }
            : null;
    }
    return null;
}

function extractTopic(input: unknown, config?: Record<string, unknown>): string {
    const fromConfig = compactCountryballText(config?.['topic'] ?? config?.['userRequest'] ?? config?.['query']);
    if (fromConfig) return fromConfig.slice(0, 500);
    if (isRecord(input)) {
        return compactCountryballText(
            input['requestTopic'] ?? input['topic'] ?? input['userRequest'] ?? input['query'],
            '컨트리볼 쇼츠'
        ).slice(0, 500);
    }
    return typeof input === 'string' ? input.slice(0, 500) : '컨트리볼 쇼츠';
}

function extractBrief(input: unknown): Record<string, unknown> | undefined {
    if (!isRecord(input)) return undefined;
    if (isRecord(input['countryballBrief'])) return input['countryballBrief'];
    return undefined;
}

function timeRangeForScene(sceneNumber: number, sceneCount: number): string {
    const start = Math.round(((sceneNumber - 1) / sceneCount) * 60);
    const end = Math.round((sceneNumber / sceneCount) * 60);
    return `${start}-${end}s`;
}

function detectTargetCountry(text: string): string {
    if (/한국|대한민국|korea/i.test(text)) return '한국';
    if (/일본|japan/i.test(text)) return '일본';
    if (/미국|usa|america/i.test(text)) return '미국';
    if (/중국|china/i.test(text)) return '중국';
    return '주인공 국가볼';
}

function resolveSceneCount(
    input: unknown,
    config: Record<string, unknown> | undefined,
    brief: Record<string, unknown> | undefined
): number | undefined {
    return (
        readSceneCount(config?.['scenes'] ?? config?.['sceneCount'] ?? config?.['count']) ??
        readSceneCount(brief?.['recommendedSceneCount']) ??
        readSceneCount(isRecord(input) ? input['recommendedSceneCount'] : undefined)
    );
}

function resolveOutputSceneCount(
    root: Record<string, unknown>,
    brief: Record<string, unknown> | undefined,
    requestedSceneCount: number | undefined
): number {
    const rawScenes = Array.isArray(root['scenes']) ? root['scenes'].filter(isRecord) : [];
    const resolved =
        requestedSceneCount ??
        readSceneCount(root['recommendedSceneCount'] ?? root['sceneCount']) ??
        readSceneCount(brief?.['recommendedSceneCount']) ??
        (rawScenes.length > 0 ? Math.min(16, Math.max(5, rawScenes.length)) : undefined);
    return resolved ?? 5;
}

function readSceneCount(value: unknown, fallback?: number): number | undefined {
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(16, Math.max(5, Math.round(parsed)));
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

function stringArray(input: unknown): string[] {
    if (!Array.isArray(input)) return [];
    return input.map(item => String(item).replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function isRecord(input: unknown): input is Record<string, unknown> {
    return input != null && typeof input === 'object' && !Array.isArray(input);
}
