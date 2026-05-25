import { buildOutputContract, buildRequestSpec, classifySourceCoverage } from './request-contract';
import { extractTopic } from './search-block';
import { ContentOutputSchema } from './types';
import { openaiAdapter } from '../../adapters/ai/openai-adapter';
import { env } from '../../config/env';
import { log } from '../../utils/logger';
import { buildCombinedPrompt } from '../shorts/rulepacks/base-shorts-rulepack';
import { CREATIVE_SIMULATION_SHORTS_RULES } from '../shorts/rulepacks/creative-simulation-rulepack';
import { buildContentPreferencePrompt, buildScriptTonePrompt } from '../shorts/rulepacks/script-tone-rulepack';
import { SCRIPT_OUTPUT_RULES, SCRIPT_WRITER_RULES } from '../shorts/rulepacks/script-writer-rulepack';
import { DIRECTOR_OUTPUT_RULES, SHORTS_DIRECTOR_RULES } from '../shorts/rulepacks/shorts-director-rulepack';
import { selectShortsRulepack } from '../shorts/topic-router';

import type { OutputKind, RequestSpec, SourceCoverage } from './request-contract';
import type { BlockExecutor, BlockExecutorResult } from './types';

// ── Prompts ──────────────────────────────────────────────────────────────────

const CONTENT_SYSTEM_PROMPT = `You are a Korean YouTube Shorts scriptwriter and scene planner.
Given keywords and/or article summaries, generate a complete 10–15 scene, one-minute vertical Shorts plan in Korean.

Requirements:
- If the user message contains "PRIMARY SOURCE", treat that source as the main brief. Supporting sources may verify or add caveats, but must not replace the primary source's angle.
- Do not broaden a specific requested subject into its parent topic. If the request names an episode, case, product, person, URL, article, or named event, the script must explain that exact subject, not only the broader category.
- If available sources are broad or explicitly say they do not cover the requested subject, mark unsupported details as uncertainty and do not fill the gap with generic background.
- SourceCoverage status direct/supporting/unrelated is advisory but binding for factual scope: direct sources can ground factual claims, supporting sources can provide background only, and unrelated sources must not drive the script.
- Preserve concrete numbers, conditions, warnings, and key claims from the PRIMARY SOURCE in factual scenes.
- If no source ids are available, do not mark scenes as claimType "fact"; use opinion or hypothetical unless the scene cites a real sourceRef.
- For URL/article requests, build the script from the article's factual spine: who/what/when, the triggering claim, the disputed action, the response/apology, and what viewers should take away.
- Do not replace a provided URL's specific story with generic background. If the article mentions names, dates, product names, amounts, or direct allegations, use those exact facts in the narration.
- title: a short high-impact Korean title that can stay at the top of every frame
- hook: a punchy opening question or statement (one short sentence, max 32 Korean characters)
- script: structured script metadata with hook, angle, and cta
- style: structured visual style metadata for vertical-shorts
- scenes: 10–15 scenes, each with:
  - sceneNumber
  - imageSlot: "[Image #1]" through "[Image #12]" or "[Image #15]"
  - storyBeat: hook|setup|escalation|reveal|takeaway|cta or another compact beat label
  - topTitle: the same persistent Korean top title for every scene
  - caption: a short bold Korean on-screen subtitle (8–22 Korean characters)
  - narration: Korean voice-over text (one short spoken sentence, 18–42 Korean characters)
  - imagePrompt: English style-neutral visual content brief for the central scene only. Describe subject, setting, action, props, and emotion. Do not bake in a visual style such as comic, animation, photorealistic, iPhone photo, illustration, manga, or cartoon unless the user explicitly requested it. The media-image block applies the selected visual style later. Final title/subtitle overlays are added by the video compositor, but short in-scene Korean/English signage or document text is allowed when it clarifies the scene.
  - visualText: backward-compatible short Korean main caption string
  - visual: { topTitle, mainCaption, sourceLabel? }
  - claimType: fact|hypothetical|opinion|joke
  - sourceRefs: source ids or compact source objects used by the scene
  - durationSec: 4–6 seconds per scene
- cta: call-to-action closing line (max 32 Korean characters)
- totalDurationSec: sum of all scene durations
- sources: all source objects preserved from search
- total spoken text budget for hook + all narrations + cta: max 520 Korean characters

Respond with JSON only — no markdown fences, no extra text:
{
  "title": "...",
  "hook": "...",
  "script": { "hook": "...", "angle": "...", "cta": "..." },
  "style": { "format": "vertical-shorts", "aspectRatio": "9:16", "sceneCount": 12, "visualGrammar": {} },
  "scenes": [
    { "sceneNumber": 1, "imageSlot": "[Image #1]", "storyBeat": "hook", "topTitle": "...", "caption": "...", "narration": "...", "imagePrompt": "...", "visualText": "...", "visual": { "topTitle": "...", "mainCaption": "...", "sourceLabel": "..." }, "claimType": "fact", "sourceRefs": ["source-1"], "durationSec": 5 },
    ...
  ],
  "cta": "...",
  "totalDurationSec": 60,
  "sources": [
    { "id": "source-1", "title": "...", "url": "...", "source": "...", "publishedAt": "YYYY-MM-DD or null", "sourceType": "official|news|blog|other", "confidence": 0.9, "summary": "..." }
  ]
}`;

const SINGLE_IMAGE_SYSTEM_PROMPT = `You are an AI image prompt planner.
Given a user's image request, produce exactly one scene that can be passed to GPT-image-2.

Requirements:
- mode: "single-image"
- outputKind: "image-prompt"
- title: a compact Korean title for the image, max 16 Korean characters
- hook: one short Korean phrase describing the image intent
- promptPlan: { title, imagePrompt, aspectRatio, styleNotes?, safetyNotes? }
- script: { hook, angle, cta } only for backward compatibility; do not write a video script
- style: { format: "single-image", aspectRatio: "9:16", sceneCount: 1 }
- scenes: exactly 1 scene with:
  - sceneNumber: 1
  - imageSlot: "[Image #1]"
  - storyBeat: "single-image"
  - topTitle: compact Korean title
  - caption: a short bold Korean caption, max 18 Korean characters
  - narration: one short Korean description of the image, max 42 Korean characters
  - imagePrompt: English AI image generation prompt for one complete image. Preserve the user's subject and action.
  - visualText: exact short Korean text intended for the video overlay; otherwise same as caption
  - visual: { topTitle, mainCaption, sourceLabel? }
  - claimType: opinion|joke|hypothetical|fact
  - sourceRefs: []
  - durationSec: 5
- cta: empty string
- totalDurationSec: 5
- sources: []

Do not create a Shorts/video plan. Do not add TTS, video, SEO, or distribution steps.
Respond with JSON only — no markdown fences, no extra text.`;

const COUNTRYBALL_SYSTEM_PROMPT = `You are a Korean countryball Shorts skit writer.
Generate a complete 10-15 scene, one-minute vertical countryball situation reenactment in Korean.

Countryball dialogue-writing contract:
- The product is not a narrator explainer. It is a situation skit acted out by countryball characters.
- The user request is the creative source of truth. It may be factual, fictional, hypothetical, satirical, or metaphorical.
- Do not default to source-attribution prose such as "공식 지표에 따르면", "보도에 따르면", or "연구에 따르면" unless the user explicitly asks for sourced reporting.
- Do not write scenes like a documentary paragraph split into 12 narrations.
- Every scene should feel like a frame from a comic skit: visible character action, reaction, props, and short dialogue.
- Do not force a fixed plot pattern such as crisis -> reversal -> foreign shock. Choose the best cast, location, tension, and ending for the user's topic.
- Most active scenes should include fast countryball back-and-forth dialogue. A final/static/reaction cut may have one line or no line if the screenAction carries the joke.
- dialogueLines are short character lines, not exposition. One character must not explain the whole topic alone.
- narratorLine defaults to null. Use narrator only for a title-like opening card, a time-jump card, or a very short ending meta caption.
- Use role-based voiceRole values, not fixed country voices: main_tired, main_confident, rival_smug, rival_angry, neutral_serious, panic_high, old_teacher, narrator_short.
- Keep the user's concrete nouns and situation labels visible in captions, dialogue, dramatizedAction, and imagePrompt.
- Use visible actions: panicking, bragging, running, pointing, carrying props, getting shocked, lining up, throwing objects, ordering food, hiding, bargaining, laughing, crying, or reacting.
- Use safe countryball satire. Avoid slurs, hateful stereotypes, or claims that a whole country, people, ethnicity, or nationality is inherently inferior.

Reference visual grammar contract:
- Match the viral countryball infographic-skit frame structure, not a plain character scene.
- Every final video frame should read as: top black title band -> middle information/evidence comic panel -> lower large countryball reaction stage.
- The video compositor owns the final title/subtitle overlays. Do not ask the image model to render final-video title bands or lower subtitles.
- The persistent topTitle should feel like a two-line Korean Shorts headline: key phrase in bright yellow, remaining text in white, on black.
- The middle panel must contain readable situation props: documents, newspaper cards, charts, arrows, maps, factories, money bags, timelines, warning boards, reports, or scene-specific evidence objects.
- The lower stage must show large foreground countryballs with exaggerated eyes, sweat, tears, smirk, shock, pointing, holding papers, or arguing.
- Put one short in-scene dialogue/reaction caption in bold yellow Korean text with black outline when the frame needs a punchline.
- Do not output generic "Korea countryball and Japan countryball talk" prompts.

Scene contract:
- sceneNumber
- imageSlot: "[Image #1]" through "[Image #12]" or "[Image #15]"
- storyBeat: hook|setup|tension|action|reaction|twist|payoff|cta
- scenePurpose: why this scene exists in the skit
- location: the skit location for this beat
- visualTone: comedy|serious|panic|awkward|satirical|historical|news-like|chaotic|calm
- topTitle: the same persistent Korean top title for every scene
- caption: short bold Korean on-screen caption, 6-18 Korean characters
- narration: backward-compatible subtitle string made from dialogue, such as "한국볼: ... 미국볼: ..."; do not use narrator explanation here
- imagePrompt: English central artwork brief for the reference countryball infographic-skit layout. Describe middle evidence panel, lower foreground countryball reaction stage, characters, props, expression, and action. Leave title/subtitle overlays to the compositor.
- visualText: same or shorter than caption
- visual: { topTitle, mainCaption, sourceLabel? }
- claimType: hypothetical|opinion|joke|fact
- sourceRefs: [] unless the user explicitly gave source-backed reporting material
- durationSec: 4-6
- characters: [{ countryCode, roleInScene, expression, pose }]
- screenAction: concrete visible skit action, not a summary
- dramatizedAction: same meaning as screenAction for backward compatibility
- dialogueLines: [{ country, line, tone, voiceRole, captionEmphasis?, pauseAfterMs?, speaker, text, emotion, delivery, captionStyle, durationSec }]
- expressionChanges: short list of eye/face changes
- sfx: short list of sound effects
- editBeat: cut/zoom/silence/BGM instruction
- narratorLine: null by default, or { text, voiceRole: "narrator_short" } only for title/time-jump/ending meta
- factualClaim: empty string unless the scene states a real-world fact
- evidenceRefs: [] unless factualClaim is source-backed

Output shape:
{
  "title": "...",
  "hook": "...",
  "script": { "hook": "...", "angle": "...", "cta": "..." },
  "style": {
    "format": "vertical-shorts",
    "aspectRatio": "9:16",
    "sceneCount": 12,
    "visualStyle": "countryball-comic",
    "narrativeMode": "countryball-situation-reenactment",
    "visualGrammar": {
      "reenactment": true,
      "characterSystem": "countryball",
      "referenceLayout": "countryball-infographic-skit",
      "topTitleBand": "black-yellow-white",
      "panelStructure": "middle-evidence-panel-lower-reaction-stage",
      "captionTreatment": "bold-yellow-black-outline"
    }
  },
  "scenes": [
    {
      "sceneNumber": 1,
      "imageSlot": "[Image #1]",
      "storyBeat": "hook",
      "scenePurpose": "...",
      "location": "...",
      "visualTone": "panic",
      "topTitle": "...",
      "caption": "...",
      "narration": "...",
      "imagePrompt": "...",
      "visualText": "...",
      "visual": { "topTitle": "...", "mainCaption": "..." },
      "claimType": "hypothetical",
      "sourceRefs": [],
      "durationSec": 5,
      "characters": [{ "countryCode": "KR", "roleInScene": "...", "expression": "...", "pose": "..." }],
      "screenAction": "...",
      "dramatizedAction": "...",
      "dialogueLines": [{ "country": "한국", "line": "...", "tone": "...", "voiceRole": "main_confident", "captionEmphasis": ["..."], "pauseAfterMs": 0, "speaker": "한국볼", "text": "...", "emotion": "...", "delivery": "...", "meaning": "...", "captionStyle": "bold", "durationSec": 1.2 }],
      "expressionChanges": ["..."],
      "sfx": ["..."],
      "editBeat": "...",
      "narratorLine": null,
      "factualClaim": "",
      "evidenceRefs": []
    }
  ],
  "cta": "...",
  "totalDurationSec": 60,
  "sources": []
}

Respond with JSON only — no markdown fences, no extra text.`;

