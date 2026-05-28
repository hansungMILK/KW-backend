import { openaiAdapter } from '../../../adapters/ai/openai-adapter';
import { env } from '../../../config/env';
import { CountryballWriterBrainOutputSchema } from '../types';

import type { BlockExecutor, BlockExecutorResult } from '../types';

export const COUNTRYBALL_WRITER_BRAIN_SYSTEM_PROMPT = `You are the Countryball Shorts writer brain.
You receive one selected angle from the angle lab and expand only that selected angle into a binding scene-flow contract.
Do not create new options here. Do not write the final dialogue script yet.

Core rule:
Characters must experience the topic, not explain it.
If a fact can be shown through time, prop, place, facial expression, SFX, or a short caption, do not turn it into lecture dialogue.

The output must include:
- writerBrain: core observation, outsider lens, selected mechanisms, best story angle, information use rule
- storyBrief: concrete setting, characterEngine, sceneFlow
- informationControl: canSayDirectly, showVisually, backgroundOnly, mustNotSayLikeLecture
- scriptRules: rules the next script block must obey

Return JSON only:
{
  "selectedAngleId": "angle_1",
  "writerBrain": {
    "coreObservation": "one sentence",
    "outsiderLens": ["specific outside viewpoint"],
    "selectedMechanisms": ["ordinary_as_absurd"],
    "bestStoryAngle": "one sentence",
    "informationUseRule": "how to avoid lecture"
  },
  "storyBrief": {
    "setting": "concrete skit locations",
    "characterEngine": {
      "한국": "role and attitude",
      "미국": "role and attitude"
    },
    "sceneFlow": [
      {
        "beat": 1,
        "function": "setup|tension|escalation|reveal|joke|payoff",
        "scene": "visible scene",
        "characterAction": "what countryballs physically do",
        "dialogueIntent": "what short dialogue should do",
        "visualGag": "visible joke/reaction",
        "factUsed": "fact used as scene reality",
        "avoid": "what not to say"
      }
    ]
  },
  "informationControl": {
    "canSayDirectly": [],
    "showVisually": [],
    "backgroundOnly": [],
    "mustNotSayLikeLecture": []
  },
  "scriptRules": {
    "dialogueLength": "한 대사는 1-2문장 이내",
    "pacing": "첫 2초 안에 상황이 터져야 함",
    "humorRule": "정보보다 리액션과 장면이 웃겨야 함",
    "endingRule": "짧고 밈처럼 남는 한 줄"
  },
  "recommendedSceneCount": 6
}`;

export const countryballWriterBrainBlock: BlockExecutor = {
    blockType: 'countryball-writer-brain',

    async execute(input: unknown, config?: Record<string, unknown>): Promise<BlockExecutorResult> {
        const start = Date.now();
        const selectedAngle = selectAngle(input, config);
        const selectedAngleId = text(selectedAngle['id'], 'angle_1');
        const requestTopic = extractTopic(input);
        const userAdjustment = text(
            config?.['userAdjustment'] ?? (isRecord(input) ? input['userAdjustment'] : undefined)
        );

        if (env.orchestratorMode === 'mock') {
            const output = normalizeWriterBrainOutput(
                buildFallbackWriterBrain(selectedAngle, requestTopic),
                selectedAngleId
            );
            return { output, durationMs: Date.now() - start };
        }

        const response = await openaiAdapter.chatJson({
            model: env.openaiModel,
            systemPrompt: COUNTRYBALL_WRITER_BRAIN_SYSTEM_PROMPT,
            userMessage: buildWriterBrainUserMessage(requestTopic, selectedAngle, userAdjustment),
            maxTokens: env.openaiContentMaxTokens,
        });
        const parsed = parseJsonLike(response.content);
        if (!parsed) {
            throw new Error(
                `[countryball-writer-brain] OpenAI returned non-JSON response (length=${response.content.length})`
            );
        }

        const output = normalizeWriterBrainOutput(parsed, selectedAngleId);
        const validated = CountryballWriterBrainOutputSchema.safeParse(output);
        if (!validated.success) {
            throw new Error(`[countryball-writer-brain] Output schema validation failed: ${validated.error.message}`);
        }

        return { output: validated.data as Record<string, unknown>, durationMs: Date.now() - start };
    },
};

