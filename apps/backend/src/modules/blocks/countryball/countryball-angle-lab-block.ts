import { openaiAdapter } from '../../../adapters/ai/openai-adapter';
import { env } from '../../../config/env';
import { CountryballAngleLabOutputSchema } from '../types';

import type { BlockExecutor, BlockExecutorResult } from '../types';

export const COUNTRYBALL_STORY_MECHANISMS = [
    'ordinary_as_absurd',
    'misread_as_crime',
    'system_reveal',
    'role_reversal',
    'ritualization',
    'survival_mode',
    'translation_gap',
    'invisible_system',
    'speed_pressure',
    'social_rule_trap',
    'comparison_shock',
    'receipt_reveal',
    'rival_test',
    'underdog_proof',
    'culture_shock_pingpong',
] as const;

export const COUNTRYBALL_ANGLE_LAB_SYSTEM_PROMPT = `You are the Countryball Shorts angle lab.
Your job is to produce exactly three distinct story angles before script generation.
Do not write the script.

Core rule:
Characters must experience the topic, not explain it.
Countryball characters are not presenters. They should get confused, overreact, test something, misread a scene, panic, brag, worship a prop, or change attitude because of the topic.
Facts must become time, place, props, action, facial expression, sound, and short caption strategy.

Each angle must be a complete skit idea a user can choose, not a vague theme label.
Use concrete titles that explain the situation in Korean.
Avoid vague clickbait titles like "공습", "실험", "대참사", or "쇼크" unless the visible action literally supports that word.
If the user gave an explicit plot, preserve that plot in every option and vary only the staging, reaction style, and ending payoff.

Use these story mechanisms as writer tools, not hardcoded plots:
${COUNTRYBALL_STORY_MECHANISMS.map(item => `- ${item}`).join('\n')}

Return three genuinely different angle options. Each option must differ from the others in at least two of these:
- opening scene
- conflict or misunderstanding
- character roles
- comedy mechanism
- ending payoff
- information exposure strategy

Bad options: "surprised by dawn delivery", "surprised by same-day delivery", "surprised by next-day delivery".
Good options: "dawn doorstep horror", "eggs arrive before work", "delivery box worship".

Return JSON only:
{
  "angleOptions": [
    {
      "id": "angle_1",
      "title": "short Korean angle title",
      "oneLinePitch": "one concrete skit pitch",
      "coreObservation": "why the topic is interesting",
      "selectedMechanisms": [{ "id": "ordinary_as_absurd", "reason": "why this mechanism fits" }],
      "storyShape": {
        "opening": "opening scene",
        "middleEscalation": "middle escalation",
        "peakMoment": "peak visual joke or emotional turn",
        "endingPayoff": "short memorable ending"
      },
      "scenePreview": [
        { "beat": 1, "scene": "visible scene preview", "whyItWorks": "why it works" }
      ],
      "characterUse": {
        "mainCountry": "main countryball",
        "comparisonCountry": "comparison countryball",
        "thirdCharacter": "optional"
      },
      "informationStrategy": {
        "directInfo": ["facts that can be said shortly"],
        "visualInfo": ["facts that should be shown as props/action"],
        "hiddenBackgroundInfo": ["facts that must stay background-only"]
      },
      "thumbnailPotential": "thumbnail text or visual",
      "strength": "why this option is strong",
      "risk": "where it might go wrong",
      "bestFor": "best use case",
      "score": { "comedy": 9, "clarity": 9, "visuality": 9, "freshness": 8, "evidenceFit": 8 }
    }
  ],
  "recommendedChoice": { "id": "angle_1", "reason": "why this is recommended" },
  "selectionPrompt": "Korean prompt asking the user to pick one"
}`;