function buildCountryballContentPrompt(
    rulepackId: string,
    config: Record<string, unknown> | undefined,
    userRequest: string
): string {
    if (rulepackId !== 'countryball-shorts' && config?.['contentProfileId'] !== 'shorts.countryball.v1') return '';

    return [
        'Countryball situation reenactment addendum:',
        `- Requested situation: ${userRequest}`,
        '- This is user-request driven. It does not have to be a real historical event unless the user asks for one.',
        '- Reenact the requested situation through countryball characters, actions, reactions, props, and scene background.',
        '- Do not write narrator-only explainer scenes.',
        '- Do not force a fixed plot pattern. Internally choose the best location, countries, tension, comedy/serious tone, and final beat for the topic.',
        '- Do not default to source-attribution prose such as "공식 지표에 따르면", "보도에 따르면", or "연구에 따르면". Use skit action unless the user explicitly asks for sourced reporting.',
        '- Put the user requested concrete nouns and situation labels into captions, dialogue, dramatizedAction, and imagePrompt.',
        '- Use visible actions like panicking, bragging, running, pointing, carrying props, getting shocked, lining up, throwing objects, ordering food, hiding, bargaining, or reacting.',
        '- Dialogue is the main script surface: countryballs should talk, react, interrupt, panic, brag, misunderstand, or call each other out.',
        '- For every scene include scenePurpose, location, visualTone, characters, screenAction, dramatizedAction, dialogueLines, expressionChanges, sfx, editBeat, narratorLine, factualClaim, and evidenceRefs.',
        '- dialogueLines must be objects: [{ country, line, tone, voiceRole, captionEmphasis?, pauseAfterMs?, speaker, text, emotion, delivery, meaning, captionStyle, durationSec }].',
        '- Most active scenes should include 2-4 short dialogue lines. Final/static/reaction cuts may use one line if the action carries the beat.',
        '- Use role-based voiceRole values: main_tired, main_confident, rival_smug, rival_angry, neutral_serious, panic_high, old_teacher, narrator_short.',
        '- narratorLine must be null by default. Use narrator_short only for a title-like first line, time jump, or ending meta caption.',
        '- speaker must identify the countryball character or role, such as "한국볼", "일본볼", "KR", or "JP"; do not use narrator as speaker.',
        '- Keep each dialogue line short enough for a 1-2 second Shorts beat.',
        '- factualClaim must be empty or omitted unless the scene states a real-world fact.',
        '- dramatizedAction must describe the skit action and must not be presented as evidence.',
        '- Do not rely on dialogue alone. Every scene still needs a drawable dramatizedAction.',
        '- Use the reference final-frame grammar: top black title band, middle evidence/infographic panel, lower large countryball reaction stage.',
        '- imagePrompt must describe central artwork with an evidence/infographic panel and large foreground countryball reactions.',
        '- The video compositor adds the final black/yellow title and yellow dialogue caption overlays; do not ask GPT-image to render final-video title/subtitle bands.',
        '- Build visual panels with documents, newspaper cards, charts, arrows, maps, factories, money bags, timelines, reports, or scene-specific props.',
        '- Do not produce plain empty-background countryball talking scenes.',
        '- Avoid slurs, hateful stereotypes, and claims that a whole nation or ethnicity is inferior.',
    ].join('\n');
}

function buildCountryballSystemPrompt(input: {
    requestedShortsSceneCount?: number;
    countryballPrompt: string;
    rulepackSourcePolicy: string;
}): string {
    const sceneCountInstruction = input.requestedShortsSceneCount
        ? `HARD SCENE COUNT: produce exactly ${input.requestedShortsSceneCount} scenes.`
        : 'SCENE COUNT: produce 10-15 scenes, preferably 12 scenes.';
    return [COUNTRYBALL_SYSTEM_PROMPT, sceneCountInstruction, input.countryballPrompt, input.rulepackSourcePolicy].join(
        '\n\n'
    );
}

const GENERIC_TEXT_SYSTEM_PROMPT = `You are a Korean content writer inside a general workflow automation engine.
Given upstream research or user input, produce the requested text/data output without forcing a Shorts scene contract.

Respond with JSON only — no markdown fences, no extra text:
{
  "text": "final Korean text",
  "content": "same final Korean text",
  "value": "same final Korean text",
  "mode": "text",
  "sources": []
}`;

const COUNTRYBALL_FORMAT_TERMS = new Set([
    '컨트리볼',
    '국가볼',
    '폴란드볼',
    '상황극',
    '재연',
    'countryball',
    'countryballs',
    'polandball',
]);

const COUNTRYBALL_ACTION_TEMPLATES = [
    (a: string, b: string, topic: string) => `${a}이 ${topic} 팻말을 가리키며 놀라고 ${b}이 골목에서 뒷걸음질친다.`,
    (a: string, b: string, topic: string) => `${a}이 스마트폰을 들고 ${topic}을 주문하듯 보여주자 ${b}이 당황한다.`,
    (a: string, b: string, topic: string) => `${a}이 ${topic} 서류를 내밀고 ${b}이 팝콘을 떨어뜨리며 놀란다.`,
    (a: string, b: string, topic: string) => `${b}이 ${topic} 골목을 걷다가 떨고 ${a}이 손전등을 들고 뛰어온다.`,
    (a: string, b: string, topic: string) => `${a}이 ${topic} 문서를 찢듯 펼치고 ${b}이 차트를 가리키며 당황한다.`,
    (a: string, b: string, topic: string) =>
        `${a}이 ${topic} 배달 봉투를 들고 브이를 하자 ${b}이 스마트폰을 잡고 놀란다.`,
    (a: string, b: string, topic: string) => `${b}이 숨으려다 넘어지고 ${a}이 ${topic} 표지판을 들어 올린다.`,
    (a: string, b: string, topic: string) => `${a}이 줄을 세우고 ${b}이 ${topic} 체크리스트를 들고 고개를 끄덕인다.`,
    (a: string, b: string, topic: string) => `${a}이 ${topic} 한강 산책로를 걷고 ${b}이 멀리서 손을 흔들며 놀란다.`,
    (a: string, b: string, topic: string) => `${b}이 팝콘을 먹다 멈추고 ${a}이 ${topic} 지도를 가리키며 웃는다.`,
    (a: string, b: string, topic: string) => `${a}이 경례하고 ${b}이 ${topic} 알림창을 들고 당황한다.`,
    (a: string, b: string, topic: string) => `${a}이 무대 위로 올라 ${topic} 카드를 던지고 ${b}이 박수친다.`,
];

const COUNTRYBALL_VISUAL_TONES = [
    'comedy',
    'serious',
    'panic',
    'awkward',
    'satirical',
    'historical',
    'news-like',
    'chaotic',
    'calm',
] as const;

const COUNTRYBALL_PANEL_ARCHETYPES = [
    {
        id: 'headline-evidence-open',
        prompt: 'opening headline panel with newspaper cards, stacked reports, warning arrows, and a dramatic first reveal',
    },
    {
        id: 'claim-transition',
        prompt: 'motion-blur transition panel where one countryball makes a bold claim and the other reacts in shock',
    },
    {
        id: 'panic-chart',
        prompt: 'red falling chart panel, warning board, numeric callouts, and panic reaction props',
    },
    {
        id: 'mechanism-map',
        prompt: 'mechanism panel with documents, maps, money bags, factory icons, price arrows, and policy props',
    },
    {
        id: 'scale-funnel',
        prompt: 'scale panel with timeline, survival funnel, many small countryballs, queue, and crowd reaction',
    },
    {
        id: 'comparison-report',
        prompt: 'split-screen comparison report panel with tables, profit bars, folders, and scoreboard-like labels',
    },
    {
        id: 'confrontation',
        prompt: 'foreground confrontation panel where large countryballs argue over a report, paper, or prop',
    },
    {
        id: 'twist-reveal',
        prompt: 'twist reveal panel with a giant symbolic object, spotlight, arrows, and startled countryballs',
    },
    {
        id: 'reaction-closeup',
        prompt: 'reaction close-up panel with sweat drops, tears, smirk, question marks, and exaggerated eyes',
    },
    {
        id: 'payoff-punchline',
        prompt: 'payoff panel with the winning countryball on top of documents or props, V sign, torn paper, and punchline energy',
    },
];

const LONGFORM_GATE_A_SYSTEM_PROMPT = `You are a Korean longform YouTube production planner inside a general workflow automation engine.
Create longform planning artifacts for user review before any paid media execution.

Requirements:
- Do not create a Shorts scene contract.
- Do not request image generation, TTS generation, HyperFrames render, MP4 render, or final upload metadata.
- Produce source digest, outline, full script draft, scene plan, estimated duration, estimated cost, renderer route, and QA checklist.
- Preserve targetDurationSec/maxDurationSec from the node config when present.
- Keep rendererRoute as "hyperframes" unless the user explicitly asks for another renderer.
- estimatedCost is planning cost only. Paid media/render cost must not be included here.

Respond with JSON only — no markdown fences, no extra text:
{
  "sourceDigest": ["source takeaway"],
  "outline": [{ "title": "section title", "summary": "section summary" }],
  "fullScriptDraft": "complete Korean longform narration draft",
  "scenePlan": [{ "sceneNumber": 1, "title": "scene title", "visualPlan": "visual plan", "durationSec": 40 }],
  "estimatedDurationSec": 300,
  "estimatedCost": { "currency": "USD", "total": 0.2, "notes": ["Planning only"] },
  "rendererRoute": "hyperframes",
  "qaChecklist": ["source check", "script review", "scene approval"]
}`;