function buildWriterBrainUserMessage(
    requestTopic: string,
    selectedAngle: Record<string, unknown>,
    userAdjustment: string
): string {
    return [
        `USER REQUEST:\n${requestTopic}`,
        `SELECTED ANGLE:\n${JSON.stringify(selectedAngle, null, 2)}`,
        userAdjustment ? `USER ADJUSTMENT:\n${userAdjustment}` : undefined,
        [
            'Expand only the selected angle.',
            'Do not include unselected angle options.',
            'Make sceneFlow actionable enough for the script block.',
            'Put lecture-prone words in mustNotSayLikeLecture when they should stay visual/background-only.',
        ].join('\n'),
    ]
        .filter(Boolean)
        .join('\n\n');
}

function selectAngle(input: unknown, config?: Record<string, unknown>): Record<string, unknown> {
    const root = isRecord(input) ? input : {};
    if (isRecord(root['selectedAngle'])) return root['selectedAngle'];
    const angleOptions = Array.isArray(root['angleOptions']) ? root['angleOptions'].filter(isRecord) : [];
    const recommendedId = isRecord(root['recommendedChoice']) ? text(root['recommendedChoice']['id']) : '';
    const selectedAngleId = text(config?.['selectedAngleId'] ?? root['selectedAngleId'], recommendedId);
    const selected = angleOptions.find(option => text(option['id']) === selectedAngleId);
    if (selected) return selected;
    if (selectedAngleId && config?.['selectedAngleId']) {
        throw new Error(`[countryball-writer-brain] selectedAngleId not found: ${selectedAngleId}`);
    }
    if (angleOptions[0]) return angleOptions[0];
    return { id: 'angle_1', title: '기본 상황극', oneLinePitch: '주제를 국가볼 상황극으로 보여준다.' };
}

function normalizeWriterBrainOutput(parsed: unknown, selectedAngleId: string): Record<string, unknown> {
    const root = isRecord(parsed) ? parsed : {};
    const storyBrief = isRecord(root['storyBrief']) ? root['storyBrief'] : {};
    const informationControl = isRecord(root['informationControl']) ? root['informationControl'] : {};
    const writerBrain = isRecord(root['writerBrain']) ? root['writerBrain'] : {};
    return {
        ...root,
        mode: 'countryball-writer-brain',
        presetId: 'countryball-shorts',
        selectedAngleId: text(root['selectedAngleId'], selectedAngleId),
        writerBrain: {
            ...writerBrain,
            coreObservation: text(writerBrain['coreObservation'], '주제를 국가볼이 겪는 상황으로 바꾼다.'),
            outsiderLens: arrayOfStrings(writerBrain['outsiderLens']),
            selectedMechanisms: arrayOfStrings(writerBrain['selectedMechanisms']),
            bestStoryAngle: text(writerBrain['bestStoryAngle'], '선택된 앵글을 따른다.'),
            informationUseRule: text(writerBrain['informationUseRule'], '정보는 장면과 소품으로 보인다.'),
        },
        storyBrief: {
            ...storyBrief,
            setting: text(storyBrief['setting'], '컨트리볼 상황극 장소'),
            characterEngine: isRecord(storyBrief['characterEngine']) ? storyBrief['characterEngine'] : {},
            sceneFlow: normalizeSceneFlow(storyBrief['sceneFlow']),
        },
        informationControl: {
            ...informationControl,
            canSayDirectly: arrayOfStrings(informationControl['canSayDirectly']),
            showVisually: arrayOfStrings(informationControl['showVisually']),
            backgroundOnly: arrayOfStrings(informationControl['backgroundOnly']),
            mustNotSayLikeLecture: arrayOfStrings(informationControl['mustNotSayLikeLecture']),
        },
        scriptRules: isRecord(root['scriptRules']) ? root['scriptRules'] : {},
        recommendedSceneCount: readSceneCount(root['recommendedSceneCount']),
        metadata: {
            ...(isRecord(root['metadata']) ? root['metadata'] : {}),
            contentProfileId: 'shorts.countryball.v1',
            selectedAngleId: text(root['selectedAngleId'], selectedAngleId),
        },
    };
}