export const countryballAngleLabBlock: BlockExecutor = {
    blockType: 'countryball-angle-lab',

    async execute(input: unknown, config?: Record<string, unknown>): Promise<BlockExecutorResult> {
        const start = Date.now();
        const requestTopic = extractTopic(input);
        const brief = extractBrief(input);
        const currentConfig = config ?? {};

        if (hasSelectedAngleSnapshot(currentConfig)) {
            const output = normalizeAngleLabOutput(currentConfig, requestTopic, currentConfig);
            const validated = CountryballAngleLabOutputSchema.safeParse(output);
            if (!validated.success) {
                throw new Error(
                    `[countryball-angle-lab] Selected angle snapshot is invalid: ${validated.error.message}`
                );
            }
            return { output: validated.data as Record<string, unknown>, durationMs: Date.now() - start };
        }

        if (env.orchestratorMode === 'mock') {
            const output = normalizeAngleLabOutput(buildFallbackAngleLab(requestTopic), requestTopic, currentConfig);
            return { output, durationMs: Date.now() - start };
        }

        const response = await openaiAdapter.chatJson({
            model: env.openaiWritingModel,
            systemPrompt: COUNTRYBALL_ANGLE_LAB_SYSTEM_PROMPT,
            userMessage: buildAngleLabUserMessage(requestTopic, brief, input),
            maxTokens: env.openaiContentMaxTokens,
        });
        const parsed = parseJsonLike(response.content);
        if (!parsed) {
            throw new Error(
                `[countryball-angle-lab] OpenAI returned non-JSON response (length=${response.content.length})`
            );
        }

        const output = normalizeAngleLabOutput(parsed, requestTopic, currentConfig);
        const validated = CountryballAngleLabOutputSchema.safeParse(output);
        if (!validated.success) {
            throw new Error(`[countryball-angle-lab] Output schema validation failed: ${validated.error.message}`);
        }
        assertDistinctAngles(validated.data.angleOptions);

        return { output: validated.data as Record<string, unknown>, durationMs: Date.now() - start };
    },
};

function buildAngleLabUserMessage(
    requestTopic: string,
    brief: Record<string, unknown> | undefined,
    input: unknown
): string {
    return [
        `USER REQUEST:\n${requestTopic}`,
        brief ? `COUNTRYBALL BRIEF:\n${JSON.stringify(brief, null, 2)}` : undefined,
        isRecord(input) && Array.isArray(input['articles'])
            ? `OPTIONAL SOURCES:\n${JSON.stringify(input['articles']).slice(0, 5000)}`
            : undefined,
        [
            'Make three selectable Countryball skit angles.',
            'Do not decide the final script yet.',
            'Do not turn the topic into a lecture or infrastructure explanation.',
            'Each option must be playable as a short situation skit.',
            'Each option title and pitch must make the user instantly understand what would happen on screen.',
            'Do not make three variants of the same angle with different nouns.',
        ].join('\n'),
    ]
        .filter(Boolean)
        .join('\n\n');
}