const buildShortsSystemPrompt = (sceneCount?: number): string => {
    if (!sceneCount) return CONTENT_SYSTEM_PROMPT;
    return CONTENT_SYSTEM_PROMPT.replace(
        'generate a complete 10–15 scene, one-minute vertical Shorts plan',
        `generate a complete exactly ${sceneCount} scenes, one-minute vertical Shorts plan`
    )
        .replace('- scenes: 10–15 scenes, each with:', `- scenes: exactly ${sceneCount} scenes, each with:`)
        .replace(
            'imageSlot: "[Image #1]" through "[Image #12]" or "[Image #15]"',
            `imageSlot: "[Image #1]" through "[Image #${sceneCount}]"`
        )
        .replace('"sceneCount": 12', `"sceneCount": ${sceneCount}`);
};

// ── Dummy (mock mode) ─────────────────────────────────────────────────────────

function dummyContent(): BlockExecutorResult {
    const start = Date.now();
    const output = {
        title: '[dummy] 핵심 요약 쇼츠',
        hook: '[dummy] 지금 이 이슈, 핵심만 보면?',
        scenes: [
            {
                sceneNumber: 1,
                caption: '[dummy] 먼저 배경',
                narration: '[dummy] 이 주제가 왜 나왔는지 배경부터 짚어봅니다.',
                imagePrompt: '[dummy] Clear Korean explainer scene, person reading article on laptop',
                visualText: '[dummy] 먼저 배경',
                sourceRefs: ['source-1'],
                durationSec: 6,
            },
            {
                sceneNumber: 2,
                caption: '[dummy] 핵심 주장',
                narration: '[dummy] 원문에서 반복되는 핵심 주장만 분리합니다.',
                imagePrompt: '[dummy] Key points being organized on a board, Korean information channel style',
                visualText: '[dummy] 핵심 주장',
                sourceRefs: ['source-1'],
                durationSec: 6,
            },
            {
                sceneNumber: 3,
                caption: '[dummy] 왜 중요하냐',
                narration: '[dummy] 이 변화가 실제 사용자에게 주는 영향을 봅니다.',
                imagePrompt: '[dummy] People comparing before and after outcomes in a clear explainer scene',
                visualText: '[dummy] 왜 중요하냐',
                sourceRefs: ['source-2'],
                durationSec: 6,
            },
            {
                sceneNumber: 4,
                caption: '[dummy] 주의할 점',
                narration: '[dummy] 확인되지 않은 내용은 단정하지 않고 따로 표시합니다.',
                imagePrompt: '[dummy] Caution sign beside a fact-check checklist in a clean explainer scene',
                visualText: '[dummy] 주의할 점',
                sourceRefs: ['source-2'],
                durationSec: 6,
            },
            {
                sceneNumber: 5,
                caption: '[dummy] 한 줄 결론',
                narration: '[dummy] 마지막에는 사용자가 바로 이해할 결론을 남깁니다.',
                imagePrompt:
                    '[dummy] Final takeaway card visual with concise in-scene text allowed, bold Korean shorts style',
                visualText: '[dummy] 한 줄 결론',
                sourceRefs: ['source-1'],
                durationSec: 6,
            },
        ],
        cta: '[dummy] 더 깊은 내용은 원문을 확인하세요.',
        totalDurationSec: 30,
        sources: [
            {
                id: 'source-1',
                title: '[dummy] 사용자 제공 원문',
                url: 'fake://news.example.com/article/001',
                source: '[dummy] Example Source',
                publishedAt: null,
                sourceType: 'other',
                confidence: 0.5,
            },
        ],
        presetId: 'generic-shorts',
    };
    return { output, durationMs: Date.now() - start };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a descriptive user message from the search block's output (or any input).
 */
function buildUserMessage(input: unknown): string {
    if (input == null) return '주제: 사용자가 요청한 콘텐츠';

    if (typeof input === 'object' && !Array.isArray(input)) {
        const obj = input as Record<string, unknown>;
        const parts: string[] = [];
        const requestedSubject = extractRequestedSubject(obj);
        const requestSpec = readRequestSpec(obj) ?? buildRequestSpec(obj);

        if (requestedSubject) {
            parts.push(`REQUESTED SUBJECT:\n${requestedSubject}`);
        }

        parts.push(`REQUEST SPEC:\n${JSON.stringify(requestSpec)}`);

        if (Array.isArray(obj['keywords']) && (obj['keywords'] as unknown[]).length > 0) {
            parts.push(`키워드: ${(obj['keywords'] as unknown[]).map(k => String(k)).join(', ')}`);
        }

        if (Array.isArray(obj['articles']) && (obj['articles'] as unknown[]).length > 0) {
            const articles = obj['articles'] as Record<string, unknown>[];
            const primarySources = articles
                .filter(article => article['primarySource'] === true)
                .sort((a, b) => Number(a['sourcePriority'] ?? 999) - Number(b['sourcePriority'] ?? 999))
                .slice(0, 3);
            if (primarySources.length > 0) {
                parts.push(
                    [
                        'PRIMARY SOURCES',
                        ...primarySources.map(primary =>
                            [
                                `PRIMARY SOURCE primarySource=true sourcePriority=${String(primary['sourcePriority'] ?? 1)}`,
                                `Title: ${String(primary['title'] ?? '')}`,
                                `URL: ${String(primary['url'] ?? '')}`,
                                `PublishedAt: ${String(primary['publishedAt'] ?? 'date unknown')}`,
                                `KeyClaims: ${Array.isArray(primary['keyClaims']) ? primary['keyClaims'].map(String).join(' / ') : ''}`,
                                `FullText: ${String(primary['fullText'] ?? primary['summary'] ?? '').slice(0, 3000)}`,
                            ].join('\n')
                        ),
                    ].join('\n\n')
                );
            }

            const summaries = articles
                .slice(0, 3)
                .map(a => {
                    const sourceFlags = [
                        a['primarySource'] === true ? 'primarySource=true' : 'primarySource=false',
                        `sourcePriority=${String(a['sourcePriority'] ?? 'unknown')}`,
                    ].join(', ');
                    return `- ${String(a['id'] ?? '')} ${String(a['title'] ?? '')} (${String(a['source'] ?? '')}, ${String(a['publishedAt'] ?? 'date unknown')}, ${String(a['sourceType'] ?? 'other')}, confidence=${String(a['confidence'] ?? 'unknown')}, ${sourceFlags})\n  URL: ${String(a['url'] ?? '')}\n  Summary: ${String(a['summary'] ?? '')}`;
                })
                .join('\n');
            const coverageSummary = articles
                .slice(0, 5)
                .map(article => {
                    const coverage = readSourceCoverage(article) ?? classifySourceCoverage(article, requestSpec);
                    return `- ${String(article['id'] ?? '') || String(article['title'] ?? '')}: ${coverage.status}; missing=${coverage.missingTerms.join(', ') || 'none'}; reason=${coverage.reason}`;
                })
                .join('\n');
            parts.push(`SOURCE COVERAGE:\n${coverageSummary}`);
            parts.push(`관련 출처:\n${summaries}`);
        }

        if (parts.length > 0) return parts.join('\n\n');
    }

    // Fallback: use topic extraction
    return `REQUESTED SUBJECT:\n${extractTopic(input)}`;
}

function extractRequestedSubject(input: Record<string, unknown>): string | undefined {
    const directKeys = ['requestTopic', 'userRequest', 'originalRequest', 'topic', 'query', 'content', 'text'];
    for (const key of directKeys) {
        const value = input[key];
        if (typeof value === 'string' && value.trim().length > 0) return value.trim().slice(0, 500);
    }

    const out = input['out'];
    if (isRecord(out)) {
        const value = out['value'];
        if (typeof value === 'string' && value.trim().length > 0) return value.trim().slice(0, 500);
    }

    return undefined;
}

// ── Executor ──────────────────────────────────────────────────────────────────

export const contentBlock: BlockExecutor = {
    blockType: 'content',

    async execute(input: unknown, config?: Record<string, unknown>): Promise<BlockExecutorResult> {
        const mode = env.orchestratorMode;
        if (mode === 'mock') return dummyContent();

        const start = Date.now();
        const userMessage = buildUserMessage(input);
        const requestSpec = readRequestSpec(input) ?? readRequestSpec(config) ?? buildRequestSpec(input);
        const rulepack = selectShortsRulepack({
            text: userMessage,
            contentProfileId: config?.['contentProfileId'],
            imageStyleId: config?.['imageStyleId'],
            narrativeMode: config?.['narrativeMode'],
        });
        const longformGateAMode = isLongformGateAMode(input, config);
        const reviewedOutput = parseReviewedOutput(config?.['reviewedOutput']);
        if (reviewedOutput) {
            if (longformGateAMode) {
                const normalized = normalizeLongformGateAOutput(reviewedOutput, input, config);
                log.info('[content-block] Using reviewed longform Gate A output');
                return { output: normalized, durationMs: Date.now() - start };
            }
            const singleImageMode = isSingleImageMode(input, config);
            const normalized = singleImageMode
                ? normalizeSingleImageOutput(reviewedOutput, input, rulepack.id)
                : normalizeContentOutput(reviewedOutput, input, rulepack.id);
            const validated = ContentOutputSchema.safeParse(normalized);
            if (!validated.success) {
                throw new Error(`[content-block] Reviewed output schema validation failed: ${validated.error.message}`);
            }
            log.info('[content-block] Using reviewed script output', {
                sceneCount: validated.data.scenes.length,
            });
            return { output: validated.data as Record<string, unknown>, durationMs: Date.now() - start };
        }

        const singleImageMode = isSingleImageMode(input, config);
        const genericTextMode = isGenericTextMode(input, config);
        const creativeSimulationMode =
            !longformGateAMode &&
            !singleImageMode &&
            !genericTextMode &&
            requestSpec.contentMode === 'creative-simulation';
        const requestedShortsSceneCount =
            !longformGateAMode && !singleImageMode && !genericTextMode ? resolveShortsSceneCount(config) : undefined;

        log.info('[content-block] Starting AI script generation', {
            messageLength: userMessage.length,
            presetId: rulepack.id,
            mode: longformGateAMode
                ? 'longform-gate-a'
                : singleImageMode
                  ? 'single-image'
                  : genericTextMode
                    ? 'text'
                    : creativeSimulationMode
                      ? 'creative-simulation-shorts'
                      : 'shorts',
        });

        const directorPrompt = `${SCRIPT_WRITER_RULES}\n\n${SCRIPT_OUTPUT_RULES}\n\n${SHORTS_DIRECTOR_RULES}\n\n${DIRECTOR_OUTPUT_RULES}`;
        const contentPreferencePrompt = buildContentPreferencePrompt(config);
        const scriptTonePrompt = buildScriptTonePrompt(config);
        const countryballPrompt = buildCountryballContentPrompt(
            rulepack.id,
            config,
            requestSpec.userRequest || userMessage
        );
        const countryballMode = rulepack.id === 'countryball-shorts';
        const systemPrompt = longformGateAMode
            ? `${LONGFORM_GATE_A_SYSTEM_PROMPT}\n\n${contentPreferencePrompt}\n\n${scriptTonePrompt}`
            : singleImageMode
              ? SINGLE_IMAGE_SYSTEM_PROMPT
              : genericTextMode
                ? `${GENERIC_TEXT_SYSTEM_PROMPT}\n\n${contentPreferencePrompt}`
                : countryballMode
                  ? buildCountryballSystemPrompt({
                        requestedShortsSceneCount,
                        countryballPrompt,
                        rulepackSourcePolicy: rulepack.sourcePolicy,
                    })
                  : `${buildShortsSystemPrompt(requestedShortsSceneCount)}\n\n${
                        requestedShortsSceneCount
                            ? `HARD SCENE COUNT: produce exactly ${requestedShortsSceneCount} scenes. Ignore any generic 10-15 scene defaults from reusable rulepacks.`
                            : ''
                    }\n\n${buildCombinedPrompt(rulepack, 'contentPrompt')}\n\n${
                        creativeSimulationMode ? `${CREATIVE_SIMULATION_SHORTS_RULES}\n\n` : ''
                    }${countryballPrompt}\n\n${scriptTonePrompt}\n\n${directorPrompt}\n\n${rulepack.sourcePolicy}`;

        const initialMaxTokens = resolveContentMaxTokens({
            longformGateAMode,
            countryballMode,
        });
        const response = await openaiAdapter.chatJson({
            model: env.openaiModel,
            systemPrompt,
            userMessage,
            maxTokens: initialMaxTokens,
        });

        let parsed = parseJsonLikeModelResponse(response.content);
        if (!parsed) {
            log.warn('[content-block] OpenAI returned invalid JSON; retrying once with stricter prompt', {
                contentLength: response.content.length,
                presetId: rulepack.id,
                maxTokens: initialMaxTokens,
                retryMaxTokens: env.openaiContentRetryMaxTokens,
            });
            const retryResponse = await openaiAdapter.chatJson({
                model: env.openaiModel,
                systemPrompt: `${systemPrompt}\n\nSTRICT RETRY: Return one complete valid JSON object only. Do not include markdown, explanations, comments, or text outside the JSON object. Close every array and object.`,
                userMessage,
                maxTokens: Math.max(env.openaiContentRetryMaxTokens, initialMaxTokens),
                maxAttempts: 1,
            });
            parsed = parseJsonLikeModelResponse(retryResponse.content);
            if (!parsed) {
                throw new Error(
                    `[content-block] OpenAI returned non-JSON response after retry (length=${retryResponse.content.length})`
                );
            }
        }

        if (longformGateAMode) {
            const normalizedLongform = normalizeLongformGateAOutput(parsed, input, config);
            log.info('[content-block] Longform Gate A generation complete', {
                estimatedDurationSec: normalizedLongform['estimatedDurationSec'],
                rendererRoute: normalizedLongform['rendererRoute'],
                latencyMs: response.latencyMs,
            });
            return { output: normalizedLongform, durationMs: Date.now() - start };
        }

        if (genericTextMode) {
            const normalizedText = normalizeGenericTextOutput(parsed, input);
            log.info('[content-block] Text generation complete', {
                textLength: typeof normalizedText.text === 'string' ? normalizedText.text.length : 0,
                latencyMs: response.latencyMs,
            });
            return { output: normalizedText, durationMs: Date.now() - start };
        }

        const normalized = singleImageMode
            ? normalizeSingleImageOutput(parsed, input, rulepack.id)
            : normalizeContentOutput(parsed, input, rulepack.id);
        const validated = ContentOutputSchema.safeParse(normalized);
        if (!validated.success) {
            throw new Error(`[content-block] Output schema validation failed: ${validated.error.message}`);
        }

        if (singleImageMode && validated.data.scenes.length !== 1) {
            throw new Error(
                `[content-block] Expected exactly 1 scene for single-image mode, got ${validated.data.scenes.length}`
            );
        }

        if (requestedShortsSceneCount && validated.data.scenes.length !== requestedShortsSceneCount) {
            throw new Error(
                `[content-block] Expected exactly ${requestedShortsSceneCount} scenes, got ${validated.data.scenes.length}`
            );
        }

        if (
            !requestedShortsSceneCount &&
            !singleImageMode &&
            (validated.data.scenes.length < 10 || validated.data.scenes.length > 15)
        ) {
            throw new Error(`[content-block] Expected 10-15 scenes, got ${validated.data.scenes.length}`);
        }

        log.info('[content-block] Script generation complete', {
            sceneCount: validated.data.scenes.length,
            totalDurationSec: validated.data.totalDurationSec,
            latencyMs: response.latencyMs,
        });

        return { output: validated.data as Record<string, unknown>, durationMs: Date.now() - start };
    },
};

function parseReviewedOutput(input: unknown): unknown | null {
    if (!input) return null;
    if (typeof input === 'object' && !Array.isArray(input)) return input;
    if (typeof input !== 'string' || input.trim().length === 0) return null;
    try {
        const parsed = JSON.parse(input);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
        throw new Error('[content-block] reviewedOutput must be valid JSON');
    }
}

function resolveContentMaxTokens(input: { longformGateAMode: boolean; countryballMode: boolean }): number {
    if (input.longformGateAMode) return env.openaiLongformGateAMaxTokens;
    if (input.countryballMode) return env.openaiCountryballContentMaxTokens;
    return env.openaiContentMaxTokens;
}

function parseJsonLikeModelResponse(content: string): unknown | null {
    const direct = tryParseJson(content);
    if (direct != null) return direct;

    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) {
        const parsed = tryParseJson(fenced);
        if (parsed != null) return parsed;
    }

    const extracted = extractFirstJsonValue(content);
    return extracted ? tryParseJson(extracted) : null;
}