function normalizeSceneFlow(input: unknown): Record<string, unknown>[] {
    const items = Array.isArray(input) ? input.filter(isRecord) : [];
    if (items.length > 0) {
        return items.map((item, index) => ({
            ...item,
            beat: typeof item['beat'] === 'number' ? item['beat'] : index + 1,
            function: text(item['function'], index === 0 ? 'setup' : 'joke'),
            scene: text(item['scene'], `상황극 장면 ${index + 1}`),
            characterAction: text(item['characterAction'], '국가볼이 주제를 행동으로 겪는다.'),
            dialogueIntent: text(item['dialogueIntent'], '짧은 반응 대사'),
            visualGag: text(item['visualGag'], '표정과 소품으로 보이는 개그'),
            factUsed: text(item['factUsed'], ''),
            avoid: text(item['avoid'], '설명형 대사'),
        }));
    }
    return [
        {
            beat: 1,
            function: 'setup',
            scene: '선택된 앵글의 첫 상황',
            characterAction: '국가볼이 바로 상황을 겪는다.',
            dialogueIntent: '문제를 짧게 드러낸다.',
            visualGag: '표정이 크게 바뀐다.',
            factUsed: '',
            avoid: '설명형 대사',
        },
    ];
}

function buildFallbackWriterBrain(
    selectedAngle: Record<string, unknown>,
    requestTopic: string
): Record<string, unknown> {
    const id = text(selectedAngle['id'], 'angle_1');
    return {
        selectedAngleId: id,
        writerBrain: {
            coreObservation: text(
                selectedAngle['coreObservation'],
                `${requestTopic}은 국가볼이 직접 겪을 때 이해된다.`
            ),
            outsiderLens: [text(selectedAngle['oneLinePitch'], '상대 국가볼이 낯설게 반응한다.')],
            selectedMechanisms: arrayOfStrings(selectedAngle['selectedMechanisms']).length
                ? arrayOfStrings(selectedAngle['selectedMechanisms'])
                : ['ordinary_as_absurd'],
            bestStoryAngle: text(selectedAngle['oneLinePitch'], '선택된 앵글을 상황극으로 확장한다.'),
            informationUseRule: '설명 대신 시간, 장소, 소품, 표정, 효과음으로 보여준다.',
        },
        storyBrief: {
            setting: '선택된 앵글에 맞는 생활 공간과 리액션 무대',
            characterEngine: {},
            sceneFlow: [
                {
                    beat: 1,
                    function: 'setup',
                    scene: text(selectedAngle['title'], requestTopic),
                    characterAction: '상대 국가볼이 낯선 상황을 겪는다.',
                    dialogueIntent: '오해나 의심을 짧게 드러낸다.',
                    visualGag: '눈이 커지고 땀이 난다.',
                    factUsed: '',
                    avoid: '강의식 설명',
                },
            ],
        },
        informationControl: {
            canSayDirectly: [],
            showVisually: [],
            backgroundOnly: [],
            mustNotSayLikeLecture: ['인프라', '자동화', '투자', '전국망', '시스템'],
        },
        scriptRules: {
            dialogueLength: '한 대사는 1-2문장 이내',
            pacing: '첫 2초 안에 상황이 터져야 함',
            humorRule: '정보보다 리액션과 장면이 웃겨야 함',
            endingRule: '짧고 밈처럼 남는 한 줄',
        },
        recommendedSceneCount: 6,
    };
}

function extractTopic(input: unknown): string {
    if (typeof input === 'string') return input.slice(0, 500);
    if (!isRecord(input)) return '컨트리볼 쇼츠';
    return text(input['requestTopic'], text(input['topic'], text(input['userRequest'], '컨트리볼 쇼츠'))).slice(0, 500);
}

function parseJsonLike(content: string): unknown | null {
    try {
        return JSON.parse(content.trim());
    } catch {
        const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
        if (!fenced) return null;
        try {
            return JSON.parse(fenced.trim());
        } catch {
            return null;
        }
    }
}

function arrayOfStrings(input: unknown): string[] {
    if (!Array.isArray(input)) return [];
    return input
        .map(item => (typeof item === 'string' ? item : isRecord(item) ? text(item['id']) : ''))
        .filter(Boolean);
}

function readSceneCount(input: unknown): number | undefined {
    const number = typeof input === 'number' ? input : typeof input === 'string' ? Number(input) : NaN;
    if (!Number.isFinite(number)) return undefined;
    return Math.min(16, Math.max(5, Math.round(number)));
}

function text(input: unknown, fallback = ''): string {
    return typeof input === 'string' ? input.replace(/\s+/g, ' ').trim() || fallback : fallback;
}

function isRecord(input: unknown): input is Record<string, unknown> {
    return input != null && typeof input === 'object' && !Array.isArray(input);
}