function normalizeAngleLabOutput(
    parsed: unknown,
    requestTopic: string,
    config: Record<string, unknown>
): Record<string, unknown> {
    const root = isRecord(parsed) ? parsed : {};
    const selectedAngleInput = isRecord(root['selectedAngle']) ? root['selectedAngle'] : undefined;
    const rawOptions = Array.isArray(root['angleOptions']) ? root['angleOptions'].filter(isRecord) : [];
    if (selectedAngleInput) {
        const selectedInputId = text(selectedAngleInput['id']);
        const existingIndex = rawOptions.findIndex(option => text(option['id']) === selectedInputId);
        if (existingIndex >= 0) {
            rawOptions[existingIndex] = selectedAngleInput;
        } else {
            rawOptions.unshift(selectedAngleInput);
        }
    }
    const fallback = buildFallbackAngleLab(requestTopic);
    const angleOptions = (rawOptions.length > 0 ? rawOptions : (fallback.angleOptions as Record<string, unknown>[]))
        .slice(0, 3)
        .map((option, index) => normalizeAngleOption(option, index, requestTopic));
    while (angleOptions.length < 3) {
        angleOptions.push(
            normalizeAngleOption(
                (fallback.angleOptions as Record<string, unknown>[])[angleOptions.length],
                angleOptions.length,
                requestTopic
            )
        );
    }

    const recommendedChoiceInput = root['recommendedChoice'];
    const recommendedChoice = isRecord(recommendedChoiceInput)
        ? {
              ...recommendedChoiceInput,
              id: text(recommendedChoiceInput['id'], text(angleOptions[0]?.id, 'angle_1')),
              reason: text(recommendedChoiceInput['reason'], '가장 장면적으로 선명한 앵글입니다.'),
          }
        : { id: angleOptions[0]?.id ?? 'angle_1', reason: '가장 장면적으로 선명한 앵글입니다.' };
    const selectedAngleId = text(config['selectedAngleId'] ?? root['selectedAngleId']);
    const selectedAngle = selectedAngleId
        ? angleOptions.find(option => text(option['id']) === selectedAngleId)
        : undefined;

    return {
        mode: 'countryball-angle-lab',
        presetId: 'countryball-shorts',
        requestTopic,
        angleOptions,
        ...(selectedAngle ? { selectedAngleId, selectedAngle, angleSelectionStatus: 'selected' } : {}),
        recommendedChoice,
        selectionPrompt: text(root['selectionPrompt'], '아래 3개 중 마음에 드는 컨트리볼 상황극 앵글을 골라주세요.'),
        metadata: {
            contentProfileId: 'shorts.countryball.v1',
            reviewMode: 'script-first',
            angleSelectionRequired: true,
        },
    };
}

function normalizeAngleOption(
    option: Record<string, unknown>,
    index: number,
    requestTopic: string
): Record<string, unknown> {
    const storyShape = isRecord(option['storyShape']) ? option['storyShape'] : {};
    const scenePreview = Array.isArray(option['scenePreview']) ? option['scenePreview'].filter(isRecord) : [];
    const mechanisms = Array.isArray(option['selectedMechanisms']) ? option['selectedMechanisms'].filter(isRecord) : [];
    return {
        ...option,
        id: text(option['id'], `angle_${index + 1}`),
        title: text(option['title'], `상황극 앵글 ${index + 1}`),
        oneLinePitch: text(option['oneLinePitch'], `${requestTopic}을 국가볼들이 겪는 상황극으로 보여준다.`),
        coreObservation: text(
            option['coreObservation'],
            `${requestTopic}에서 외국 국가볼이 이상하게 느낄 지점을 찾는다.`
        ),
        selectedMechanisms:
            mechanisms.length > 0
                ? mechanisms.map((item, itemIndex) => ({
                      id: text(
                          item['id'],
                          COUNTRYBALL_STORY_MECHANISMS[itemIndex % COUNTRYBALL_STORY_MECHANISMS.length]
                      ),
                      reason: text(item['reason'], '이 주제의 상황극 장치를 만든다.'),
                  }))
                : [
                      {
                          id: COUNTRYBALL_STORY_MECHANISMS[index % COUNTRYBALL_STORY_MECHANISMS.length],
                          reason: '주제에 맞는 상황극 장치를 만든다.',
                      },
                  ],
        storyShape: {
            ...storyShape,
            opening: text(storyShape['opening'], `${requestTopic}이 바로 보이는 첫 장면`),
            middleEscalation: text(storyShape['middleEscalation'], '상대 국가볼의 오해나 의심이 커진다.'),
            peakMoment: text(storyShape['peakMoment'], '핵심 반응이 터지는 장면'),
            endingPayoff: text(storyShape['endingPayoff'], '짧은 마지막 이미지나 대사'),
        },
        scenePreview: ensureScenePreview(scenePreview, requestTopic),
        characterUse: isRecord(option['characterUse']) ? option['characterUse'] : {},
        informationStrategy: isRecord(option['informationStrategy'])
            ? option['informationStrategy']
            : { directInfo: [], visualInfo: [], hiddenBackgroundInfo: [] },
        thumbnailPotential: text(option['thumbnailPotential'], ''),
        strength: text(option['strength'], '장면으로 이해하기 쉽다.'),
        risk: text(option['risk'], '설명형으로 흐르지 않게 주의해야 한다.'),
        bestFor: text(option['bestFor'], '컨트리볼 쇼츠'),
        score: isRecord(option['score']) ? option['score'] : {},
    };
}