function tryParseJson(content: string): unknown | null {
    try {
        return JSON.parse(content.trim());
    } catch {
        return null;
    }
}

function extractFirstJsonValue(content: string): string | null {
    const start = findFirstJsonStart(content);
    if (start < 0) return null;

    const opening = content[start];
    const closing = opening === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < content.length; index += 1) {
        const char = content[index];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }

        if (char === '"') {
            inString = true;
            continue;
        }
        if (char === opening) depth += 1;
        if (char === closing) depth -= 1;
        if (depth === 0) return content.slice(start, index + 1);
    }

    return null;
}

function findFirstJsonStart(content: string): number {
    const objectStart = content.indexOf('{');
    const arrayStart = content.indexOf('[');
    return objectStart >= 0 ? objectStart : arrayStart;
}

function isSingleImageMode(input: unknown, config?: Record<string, unknown>): boolean {
    const values: unknown[] = [config?.['mode'], config?.['type'], config?.['format'], config?.['scenario']];
    if (input && typeof input === 'object' && !Array.isArray(input)) {
        const obj = input as Record<string, unknown>;
        values.push(obj['mode'], obj['type'], obj['format'], obj['scenario']);
    }

    const modeText = values
        .filter((value): value is string => typeof value === 'string')
        .join(' ')
        .toLowerCase();

    const inputScenes =
        input && typeof input === 'object' && !Array.isArray(input)
            ? (input as Record<string, unknown>)['scenes']
            : undefined;
    const sceneCount = Number(config?.['scenes'] ?? inputScenes);

    return modeText.includes('single-image') || modeText.includes('image-only') || sceneCount === 1;
}

function isGenericTextMode(input: unknown, config?: Record<string, unknown>): boolean {
    const values: unknown[] = [
        config?.['mode'],
        config?.['type'],
        config?.['format'],
        config?.['outputType'],
        config?.['scenario'],
    ];
    if (input && typeof input === 'object' && !Array.isArray(input)) {
        const obj = input as Record<string, unknown>;
        values.push(obj['mode'], obj['type'], obj['format'], obj['outputType'], obj['scenario']);
    }

    const modeText = values
        .filter((value): value is string => typeof value === 'string')
        .join(' ')
        .toLowerCase();

    return ['text', 'summary', 'summarize', 'explain', 'write', 'rewrite', 'translate'].some(mode =>
        modeText.includes(mode)
    );
}

function resolveShortsSceneCount(config?: Record<string, unknown>): number | undefined {
    const values: unknown[] = [config?.['count'], config?.['scenes'], config?.['sceneCount'], config?.['frameCount']];
    for (const value of values) {
        const count = readPositiveInteger(value);
        if (count && count > 1 && count <= 24) return count;
    }
    return undefined;
}

function isLongformGateAMode(input: unknown, config?: Record<string, unknown>): boolean {
    const values: unknown[] = [config?.['mode'], config?.['gate'], config?.['contentProfileId']];
    if (input && typeof input === 'object' && !Array.isArray(input)) {
        const obj = input as Record<string, unknown>;
        values.push(obj['mode'], obj['gate'], obj['contentProfileId']);
    }
    const modeText = values
        .filter((value): value is string => typeof value === 'string')
        .join(' ')
        .toLowerCase();
    return modeText.includes('longform-gate-a') || modeText.includes('longform.');
}

function normalizeGenericTextOutput(parsed: unknown, input: unknown): Record<string, unknown> {
    const obj = isRecord(parsed) ? parsed : {};
    const requestSpec = readRequestSpec(input) ?? buildRequestSpec(input);
    const outputContract = buildOutputContract(requestSpec, 'text');
    const text =
        typeof obj['text'] === 'string'
            ? obj['text']
            : typeof obj['content'] === 'string'
              ? obj['content']
              : typeof obj['value'] === 'string'
                ? obj['value']
                : typeof parsed === 'string'
                  ? parsed
                  : JSON.stringify(parsed);

    const sources = extractSources(input);
    return {
        ...obj,
        text,
        content: typeof obj['content'] === 'string' ? obj['content'] : text,
        value: typeof obj['value'] === 'string' ? obj['value'] : text,
        mode: typeof obj['mode'] === 'string' ? obj['mode'] : 'text',
        requestTopic: typeof obj['requestTopic'] === 'string' ? obj['requestTopic'] : requestSpec.userRequest,
        requestSpec,
        outputContract,
        sources: Array.isArray(obj['sources']) && obj['sources'].length > 0 ? obj['sources'] : sources,
    };
}

function normalizeLongformGateAOutput(
    parsed: unknown,
    input: unknown,
    config?: Record<string, unknown>
): Record<string, unknown> {
    const obj = isRecord(parsed) ? parsed : {};
    const scenePlan = Array.isArray(obj['scenePlan']) ? obj['scenePlan'] : [];
    const generatedDurationSec =
        readPositiveNumber(obj['estimatedDurationSec']) ??
        scenePlan.reduce((sum, scene) => {
            const durationSec = isRecord(scene) ? readPositiveNumber(scene['durationSec']) : undefined;
            return sum + (durationSec ?? 40);
        }, 0) ??
        300;
    const configuredTargetDurationSec = readPositiveNumber(config?.['targetDurationSec']);
    const configuredMaxDurationSec = readPositiveNumber(config?.['maxDurationSec']);
    const requestedDurationSec = configuredTargetDurationSec ?? generatedDurationSec;
    const estimatedDurationSec = configuredMaxDurationSec
        ? Math.min(requestedDurationSec, configuredMaxDurationSec)
        : requestedDurationSec;
    const rendererRoute =
        typeof obj['rendererRoute'] === 'string'
            ? obj['rendererRoute']
            : typeof config?.['rendererRoute'] === 'string'
              ? config['rendererRoute']
              : 'hyperframes';
    const estimatedCost = isRecord(obj['estimatedCost'])
        ? obj['estimatedCost']
        : { currency: 'USD', total: 0.16, notes: ['Planning only'] };

    return {
        ...obj,
        gate: 'A',
        mode: 'longform-gate-a',
        sourceDigest: Array.isArray(obj['sourceDigest']) ? obj['sourceDigest'] : buildSourceDigest(input),
        outline: Array.isArray(obj['outline']) ? obj['outline'] : [],
        fullScriptDraft:
            typeof obj['fullScriptDraft'] === 'string'
                ? obj['fullScriptDraft']
                : typeof obj['scriptDraft'] === 'string'
                  ? obj['scriptDraft']
                  : '',
        scenePlan,
        estimatedDurationSec: estimatedDurationSec || 300,
        ...(configuredMaxDurationSec ? { maxDurationSec: configuredMaxDurationSec } : {}),
        estimatedCost,
        rendererRoute,
        qaChecklist: Array.isArray(obj['qaChecklist']) ? obj['qaChecklist'] : ['출처 확인', '대본 검수', '씬 승인'],
        mediaExecutionAllowed: false,
        sources: Array.isArray(obj['sources']) && obj['sources'].length > 0 ? obj['sources'] : extractSources(input),
    };
}