function ensureScenePreview(input: Record<string, unknown>[], requestTopic: string): Record<string, unknown>[] {
    const base = input.map((item, index) => ({
        ...item,
        beat: typeof item['beat'] === 'number' ? item['beat'] : index + 1,
        scene: text(item['scene'], `${requestTopic} 상황극 장면 ${index + 1}`),
        whyItWorks: text(item['whyItWorks'], '시각적으로 바로 이해된다.'),
    }));
    while (base.length < 3) {
        base.push({
            beat: base.length + 1,
            scene: `${requestTopic}을 행동과 리액션으로 보여주는 장면 ${base.length + 1}`,
            whyItWorks: '설명 대신 장면으로 보인다.',
        });
    }
    return base;
}

function assertDistinctAngles(angleOptions: Array<Record<string, unknown>>): void {
    const signatures = new Set(
        angleOptions.map(option => {
            const mechanisms = Array.isArray(option['selectedMechanisms'])
                ? option['selectedMechanisms']
                      .filter(isRecord)
                      .map(item => text(item['id']))
                      .join('|')
                : '';
            const storyShape = isRecord(option['storyShape']) ? option['storyShape'] : {};
            const scenePreview = Array.isArray(option['scenePreview'])
                ? option['scenePreview']
                      .filter(isRecord)
                      .map(item => text(item['scene']))
                      .join('|')
                : '';
            return [
                mechanisms,
                text(storyShape['opening']),
                text(storyShape['middleEscalation']),
                text(storyShape['peakMoment']),
                text(storyShape['endingPayoff']),
                scenePreview,
            ].join(' / ');
        })
    );
    if (signatures.size < 3) {
        throw new Error(
            '[countryball-angle-lab] Expected three distinct story angles, but model returned near-duplicates.'
        );
    }
}

function buildFallbackAngleLab(requestTopic: string): Record<string, unknown> {
    return {
        angleOptions: [
            {
                id: 'angle_1',
                title: '문앞 오해 상황극',
                oneLinePitch: `${requestTopic}을 낯선 국가볼이 수상한 사건으로 오해한다.`,
                selectedMechanisms: [{ id: 'ordinary_as_absurd', reason: '평범한 일을 이상한 사건처럼 보여준다.' }],
                storyShape: {
                    opening: '주인공 국가볼은 평범하게 행동한다.',
                    middleEscalation: '상대 국가볼은 그 행동을 이상하게 받아들인다.',
                    peakMoment: '오해가 가장 크게 터진다.',
                    endingPayoff: '주인공 국가볼이 태연하게 한 줄로 끝낸다.',
                },
                scenePreview: [],
            },
            {
                id: 'angle_2',
                title: '속도 비교 개그',
                oneLinePitch: `${requestTopic}의 결과가 상대 국가볼의 상식보다 빠르게 등장한다.`,
                selectedMechanisms: [{ id: 'speed_pressure', reason: '속도 차이를 상황으로 만든다.' }],
                storyShape: {
                    opening: '상대 국가볼이 느긋하게 기다린다.',
                    middleEscalation: '결과가 너무 빨리 나타난다.',
                    peakMoment: '상대 국가볼이 자기 기준이 무너진다.',
                    endingPayoff: '빠른 결과를 밈 대사로 마무리한다.',
                },
                scenePreview: [],
            },
            {
                id: 'angle_3',
                title: '소품 숭배 개그',
                oneLinePitch: `${requestTopic}의 결과물을 상대 국가볼이 기적처럼 받든다.`,
                selectedMechanisms: [{ id: 'ritualization', reason: '부러움을 과장된 행동으로 보여준다.' }],
                storyShape: {
                    opening: '상대 국가볼이 자기 나라 기준을 한탄한다.',
                    middleEscalation: '주인공 국가볼에게는 당연한 결과물이 등장한다.',
                    peakMoment: '상대 국가볼이 결과물을 숭배한다.',
                    endingPayoff: '주인공 국가볼이 그건 그냥 일상이라고 말한다.',
                },
                scenePreview: [],
            },
        ],
        recommendedChoice: { id: 'angle_1', reason: '오해가 가장 빠르게 이해됩니다.' },
        selectionPrompt: '아래 3개 중 마음에 드는 앵글을 골라주세요.',
    };
}

function extractTopic(input: unknown): string {
    if (typeof input === 'string') return input.slice(0, 500);
    if (!isRecord(input)) return '컨트리볼 쇼츠';
    return text(input['requestTopic'], text(input['topic'], text(input['userRequest'], '컨트리볼 쇼츠'))).slice(0, 500);
}

function extractBrief(input: unknown): Record<string, unknown> | undefined {
    if (!isRecord(input)) return undefined;
    return isRecord(input['countryballBrief']) ? input['countryballBrief'] : undefined;
}

function parseJsonLike(content: string): unknown | null {
    try {
        return JSON.parse(content.trim());
    } catch {
        const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
        if (fenced) {
            const parsedFence = parseJsonCandidate(fenced);
            if (parsedFence) return parsedFence;
        }
        const candidate = extractFirstJsonObjectText(content);
        return candidate ? parseJsonCandidate(candidate) : null;
    }
}

function hasSelectedAngleSnapshot(config: Record<string, unknown>): boolean {
    const selectedAngleId = text(config['selectedAngleId']);
    return (
        config['angleSelectionStatus'] === 'selected' &&
        selectedAngleId.length > 0 &&
        (isRecord(config['selectedAngle']) || Array.isArray(config['angleOptions']))
    );
}

function extractFirstJsonObjectText(content: string): string | null {
    let start = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = 0; index < content.length; index += 1) {
        const char = content[index];

        if (start < 0) {
            if (char === '{') {
                start = index;
                depth = 1;
            }
            continue;
        }

        if (escaped) {
            escaped = false;
            continue;
        }
        if (char === '\\') {
            escaped = inString;
            continue;
        }
        if (char === '"') {
            inString = !inString;
            continue;
        }
        if (inString) continue;

        if (char === '{') depth += 1;
        if (char === '}') depth -= 1;

        if (depth === 0) {
            return content.slice(start, index + 1);
        }
    }

    return start >= 0 ? repairPossiblyTruncatedJsonObject(content.slice(start)) : null;
}

function parseJsonCandidate(input: string): unknown | null {
    const trimmed = input.trim();
    try {
        return JSON.parse(trimmed);
    } catch {
        const repaired = repairPossiblyTruncatedJsonObject(trimmed);
        if (!repaired || repaired === trimmed) return null;
        try {
            return JSON.parse(repaired);
        } catch {
            return null;
        }
    }
}

function repairPossiblyTruncatedJsonObject(input: string): string | null {
    const start = input.indexOf('{');
    if (start < 0) return null;

    let result = input
        .slice(start)
        .replace(/,\s*([}\]])/g, '$1')
        .trimEnd();
    const stack: string[] = [];
    let inString = false;
    let escaped = false;

    for (const char of result) {
        if (escaped) {
            escaped = false;
            continue;
        }
        if (char === '\\' && inString) {
            escaped = true;
            continue;
        }
        if (char === '"') {
            inString = !inString;
            continue;
        }
        if (inString) continue;
        if (char === '{') stack.push('}');
        if (char === '[') stack.push(']');
        if ((char === '}' || char === ']') && stack[stack.length - 1] === char) stack.pop();
    }

    if (inString) result += '"';
    while (stack.length > 0) result += stack.pop();
    return result.replace(/,\s*([}\]])/g, '$1');
}

function text(input: unknown, fallback = ''): string {
    return typeof input === 'string' ? input.replace(/\s+/g, ' ').trim() || fallback : fallback;
}

function isRecord(input: unknown): input is Record<string, unknown> {
    return input != null && typeof input === 'object' && !Array.isArray(input);
}