function buildSourceDigest(input: unknown): string[] {
    return extractSources(input)
        .slice(0, 5)
        .map(source => [source['title'], source['summary']].filter(Boolean).join(': '))
        .filter(text => text.trim().length > 0);
}

function normalizeContentOutput(parsed: unknown, input: unknown, presetId: string): unknown {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return parsed;
    const obj = parsed as Record<string, unknown>;
    const requestSpec = readRequestSpec(input) ?? buildRequestSpec(input);
    const requestTopic =
        input && typeof input === 'object' && !Array.isArray(input)
            ? extractRequestedSubject(input as Record<string, unknown>)
            : requestSpec.userRequest;
    const outputKind = inferOutputKind(requestSpec, obj);
    const baseOutputContract = buildOutputContract(requestSpec, outputKind);
    const outputContract =
        presetId === 'countryball-shorts'
            ? {
                  ...baseOutputContract,
                  contentProfileId: 'shorts.countryball.v1',
                  narrativeMode: 'countryball-situation-reenactment',
                  requestBasis: 'user-requested',
              }
            : baseOutputContract;
    const sources = normalizeSources(extractSources(input));
    const parsedSources = Array.isArray(obj['sources']) ? normalizeSources(obj['sources']) : [];
    const defaultSourceRefs = sourceIds(parsedSources.length > 0 ? parsedSources : sources);
    const script = isRecord(obj['script']) ? obj['script'] : {};
    const title = typeof obj['title'] === 'string' ? obj['title'] : '쇼츠 핵심 정리';
    const hook =
        typeof obj['hook'] === 'string' ? obj['hook'] : typeof script['hook'] === 'string' ? script['hook'] : title;
    const cta =
        typeof obj['cta'] === 'string'
            ? obj['cta']
            : typeof script['cta'] === 'string'
              ? script['cta']
              : '저장하고 다음에 다시 확인하세요.';
    const normalizedScenes = Array.isArray(obj['scenes'])
        ? (obj['scenes'] as Record<string, unknown>[]).map((scene, index) => ({
              ...normalizeScene(scene, index, title, defaultSourceRefs),
          }))
        : obj['scenes'];
    const scenes =
        presetId === 'countryball-shorts' && Array.isArray(normalizedScenes)
            ? normalizeCountryballScenes(normalizedScenes, requestSpec, title)
            : normalizedScenes;

    return {
        ...obj,
        requestTopic: typeof obj['requestTopic'] === 'string' ? obj['requestTopic'] : requestTopic,
        requestSpec: isRecord(obj['requestSpec']) ? obj['requestSpec'] : requestSpec,
        outputContract: isRecord(obj['outputContract']) ? obj['outputContract'] : outputContract,
        sourceCoverage: buildSourceCoverageList(input, requestSpec),
        title,
        hook: compactSpokenLine(hook, 32),
        script: {
            ...script,
            hook: compactSpokenLine(hook, 32),
            cta: compactSpokenLine(cta, 32),
        },
        style: normalizeStyle(obj['style'], Array.isArray(scenes) ? scenes.length : undefined, presetId),
        scenes,
        cta: compactSpokenLine(cta, 32),
        sources: parsedSources.length > 0 ? parsedSources : sources,
        presetId,
    };
}

function normalizeSingleImageOutput(parsed: unknown, input: unknown, presetId: string): unknown {
    const normalized = normalizeContentOutput(parsed, input, presetId);
    if (!isRecord(normalized)) return normalized;

    const scenes = Array.isArray(normalized['scenes']) ? (normalized['scenes'] as unknown[]) : [];
    const firstScene = isRecord(scenes[0]) ? scenes[0] : {};
    const existingPromptPlan = isRecord(normalized['promptPlan']) ? normalized['promptPlan'] : {};
    const style = isRecord(normalized['style']) ? normalized['style'] : {};
    const title =
        optionalString(existingPromptPlan['title']) ??
        optionalString(normalized['title']) ??
        optionalString(firstScene['topTitle']) ??
        '이미지 프롬프트';
    const imagePrompt =
        optionalString(existingPromptPlan['imagePrompt']) ?? optionalString(firstScene['imagePrompt']) ?? '';
    const aspectRatio =
        optionalString(existingPromptPlan['aspectRatio']) ?? optionalString(style['aspectRatio']) ?? '9:16';

    return {
        ...normalized,
        mode: 'single-image',
        outputKind: 'image-prompt',
        style: {
            ...style,
            format: 'single-image',
            aspectRatio,
            sceneCount: 1,
        },
        promptPlan: {
            ...existingPromptPlan,
            title,
            imagePrompt,
            aspectRatio,
            caption:
                optionalString(existingPromptPlan['caption']) ??
                optionalString(firstScene['caption']) ??
                optionalString(normalized['hook']) ??
                title,
        },
        totalDurationSec: typeof normalized['totalDurationSec'] === 'number' ? normalized['totalDurationSec'] : 5,
    };
}

function normalizeScene(
    scene: Record<string, unknown>,
    index: number,
    title: string,
    defaultSourceRefs: string[] = []
): Record<string, unknown> {
    const sceneNumber = typeof scene['sceneNumber'] === 'number' ? scene['sceneNumber'] : index + 1;
    const imageSlot = typeof scene['imageSlot'] === 'string' ? scene['imageSlot'] : `[Image #${sceneNumber}]`;
    const caption = typeof scene['caption'] === 'string' ? compactPromptText(stripMarkdown(scene['caption']), 22) : '';
    const visual = isRecord(scene['visual']) ? scene['visual'] : {};
    const topTitle =
        typeof scene['topTitle'] === 'string'
            ? compactPromptText(stripMarkdown(scene['topTitle']), 18)
            : typeof visual['topTitle'] === 'string'
              ? compactPromptText(stripMarkdown(visual['topTitle']), 18)
              : compactPromptText(title, 18);
    const mainCaption =
        typeof visual['mainCaption'] === 'string'
            ? compactPromptText(stripMarkdown(visual['mainCaption']), 18)
            : typeof scene['visualText'] === 'string'
              ? compactPromptText(stripMarkdown(scene['visualText']), 18)
              : compactPromptText(caption, 18);
    const explicitSourceRefs = Array.isArray(scene['sourceRefs']) ? normalizeSceneSourceRefs(scene['sourceRefs']) : [];
    const shouldBackfillSourceRefs =
        explicitSourceRefs.length === 0 &&
        defaultSourceRefs.length > 0 &&
        (scene['claimType'] === 'fact' || hasConcreteClaim(scene));
    const sourceRefs = shouldBackfillSourceRefs ? defaultSourceRefs : explicitSourceRefs;
    const claimType = normalizeClaimType(scene['claimType'], scene, sourceRefs);

    return {
        ...scene,
        sceneNumber,
        imageSlot,
        storyBeat: typeof scene['storyBeat'] === 'string' ? scene['storyBeat'] : storyBeatForIndex(index),
        topTitle,
        caption,
        narration:
            typeof scene['narration'] === 'string' ? compactSpokenLine(scene['narration'], 42) : scene['narration'],
        visualText: mainCaption || caption || undefined,
        visual: {
            ...visual,
            topTitle,
            mainCaption: mainCaption || caption || undefined,
            sourceLabel:
                typeof visual['sourceLabel'] === 'string' ? compactPromptText(visual['sourceLabel'], 24) : undefined,
        },
        claimType,
        sourceRefs,
    };
}

interface CountryballCastMember {
    countryCode: string;
    speaker: string;
    voiceRole: string;
}

function normalizeCountryballScenes(
    scenes: Record<string, unknown>[],
    requestSpec: RequestSpec,
    title: string
): Record<string, unknown>[] {
    const focusTerms = countryballFocusTerms(requestSpec);
    const cast = inferCountryballCast(requestSpec.userRequest, scenes);
    const normalized = scenes.map((scene, index) => {
        const primary = cast[index % cast.length] ?? cast[0] ?? defaultCountryballCast()[0];
        const secondary = cast[(index + 1) % cast.length] ?? cast[1] ?? defaultCountryballCast()[1];
        const dramatizedAction = normalizeCountryballAction(scene, index, primary, secondary, focusTerms);
        const scenePurpose = normalizeCountryballScenePurpose(scene, index, focusTerms);
        const location = normalizeCountryballLocation(scene, index);
        const visualTone = normalizeCountryballVisualTone(scene, index);
        const screenAction = optionalString(scene['screenAction']) ?? dramatizedAction;
        const dialogueLines = normalizeCountryballDialogueLines(scene, index, primary, secondary, focusTerms);
        const narratorLine = normalizeCountryballNarratorLine(scene, index);
        const narration = formatCountryballNarration(dialogueLines, scene);
        const expressionChanges = normalizeCountryballExpressionChanges(scene, index, primary, secondary);
        const sfx = normalizeCountryballSfx(scene, index);
        const editBeat = normalizeCountryballEditBeat(scene, index);
        const sourceRefs = Array.isArray(scene['sourceRefs']) ? scene['sourceRefs'] : [];
        const caption =
            optionalString(scene['caption']) && !isGenericCountryballCaption(String(scene['caption']))
                ? compactPromptText(stripMarkdown(String(scene['caption'])), 18)
                : compactPromptText(countryballCaptionForScene(index, focusTerms), 18);
        const visual = isRecord(scene['visual']) ? scene['visual'] : {};
        const characters = normalizeCountryballCharacters(scene['characters'], cast);
        const topTitle =
            optionalString(scene['topTitle']) ?? optionalString(visual['topTitle']) ?? compactPromptText(title, 18);
        const mainCaption =
            optionalString(visual['mainCaption']) && !isGenericCountryballCaption(String(visual['mainCaption']))
                ? compactPromptText(stripMarkdown(String(visual['mainCaption'])), 18)
                : caption;
        const panelArchetype = countryballPanelArchetypeForIndex(index);

        return {
            ...scene,
            storyBeat: optionalString(scene['storyBeat']) ?? countryballBeatForIndex(index),
            topTitle,
            caption,
            narration,
            visualText:
                optionalString(scene['visualText']) && !isGenericCountryballCaption(String(scene['visualText']))
                    ? compactPromptText(stripMarkdown(String(scene['visualText'])), 18)
                    : caption,
            visual: {
                ...visual,
                topTitle,
                mainCaption,
                sourceLabel: optionalString(visual['sourceLabel']),
                layout: 'countryball-infographic-skit',
                panelArchetype: panelArchetype.id,
                topTitleBand: 'black-yellow-white',
                captionTreatment: 'bold-yellow-black-outline',
                visualTone,
            },
            claimType: scene['claimType'] === 'fact' && sourceRefs.length === 0 ? 'opinion' : scene['claimType'],
            sourceRefs,
            scenePurpose,
            location,
            visualTone,
            screenAction,
            characters,
            dramatizedAction,
            dialogueLines,
            narratorLine: narratorLine ?? undefined,
            expressionChanges,
            sfx,
            editBeat,
            audioEvents: sfx.map(label => ({ type: 'sfx', label })),
            factualClaim: optionalString(scene['factualClaim']) ?? '',
            evidenceRefs: Array.isArray(scene['evidenceRefs']) ? scene['evidenceRefs'] : [],
            imagePrompt: normalizeCountryballImagePrompt(scene, {
                index,
                topTitle,
                mainCaption,
                location,
                visualTone,
                dramatizedAction,
                screenAction,
                characters,
                dialogueLines,
                expressionChanges,
            }),
        };
    });

    return ensureCountryballTopicCoverage(normalized, focusTerms);
}

function countryballFocusTerms(requestSpec: RequestSpec): string[] {
    return requestSpec.focusTerms
        .map(term => term.trim())
        .filter(Boolean)
        .filter(term => !COUNTRYBALL_FORMAT_TERMS.has(term.toLowerCase()))
        .slice(0, 6);
}

function inferCountryballCast(userRequest: string, scenes: Record<string, unknown>[]): CountryballCastMember[] {
    const text = [
        userRequest,
        ...scenes.flatMap(scene => [
            scene['caption'],
            scene['narration'],
            scene['visualText'],
            scene['dramatizedAction'],
            JSON.stringify(scene['characters'] ?? ''),
        ]),
    ]
        .filter((value): value is string => typeof value === 'string')
        .join(' ')
        .toLowerCase();
    const candidates: Array<[RegExp, CountryballCastMember]> = [
        [/한국|대한민국|\bkr\b|k-/, { countryCode: 'KR', speaker: '한국볼', voiceRole: 'main_confident' }],
        [/일본|\bjp\b|japan/, { countryCode: 'JP', speaker: '일본볼', voiceRole: 'rival_smug' }],
        [/미국|\bus\b|usa|america/, { countryCode: 'US', speaker: '미국볼', voiceRole: 'rival_smug' }],
        [/중국|\bcn\b|china/, { countryCode: 'CN', speaker: '중국볼', voiceRole: 'rival_angry' }],
        [/영국|\buk\b|britain/, { countryCode: 'UK', speaker: '영국볼', voiceRole: 'neutral_serious' }],
        [/프랑스|\bfr\b|france/, { countryCode: 'FR', speaker: '프랑스볼', voiceRole: 'panic_high' }],
        [/독일|\bde\b|germany/, { countryCode: 'DE', speaker: '독일볼', voiceRole: 'old_teacher' }],
        [/러시아|\bru\b|russia/, { countryCode: 'RU', speaker: '러시아볼', voiceRole: 'rival_angry' }],
    ];
    const cast = candidates
        .filter(([pattern]) => pattern.test(text))
        .map(([, member], index) => ({
            ...member,
            voiceRole: member.voiceRole || countryballRoleVoiceForIndex(index),
        }));
    const fallback = defaultCountryballCast();
    if (cast.length === 0) return fallback;
    if (cast.length === 1) return [cast[0] ?? fallback[0], fallback[1]];
    return cast;
}

function defaultCountryballCast(): CountryballCastMember[] {
    return [
        { countryCode: 'KR', speaker: '한국볼', voiceRole: 'main_confident' },
        { countryCode: 'GLOBAL', speaker: '외국볼', voiceRole: 'rival_smug' },
    ];
}

function countryballRoleVoiceForIndex(index: number): string {
    const roles = ['main_confident', 'rival_smug', 'panic_high', 'neutral_serious', 'rival_angry', 'main_tired'];
    return roles[index % roles.length] ?? 'neutral_serious';
}

function normalizeCountryballAction(
    scene: Record<string, unknown>,
    index: number,
    primary: CountryballCastMember,
    secondary: CountryballCastMember,
    focusTerms: string[]
): string {
    const current = optionalString(scene['dramatizedAction']);
    if (current && hasConcreteCountryballAction(current)) return current;
    const topic = focusTerms.length > 0 ? focusTerms.slice(0, 3).join(' ') : '요청 주제';
    const template =
        COUNTRYBALL_ACTION_TEMPLATES[index % COUNTRYBALL_ACTION_TEMPLATES.length] ?? COUNTRYBALL_ACTION_TEMPLATES[0];
    return template(primary.speaker, secondary.speaker, topic);
}

function normalizeCountryballScenePurpose(scene: Record<string, unknown>, index: number, focusTerms: string[]): string {
    const current = optionalString(scene['scenePurpose']);
    if (current) return compactPromptText(stripMarkdown(current), 80);
    const topic = focusTerms.length > 0 ? focusTerms.slice(0, 3).join(' ') : '요청 상황';
    const purposes = [
        `${topic}의 첫 충돌을 바로 보여준다`,
        `${topic}에서 서로 다른 반응을 대사로 드러낸다`,
        `${topic}의 핵심 긴장을 행동으로 키운다`,
        `${topic}의 오해나 반전을 짧게 터뜨린다`,
        `${topic}의 결말 감정을 한 줄로 남긴다`,
    ];
    return purposes[index % purposes.length] ?? `${topic} 상황극을 진행한다`;
}

function normalizeCountryballLocation(scene: Record<string, unknown>, index: number): string {
    const current = optionalString(scene['location']);
    if (current) return compactPromptText(stripMarkdown(current), 60);
    const locations = [
        '긴장감 있는 회의실',
        '현장감 있는 거리',
        '뉴스 인터뷰 세트',
        '지도와 서류가 놓인 작전실',
        '사람들이 몰린 광장',
        '소품이 쌓인 작업장',
    ];
    return locations[index % locations.length] ?? '상황극 무대';
}

function normalizeCountryballVisualTone(scene: Record<string, unknown>, index: number): string {
    const current = optionalString(scene['visualTone']);
    if (current && COUNTRYBALL_VISUAL_TONES.includes(current as (typeof COUNTRYBALL_VISUAL_TONES)[number])) {
        return current;
    }
    const text = [
        scene['caption'],
        scene['narration'],
        scene['dramatizedAction'],
        scene['screenAction'],
        scene['imagePrompt'],
    ]
        .filter((value): value is string => typeof value === 'string')
        .join(' ');
    if (/패닉|위기|도망|떨|당황|무서|panic|crisis/i.test(text)) return 'panic';
    if (/역사|전쟁|조선|중립|왕|군|histor/i.test(text)) return 'historical';
    if (/뉴스|보도|인터뷰|기자|news/i.test(text)) return 'news-like';
    if (/회의|협상|서류|계약|무역/.test(text)) return 'satirical';
    return COUNTRYBALL_VISUAL_TONES[index % COUNTRYBALL_VISUAL_TONES.length] ?? 'comedy';
}

function hasConcreteCountryballAction(input: string): boolean {
    const text = input.trim();
    if (text.length < 18) return false;
    if (/설명|해설|나레이션|상황극\s*장면|재연하는\s*설명/.test(text)) return false;
    if (
        !/[가-힣A-Za-z]+볼|[가-힣A-Za-z]+공|\b(?:KR|JP|US|CN|UK|FR|DE)\b|한국|일본|미국|중국|영국|프랑스|독일/.test(
            text
        )
    ) {
        return false;
    }
    return /걷|뛰|도망|떨|숨|가리키|던지|내밀|끄덕|열|찢|잡|들고|들어|줄을|쌓|주문|먹|마시|웃|울|당황|놀라|비웃|빼|꺼내|올라|브이|서류|스마트폰|배달|골목|한강|팝콘|차트|금|반지|문서|경례|박수|흔들|쓰러|올려/.test(
        text
    );
}

function normalizeCountryballDialogueLines(
    scene: Record<string, unknown>,
    index: number,
    primary: CountryballCastMember,
    secondary: CountryballCastMember,
    focusTerms: string[]
): Array<Record<string, unknown>> {
    const rawLines = Array.isArray(scene['dialogueLines']) ? scene['dialogueLines'] : [];
    const normalized = rawLines
        .map((line, lineIndex) => normalizeCountryballDialogueLine(line, lineIndex === 0 ? primary : secondary))
        .filter((line): line is Record<string, unknown> => Boolean(line))
        .slice(0, 4);
    if (normalized.length >= 2 || index >= 10) return normalized;

    const topic = focusTerms.length > 0 ? focusTerms.slice(0, 2).join(' ') : '이 상황';
    const firstText = normalized[0] ?? {
        country: countryNameFromCast(primary),
        line: compactSpokenLine(index % 3 === 0 ? `${topic}? 못 지나가지!` : `바로 움직인다!`, 18),
        tone: index % 2 === 0 ? '자신 있게' : '다급하게',
        speaker: primary.speaker,
        text: compactSpokenLine(index % 3 === 0 ? `${topic}? 못 지나가지!` : `바로 움직인다!`, 18),
        emotion: index % 2 === 0 ? 'confident' : 'shocked',
        delivery: 'short skit line',
        meaning: '장면의 행동을 짧게 터뜨리는 대사',
        voiceRole: primary.voiceRole,
        captionStyle: 'bold',
        durationSec: 1.2,
        pauseAfterMs: 120,
    };
    const secondText =
        index % 3 === 1 ? `잠깐, 이거 뭐야?!` : index % 3 === 2 ? `너 또 시작이야?` : `왜 이렇게 빠른데?`;
    return [
        firstText,
        {
            country: countryNameFromCast(secondary),
            line: compactSpokenLine(secondText, 18),
            tone: '당황한 반응',
            speaker: secondary.speaker,
            text: compactSpokenLine(secondText, 18),
            emotion: 'shocked',
            delivery: 'quick reaction line',
            meaning: '상대 국가볼이 상황에 즉시 반응한다',
            voiceRole: secondary.voiceRole,
            captionStyle: 'bold',
            durationSec: 1.2,
            pauseAfterMs: 0,
        },
    ];
}

function normalizeCountryballDialogueLine(
    line: unknown,
    fallbackSpeaker: CountryballCastMember
): Record<string, unknown> | undefined {
    if (typeof line === 'string') {
        const text = compactSpokenLine(stripMarkdown(line), 18);
        if (!text) return undefined;
        return {
            country: countryNameFromCast(fallbackSpeaker),
            line: text,
            tone: '즉각 반응',
            speaker: fallbackSpeaker.speaker,
            text,
            emotion: 'reactive',
            delivery: 'short skit line',
            voiceRole: fallbackSpeaker.voiceRole,
            captionStyle: 'bold',
            durationSec: 1.2,
        };
    }
    if (!isRecord(line)) return undefined;
    const text = optionalString(line['line']) ?? optionalString(line['text']);
    if (!text) return undefined;
    const speaker = optionalString(line['speaker']) ?? fallbackSpeaker.speaker;
    const compactText = compactSpokenLine(stripMarkdown(text), 18);
    const country =
        optionalString(line['country']) ?? countryNameFromSpeaker(speaker) ?? countryNameFromCast(fallbackSpeaker);
    return {
        ...line,
        country,
        line: compactText,
        tone: optionalString(line['tone']) ?? optionalString(line['delivery']) ?? '짧은 상황극 톤',
        speaker,
        text: compactText,
        emotion: optionalString(line['emotion']) ?? 'reactive',
        delivery: optionalString(line['delivery']) ?? 'short skit line',
        voiceRole: optionalString(line['voiceRole']) ?? fallbackSpeaker.voiceRole,
        captionStyle: optionalString(line['captionStyle']) ?? 'bold',
        captionEmphasis: Array.isArray(line['captionEmphasis'])
            ? line['captionEmphasis'].map(String).filter(Boolean).slice(0, 2)
            : [],
        durationSec: typeof line['durationSec'] === 'number' ? Math.min(line['durationSec'], 1.8) : 1.2,
        pauseAfterMs: typeof line['pauseAfterMs'] === 'number' ? Math.max(0, Math.min(line['pauseAfterMs'], 1200)) : 0,
    };
}

function normalizeCountryballNarratorLine(
    scene: Record<string, unknown>,
    index: number
): Record<string, unknown> | undefined {
    const narratorLine = scene['narratorLine'];
    const narratorText =
        typeof narratorLine === 'string'
            ? narratorLine
            : isRecord(narratorLine)
              ? optionalString(narratorLine['text'])
              : undefined;
    const current = narratorText ?? optionalString(scene['narration']);
    if (!current) return undefined;
    if (!isAllowedCountryballNarratorText(current, index)) return undefined;
    return { text: compactSpokenLine(stripMarkdown(current), 28), voiceRole: 'narrator_short' };
}

function isAllowedCountryballNarratorText(input: string, index: number): boolean {
    const text = stripMarkdown(input).trim();
    if (!text || text.length > 32) return false;
    if (/공식 지표|보도에 따르면|연구에 따르면|설명|해설|나레이션|보여줍니다|입니다/.test(text)) return false;
    if (index === 0 || index >= 10) return true;
    return /\d{4}년|\d+년\s*뒤|잠시\s*후|그때|며칠\s*후|엔딩/.test(text);
}

function formatCountryballNarration(
    dialogueLines: Array<Record<string, unknown>>,
    scene: Record<string, unknown>
): string {
    const dialogueText = dialogueLines
        .map(line => {
            const speaker = optionalString(line['speaker']) ?? optionalString(line['country']);
            const text = optionalString(line['text']) ?? optionalString(line['line']);
            if (!speaker || !text) return text ?? '';
            return `${speaker}: ${text}`;
        })
        .filter(Boolean)
        .join(' ');
    if (dialogueText) return compactSpokenLine(dialogueText, 120);

    const fallback =
        optionalString(scene['caption']) ?? optionalString(scene['visualText']) ?? '국가볼들이 서로 눈치를 봅니다.';
    return compactSpokenLine(`국가볼: ${fallback}`, 60);
}

function countryNameFromCast(member: CountryballCastMember): string {
    return countryNameFromSpeaker(member.speaker) ?? member.countryCode;
}

function countryNameFromSpeaker(speaker: string): string | undefined {
    const normalized = speaker.trim().toUpperCase();
    const map: Record<string, string> = {
        KR: '한국',
        KOR: '한국',
        한국볼: '한국',
        JP: '일본',
        JPN: '일본',
        일본볼: '일본',
        US: '미국',
        USA: '미국',
        미국볼: '미국',
        CN: '중국',
        CHN: '중국',
        중국볼: '중국',
        UK: '영국',
        GB: '영국',
        영국볼: '영국',
        FR: '프랑스',
        프랑스볼: '프랑스',
        DE: '독일',
        독일볼: '독일',
        RU: '러시아',
        러시아볼: '러시아',
        외국볼: '외국',
    };
    return map[normalized] ?? map[speaker.trim()];
}

function normalizeCountryballExpressionChanges(
    scene: Record<string, unknown>,
    index: number,
    primary: CountryballCastMember,
    secondary: CountryballCastMember
): string[] {
    if (Array.isArray(scene['expressionChanges'])) {
        const values = scene['expressionChanges'].map(String).map(stripMarkdown).filter(Boolean).slice(0, 4);
        if (values.length > 0) return values;
    }
    const templates = [
        `${primary.speaker} 눈썹이 확 올라간다`,
        `${secondary.speaker} 눈이 동그래진다`,
        `${primary.speaker}가 씩 웃는다`,
        `${secondary.speaker}가 식은땀을 흘린다`,
    ];
    return [templates[index % templates.length] ?? `${primary.speaker} 표정이 바뀐다`];
}

function normalizeCountryballSfx(scene: Record<string, unknown>, index: number): string[] {
    if (Array.isArray(scene['sfx'])) {
        const values = scene['sfx'].map(String).map(stripMarkdown).filter(Boolean).slice(0, 4);
        if (values.length > 0) return values;
    }
    const sfx = ['빰!', '띵!', '끼익!', '웅성웅성', '쾅!', '삐비빅', '휙!', '정적'];
    return [sfx[index % sfx.length] ?? '팍!'];
}

function normalizeCountryballEditBeat(scene: Record<string, unknown>, index: number): string {
    const current = optionalString(scene['editBeat']);
    if (current) return compactPromptText(stripMarkdown(current), 80);
    const beats = [
        '첫 대사에 빠른 줌인',
        '상대 반응으로 즉시 컷',
        '소품 클로즈업 후 표정 리액션',
        '짧은 정적 뒤 효과음 컷',
        'BGM을 반 박자 올리고 다음 장면 전환',
    ];
    return beats[index % beats.length] ?? '빠른 컷 전환';
}

function normalizeCountryballCharacters(input: unknown, cast: CountryballCastMember[]): Array<Record<string, unknown>> {
    if (Array.isArray(input) && input.some(isRecord)) {
        return input.filter(isRecord).map((character, index) => {
            const fallback = cast[index % cast.length] ?? defaultCountryballCast()[0];
            return {
                ...character,
                countryCode: optionalString(character['countryCode']) ?? fallback.countryCode,
                roleInScene: optionalString(character['roleInScene']) ?? '상황극 캐릭터',
                expression: optionalString(character['expression']) ?? (index === 0 ? 'confident' : 'shocked'),
                pose: optionalString(character['pose']) ?? (index === 0 ? 'pointing' : 'reacting'),
            };
        });
    }
    return cast.slice(0, 3).map((member, index) => ({
        countryCode: member.countryCode,
        roleInScene: index === 0 ? '상황을 주도하는 국가볼' : '상황에 반응하는 국가볼',
        expression: index === 0 ? 'confident' : 'shocked',
        pose: index === 0 ? 'pointing' : 'reacting',
    }));
}

function normalizeCountryballImagePrompt(
    scene: Record<string, unknown>,
    input: {
        index: number;
        topTitle: string;
        mainCaption: string;
        location: string;
        visualTone: string;
        dramatizedAction: string;
        screenAction: string;
        characters: Array<Record<string, unknown>>;
        dialogueLines: Array<Record<string, unknown>>;
        expressionChanges: string[];
    }
): string {
    const existing = optionalString(scene['imagePrompt']);
    const panelArchetype = countryballPanelArchetypeForIndex(input.index);
    const castLabel = input.characters
        .map(character => optionalString(character['countryCode']))
        .filter(Boolean)
        .join(', ');
    const dialogueCaption = countryballDialogueCaption(input.dialogueLines, input.mainCaption);
    const skitPrompt = [
        'Countryball comic infographic skit central artwork for a vertical 9:16 Shorts frame.',
        'Final compositor will add the black top title band and yellow/white title text; do not render final-video title bands inside the image.',
        `Persistent topic title meaning for composition: "${input.topTitle}".`,
        `Upper/middle evidence/infographic comic panel: ${panelArchetype.prompt}.`,
        `Location: ${input.location}.`,
        `Visual tone: ${input.visualTone}.`,
        'Use dense readable situation props such as documents, newspaper cards, charts, red arrows, maps, factories, money bags, timelines, warning boards, reports, or props matching this specific scene.',
        'Lower foreground reaction stage with large round flag-faced countryballs, exaggerated eyes, sweat, tears, smirk, shock, pointing arms, holding reports, or arguing.',
        `Final compositor will overlay a bold yellow Korean dialogue/reaction caption with black outline, caption meaning: "${dialogueCaption}". Keep visual space for it but do not bake the final subtitle band into the image.`,
        `Cast: ${castLabel || 'countryballs'}.`,
        `Visible action: ${input.screenAction || input.dramatizedAction}.`,
        `Expression changes: ${input.expressionChanges.join(', ')}.`,
        'Do not make a plain narrator explainer or two countryballs talking on an empty background.',
    ].join(' ');
    if (!existing || /generic|explainer/i.test(existing)) return skitPrompt;
    return `${existing} ${skitPrompt}`;
}

function countryballPanelArchetypeForIndex(index: number): { id: string; prompt: string } {
    return COUNTRYBALL_PANEL_ARCHETYPES[index % COUNTRYBALL_PANEL_ARCHETYPES.length] ?? COUNTRYBALL_PANEL_ARCHETYPES[0];
}

function countryballDialogueCaption(dialogueLines: Array<Record<string, unknown>>, fallback: string): string {
    const firstText = dialogueLines
        .map(line => optionalString(line['line']) ?? optionalString(line['text']))
        .find(Boolean);
    return compactPromptText(firstText ?? fallback, 18);
}

function ensureCountryballTopicCoverage(
    scenes: Record<string, unknown>[],
    focusTerms: string[]
): Record<string, unknown>[] {
    if (scenes.length === 0 || focusTerms.length === 0) return scenes;
    const bodyText = scenes
        .flatMap(scene => {
            const visual = isRecord(scene['visual']) ? scene['visual'] : {};
            const dialogueLines = Array.isArray(scene['dialogueLines']) ? scene['dialogueLines'] : [];
            return [
                scene['caption'],
                scene['narration'],
                scene['visualText'],
                visual['mainCaption'],
                ...dialogueLines.map(line => (isRecord(line) ? line['text'] : line)),
            ];
        })
        .filter((value): value is string => typeof value === 'string')
        .join(' ');
    const missing = focusTerms.filter(term => !bodyText.includes(term));
    if (missing.length === 0) return scenes;

    const first = scenes[0] ?? {};
    const visual = isRecord(first['visual']) ? first['visual'] : {};
    const dialogueLines = Array.isArray(first['dialogueLines']) ? first['dialogueLines'] : [];
    const coveragePhrase = focusTerms.slice(0, 4).join(' ');
    const caption = compactPromptText(coveragePhrase, 18);
    const firstDialogue = isRecord(dialogueLines[0]) ? dialogueLines[0] : {};
    return [
        {
            ...first,
            caption,
            visualText: caption,
            narration: compactSpokenLine(`한국볼: ${coveragePhrase}? 바로 간다!`, 60),
            visual: {
                ...visual,
                mainCaption: caption,
            },
            dialogueLines: [
                {
                    ...firstDialogue,
                    country: optionalString(firstDialogue['country']) ?? '한국',
                    line: compactSpokenLine(`${coveragePhrase}? 바로 간다!`, 18),
                    tone: optionalString(firstDialogue['tone']) ?? '자신 있게',
                    speaker: optionalString(firstDialogue['speaker']) ?? '한국볼',
                    text: compactSpokenLine(`${coveragePhrase}? 바로 간다!`, 18),
                    voiceRole: optionalString(firstDialogue['voiceRole']) ?? 'main_confident',
                    captionStyle: optionalString(firstDialogue['captionStyle']) ?? 'bold',
                    durationSec: typeof firstDialogue['durationSec'] === 'number' ? firstDialogue['durationSec'] : 1.2,
                },
                ...dialogueLines.slice(1, 3),
            ],
        },
        ...scenes.slice(1),
    ];
}

function isGenericCountryballCaption(input: string): boolean {
    return /설명\s*장면|상황극\s*\d+|장면\s*\d+/.test(input);
}

function countryballCaptionForScene(index: number, focusTerms: string[]): string {
    const topic = focusTerms.length > 0 ? focusTerms.slice(0, 2).join(' ') : '국가볼 충돌';
    const suffixes = ['터졌다', '뭐야?', '바로 반응', '눈치 싸움', '판 뒤집힘'];
    return `${topic} ${suffixes[index % suffixes.length] ?? '반응'}`;
}

function countryballBeatForIndex(index: number): string {
    const beats = ['hook', 'setup', 'tension', 'action', 'reaction', 'twist', 'payoff', 'cta'];
    if (index === 0) return 'hook';
    return beats[Math.min(beats.length - 1, Math.floor((index / 12) * beats.length))] ?? 'action';
}

function normalizeStyle(input: unknown, sceneCount?: number, presetId?: string): Record<string, unknown> {
    const style = isRecord(input) ? input : {};
    const visualGrammar = isRecord(style['visualGrammar']) ? style['visualGrammar'] : {};
    const isCountryball = presetId === 'countryball-shorts';
    return {
        ...style,
        format: typeof style['format'] === 'string' ? style['format'] : 'vertical-shorts',
        aspectRatio: typeof style['aspectRatio'] === 'string' ? style['aspectRatio'] : '9:16',
        sceneCount: typeof style['sceneCount'] === 'number' ? style['sceneCount'] : sceneCount,
        ...(isCountryball
            ? {
                  visualStyle: 'countryball-comic',
                  narrativeMode: 'countryball-situation-reenactment',
                  requestBasis: 'user-requested',
                  visualGrammar: {
                      ...visualGrammar,
                      reenactment: true,
                      characterSystem: 'countryball',
                      referenceLayout: 'countryball-infographic-skit',
                      topTitleBand: 'black-yellow-white',
                      panelStructure: 'middle-evidence-panel-lower-reaction-stage',
                      captionTreatment: 'bold-yellow-black-outline',
                  },
              }
            : {}),
    };
}

function storyBeatForIndex(index: number): string {
    const beats = ['hook', 'setup', 'escalation', 'reveal', 'takeaway', 'cta'];
    if (index === 0) return 'hook';
    return beats[Math.min(beats.length - 1, Math.floor((index / 12) * beats.length))] ?? 'takeaway';
}

function normalizeClaimType(input: unknown, scene: Record<string, unknown>, sourceRefs: unknown[]): string {
    if (input === 'fact' && sourceRefs.length === 0 && isQuestionOnlyScene(scene)) return 'opinion';
    if (input === 'fact' && sourceRefs.length === 0 && !hasConcreteClaim(scene)) return 'opinion';
    if (input === 'fact' || input === 'hypothetical' || input === 'opinion' || input === 'joke') return input;
    if (sourceRefs.length > 0) return 'fact';

    const text = [scene['caption'], scene['visualText'], scene['narration']]
        .filter((value): value is string => typeof value === 'string')
        .join(' ');
    if (hasConcreteClaim({ caption: text })) return 'fact';
    return 'opinion';
}

function isQuestionOnlyScene(scene: Record<string, unknown>): boolean {
    const text = [scene['caption'], scene['visualText'], scene['narration']]
        .filter((value): value is string => typeof value === 'string')
        .join(' ');
    if (!/[?？]|\bwhy\b|왜|뭐|무엇|어떻게|정말/.test(text)) return false;
    return !/\d{4}|\d+월|\d+일|\d+%|\d+등급|\d+점/.test(text);
}

function isRecord(input: unknown): input is Record<string, unknown> {
    return input != null && typeof input === 'object' && !Array.isArray(input);
}

function readRequestSpec(input: unknown): RequestSpec | undefined {
    if (!isRecord(input)) return undefined;
    const requestSpec = input['requestSpec'];
    if (!isRecord(requestSpec)) return undefined;
    const userRequest = optionalString(requestSpec['userRequest']);
    if (!userRequest) return undefined;
    const focusTerms = Array.isArray(requestSpec['focusTerms']) ? requestSpec['focusTerms'].map(String) : [];
    const fallbackSpec = buildRequestSpec(userRequest);
    const understanding = isRecord(requestSpec['understanding'])
        ? {
              surfaceTerms: Array.isArray(requestSpec['understanding']['surfaceTerms'])
                  ? requestSpec['understanding']['surfaceTerms'].map(String)
                  : fallbackSpec.understanding.surfaceTerms,
              focusEntities: Array.isArray(requestSpec['understanding']['focusEntities'])
                  ? requestSpec['understanding']['focusEntities'].map(String)
                  : focusTerms,
              actions: Array.isArray(requestSpec['understanding']['actions'])
                  ? requestSpec['understanding']['actions'].map(String)
                  : fallbackSpec.understanding.actions,
              constraints: Array.isArray(requestSpec['understanding']['constraints'])
                  ? requestSpec['understanding']['constraints'].map(String)
                  : fallbackSpec.understanding.constraints,
              styleHints: Array.isArray(requestSpec['understanding']['styleHints'])
                  ? requestSpec['understanding']['styleHints'].map(String)
                  : fallbackSpec.understanding.styleHints,
          }
        : {
              ...fallbackSpec.understanding,
              focusEntities: focusTerms.length > 0 ? focusTerms : fallbackSpec.understanding.focusEntities,
          };
    return {
        userRequest,
        contentIntent:
            requestSpec['contentIntent'] === 'single-image' ||
            requestSpec['contentIntent'] === 'blog-post' ||
            requestSpec['contentIntent'] === 'shorts' ||
            requestSpec['contentIntent'] === 'longform' ||
            requestSpec['contentIntent'] === 'explanation' ||
            requestSpec['contentIntent'] === 'research' ||
            requestSpec['contentIntent'] === 'unknown'
                ? requestSpec['contentIntent']
                : 'unknown',
        outputKind: readOutputKind(requestSpec['outputKind']),
        ...(requestSpec['contentMode'] === 'creative-simulation' ? { contentMode: requestSpec['contentMode'] } : {}),
        understanding,
        focusTerms: focusTerms.length > 0 ? focusTerms : understanding.focusEntities,
        exactSubjectRequired:
            typeof requestSpec['exactSubjectRequired'] === 'boolean' ? requestSpec['exactSubjectRequired'] : true,
    };
}

function readSourceCoverage(input: Record<string, unknown>): SourceCoverage | undefined {
    const coverage = input['coverage'];
    if (!isRecord(coverage)) return undefined;
    const status = coverage['status'];
    if (status !== 'direct' && status !== 'supporting' && status !== 'unrelated') return undefined;
    return {
        status,
        matchedTerms: Array.isArray(coverage['matchedTerms']) ? coverage['matchedTerms'].map(String) : [],
        missingTerms: Array.isArray(coverage['missingTerms']) ? coverage['missingTerms'].map(String) : [],
        reason: optionalString(coverage['reason']) ?? '',
    };
}

function buildSourceCoverageList(input: unknown, requestSpec: RequestSpec): Array<Record<string, unknown>> {
    return extractSources(input).map(source => ({
        id: source['id'],
        title: source['title'],
        ...(readSourceCoverage(source) ?? classifySourceCoverage(source, requestSpec)),
    }));
}

function inferOutputKind(requestSpec: RequestSpec, parsed: Record<string, unknown>): OutputKind {
    if (requestSpec.outputKind !== 'unknown') return requestSpec.outputKind;
    const style = isRecord(parsed['style']) ? parsed['style'] : {};
    if (style['format'] === 'single-image') return 'image';
    if (style['format'] === 'vertical-shorts') return 'video';
    return requestSpec.outputKind;
}

function readOutputKind(input: unknown): OutputKind {
    return input === 'text' ||
        input === 'image' ||
        input === 'audio' ||
        input === 'video' ||
        input === 'data' ||
        input === 'unknown'
        ? input
        : 'unknown';
}

function compactSpokenLine(value: string, maxChars: number): string {
    const cleaned = value.replace(/\s+/g, ' ').trim();
    if (cleaned.length <= maxChars) return cleaned;

    const firstSentence = cleaned.split(/(?<=[.!?。！？]|요\.|다\.|죠\.|니다\.)\s+/)[0]?.trim();
    if (firstSentence && firstSentence.length <= maxChars) return firstSentence;

    const sliced = cleaned.slice(0, Math.max(1, maxChars - 1)).replace(/[,\s.]+$/g, '');
    return `${sliced}.`;
}

function compactPromptText(value: string, maxChars: number): string {
    const compact = value.replace(/\s+/g, ' ').trim();
    if (compact.length <= maxChars) return compact;
    return `${compact.slice(0, Math.max(1, maxChars - 1)).trim()}...`;
}

function readPositiveNumber(input: unknown): number | undefined {
    const value = Number(input);
    return Number.isFinite(value) && value > 0 ? value : undefined;
}

function readPositiveInteger(input: unknown): number | undefined {
    const value = readPositiveNumber(input);
    if (!value || !Number.isInteger(value)) return undefined;
    return value;
}

function stripMarkdown(value: string): string {
    return value
        .replace(/\*\*/g, '')
        .replace(/__/g, '')
        .replace(/[`*_~]/g, '')
        .trim();
}

function normalizeSceneSourceRefs(sourceRefs: unknown[]): unknown[] {
    return sourceRefs
        .map(sourceRef => {
            if (typeof sourceRef === 'string') return sourceRef;
            if (isRecord(sourceRef)) return normalizeSource(sourceRef, 0);
            return undefined;
        })
        .filter((sourceRef): sourceRef is string | Record<string, unknown> => Boolean(sourceRef));
}

function sourceIds(sources: Array<Record<string, unknown>>): string[] {
    return sources.map(source => optionalString(source['id'])).filter((id): id is string => Boolean(id));
}

function hasConcreteClaim(scene: Record<string, unknown>): boolean {
    const text = [scene['caption'], scene['visualText'], scene['narration']]
        .filter((value): value is string => typeof value === 'string')
        .join(' ');
    return /\d{4}|\d+월|\d+일|\d+%|\d+등급|\d+점/.test(text);
}

function normalizeSources(sources: unknown[]): Array<Record<string, unknown>> {
    return sources
        .map((source, index) => (isRecord(source) ? normalizeSource(source, index) : undefined))
        .filter((source): source is Record<string, unknown> => Boolean(source));
}

function normalizeSource(source: Record<string, unknown>, index: number): Record<string, unknown> {
    return {
        id: optionalString(source['id']) ?? `source-${index + 1}`,
        title: optionalString(source['title']),
        url: optionalString(source['url']),
        source: optionalString(source['source']),
        publishedAt: source['publishedAt'] === null ? null : optionalString(source['publishedAt']),
        sourceType: normalizeSourceType(source['sourceType']),
        confidence: normalizeConfidence(source['confidence']),
        summary: optionalString(source['summary']),
        fullText: optionalString(source['fullText']),
        keyClaims: Array.isArray(source['keyClaims']) ? source['keyClaims'].map(String) : undefined,
        primarySource: typeof source['primarySource'] === 'boolean' ? source['primarySource'] : undefined,
        sourcePriority: typeof source['sourcePriority'] === 'number' ? source['sourcePriority'] : undefined,
    };
}

function optionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value : undefined;
}

function normalizeSourceType(value: unknown): 'official' | 'news' | 'blog' | 'other' | undefined {
    if (value === 'official' || value === 'news' || value === 'blog' || value === 'other') return value;
    return undefined;
}

function normalizeConfidence(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined;
}

function extractSources(input: unknown): Array<Record<string, unknown>> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return [];
    const obj = input as Record<string, unknown>;
    if (!Array.isArray(obj['articles'])) return [];
    return (obj['articles'] as Record<string, unknown>[]).map((article, index) => ({
        id: typeof article['id'] === 'string' ? article['id'] : `source-${index + 1}`,
        title: article['title'],
        url: article['url'],
        source: article['source'],
        publishedAt: article['publishedAt'] ?? null,
        sourceType: article['sourceType'] ?? 'other',
        confidence: article['confidence'] ?? 0.6,
        summary: article['summary'],
        fullText: article['fullText'],
        keyClaims: article['keyClaims'],
        primarySource: article['primarySource'],
        sourcePriority: article['sourcePriority'],
    }));
}
