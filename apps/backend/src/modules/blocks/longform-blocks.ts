import { contentBlock } from './content-block';
import { mediaTtsBlock } from './media-tts-block';
import { mediaVideoBlock } from './media-video-block';
import { searchBlock } from './search-block';
import { openaiAdapter } from '../../adapters/ai/openai-adapter';
import { env } from '../../config/env';

import type { BlockExecutor, BlockExecutorResult } from './types';

type RecordValue = Record<string, unknown>;

const DEFAULT_DURATION_SEC = 300;
const DEFAULT_SECTION_COUNT = 5;

const LONGFORM_SOURCE_RESEARCH_SYSTEM_PROMPT = `You are an AI longform source researcher.
Read the collected primary source text and produce a factual research brief for a Korean longform video.

Rules:
- The provided URL text is the primary source. Do not replace it with generic web background.
- Extract concrete claims, entities, dates, numbers, caveats, and what the viewer should understand.
- Do not include raw HTML, XML, script dumps, CSS, or boilerplate.
- Return JSON only:
{
  "sourceDigest": ["compact factual takeaway"],
  "factualSpine": { "what": "...", "whyItMatters": "...", "caveats": ["..."] },
  "keywords": ["..."],
  "confidence": 0.9
}`;

const LONGFORM_BRIEF_SYSTEM_PROMPT = `You are an AI longform angle strategist.
Convert researched source material into a viewer-facing longform brief.

Rules:
- Choose the strongest explanatory angle for the user's request.
- Keep the primary source as the factual anchor.
- Do not start paid media work.
- Return JSON only:
{
  "titleCandidates": ["..."],
  "viewerPromise": "...",
  "targetViewer": "...",
  "angle": "...",
  "structure": "explainer|analysis|tutorial|comparison|story",
  "evidencePlan": [{ "sourceId": "source-1", "useAt": "context|proof|caveat", "visualUse": "source-proof|quote-card|timeline|comparison" }]
}`;

const LONGFORM_STORYBOARD_SYSTEM_PROMPT = `You are an AI longform visual storyboard director.
Turn a Korean longform script into Hyperframes-ready visual chapters.

Rules:
- Design chapter-level motion-graphics scenes, not one static text card per paragraph.
- Use source-proof cards, event timelines, comparisons, metric reveals, fact cards, quote cards, and process flows when useful.
- Every object id must be stable and derived from the section id.
- Never return placeholder visual archetypes such as chapter-board.
- Every chapter must include a meaningful subtitleDraft and visualData for its visualArchetype.
- Return JSON only:
{
  "visualChapters": [
    {
      "chapterId": "chapter-1",
      "sectionId": "section-1",
      "headline": "...",
      "visualArchetype": "source-proof|event-timeline|comparison|metric-reveal|fact-card|quote-card|process-flow",
      "viewerPurpose": "...",
      "subtitleDraft": "one concise Korean on-screen subtitle line",
      "visualData": { "title": "...", "claims": ["..."], "items": ["..."], "body": "..." },
      "objects": [{ "id": "section-1-headline", "type": "headline|quote|metric|diagram|caption", "text": "..." }],
      "motionPlan": "..."
    }
  ]
}`;

const LONGFORM_MOTION_SYSTEM_PROMPT = `You are an AI longform motion graphics director.
Create a compact Hyperframes motion direction blueprint from scene objects and ElevenLabs subtitle timing.

Rules:
- Do not emit one cue per subtitle. Keep the output compact.
- Target only object ids that exist in the provided scenes.
- Prefer meaningful motion: reveal, source-card zoom, underline, connector draw, comparison slide, metric count-up, camera push.
- Return JSON only:
{
  "motionStyle": "short style label",
  "sceneDirectives": [
    {
      "sceneId": "scene-1",
      "targetIds": ["section-1-headline"],
      "cueTypes": ["reveal", "underline", "camera-push"],
      "pacing": "fast|steady|dramatic",
      "description": "..."
    }
  ],
  "compositionNotes": ["..."]
}`;

export const longformSourceBlock: BlockExecutor = {
    blockType: 'longform-source',
    async execute(input: unknown, config?: RecordValue): Promise<BlockExecutorResult> {
        const start = Date.now();
        const inputRecord = toRecord(input);
        const requestText =
            firstString(
                config?.userRequest,
                config?.query,
                inputRecord.userRequest,
                inputRecord.query,
                inputRecord.topic,
                input
            ) ?? '롱폼 만들어줘';
        const collectedInput = await collectLongformSourceInput(input, config);
        const articles = extractArticles(collectedInput);
        assertRequestedPrimaryUrlsCollected(requestText, articles);
        const primarySources = articles.filter(article => article.primarySource || article.sourcePriority === 1);
        const effectivePrimarySources = primarySources.length > 0 ? primarySources : articles.slice(0, 1);
        const supportingSources = articles.filter(article => !effectivePrimarySources.includes(article));
        const sourceDigest = effectivePrimarySources.length
            ? effectivePrimarySources.map(article => digestArticle(article))
            : [
                  cleanText(
                      firstString(config?.userRequest, config?.query, input) ??
                          '사용자 요청을 바탕으로 롱폼 자료를 정리한다.'
                  ),
              ];
        const aiResearch = await generateAiSourceResearch(requestText, effectivePrimarySources, supportingSources);

        return {
            output: {
                gate: 'A',
                mode: 'longform-gate-a',
                primarySources: effectivePrimarySources,
                supportingSources,
                sourceDigest: requireStringArray(aiResearch.output.sourceDigest, 'sourceDigest'),
                factualSpine: {
                    what:
                        firstString(toRecord(aiResearch.output.factualSpine).what) ??
                        sourceDigest[0] ??
                        '롱폼 주제의 핵심 사실을 정리한다.',
                    whyItMatters:
                        firstString(toRecord(aiResearch.output.factualSpine).whyItMatters) ??
                        '시청자가 이 이슈의 배경과 의미를 이해할 수 있게 만든다.',
                    caveats: stringArray(toRecord(aiResearch.output.factualSpine).caveats),
                },
                aiResearch: {
                    provider: 'openai',
                    model: aiResearch.model,
                    latencyMs: aiResearch.latencyMs,
                    confidence: positiveNumber(aiResearch.output.confidence),
                },
                requestText: firstString(config?.userRequest, config?.query, collectedInput, input) ?? requestText,
            },
            durationMs: Date.now() - start,
        };
    },
};

export const longformBriefBlock: BlockExecutor = {
    blockType: 'longform-brief',
    async execute(input: unknown, config?: RecordValue): Promise<BlockExecutorResult> {
        const start = Date.now();
        const source = toRecord(input);
        const primarySources = arrayOfRecords(source.primarySources);
        const firstSource = primarySources[0];
        const sourceDigest = Array.isArray(source.sourceDigest) ? source.sourceDigest : [];
        const title = firstString(firstSource?.title, source.requestText, sourceDigest[0]) ?? '롱폼 해설';
        const estimatedDurationSec =
            positiveNumber(config?.targetDurationSec, source.estimatedDurationSec) ?? DEFAULT_DURATION_SEC;
        const aiBrief = await generateAiBrief(source, estimatedDurationSec);
        const evidencePlan = arrayOfRecords(aiBrief.output.evidencePlan);

        return {
            output: {
                ...source,
                titleCandidates: stringArray(aiBrief.output.titleCandidates).length
                    ? stringArray(aiBrief.output.titleCandidates)
                    : [title, `${title} 핵심 정리`, `${title} 제대로 이해하기`],
                viewerPromise:
                    firstString(aiBrief.output.viewerPromise) ??
                    '핵심 근거와 흐름을 따라가면 이 이슈의 본질을 이해할 수 있다.',
                targetViewer: firstString(aiBrief.output.targetViewer) ?? '이슈를 깊게 이해하고 싶은 일반 시청자',
                angle:
                    firstString(
                        aiBrief.output.angle,
                        source.factualSpine && toRecord(source.factualSpine).what,
                        title
                    ) ?? title,
                structure: firstString(aiBrief.output.structure) ?? 'explainer',
                estimatedDurationSec,
                evidencePlan: primarySources.slice(0, 3).map((sourceRef, index) => ({
                    sourceId: firstString(sourceRef.id) ?? `source-${index + 1}`,
                    useAt: index === 0 ? 'context' : 'proof',
                    visualUse: index === 0 ? 'source-proof' : 'quote-card',
                })),
                ...(evidencePlan.length > 0 ? { evidencePlan } : {}),
                aiBrief: {
                    provider: 'openai',
                    model: aiBrief.model,
                    latencyMs: aiBrief.latencyMs,
                },
            },
            durationMs: Date.now() - start,
        };
    },
};

export const longformScriptBlock: BlockExecutor = {
    blockType: 'longform-script',
    async execute(input: unknown, config?: RecordValue): Promise<BlockExecutorResult> {
        const start = Date.now();
        const brief = toRecord(input);
        const writerInput = withWriterArticles(brief);
        const result = await contentBlock.execute(writerInput, {
            ...config,
            mode: 'longform-gate-a',
            gate: 'A',
            contentProfileId: firstString(config?.contentProfileId, brief.contentProfileId) ?? 'longform.explainer.v1',
            rendererRoute: firstString(config?.rendererRoute, brief.rendererRoute) ?? 'hyperframes',
            targetDurationSec:
                positiveNumber(config?.targetDurationSec, brief.estimatedDurationSec) ?? DEFAULT_DURATION_SEC,
            maxDurationSec: positiveNumber(config?.maxDurationSec, brief.maxDurationSec),
        });
        const generated = toRecord(result.output);
        const sourceIds = extractSourceIds(generated, writerInput, brief);
        const sections = buildSectionsFromGenerated(generated, writerInput);
        const scriptOutput = {
            ...brief,
            ...generated,
            fullScriptDraft:
                firstString(generated.fullScriptDraft) ??
                sections
                    .map(section => firstString(section.narration, section.summary, section.title) ?? '')
                    .join('\n\n'),
            sections,
            sourceMap: sections.map(section => ({
                sectionId: firstString(section.sectionId) ?? `section-${sections.indexOf(section) + 1}`,
                sourceIds: sourceIds.length > 0 ? sourceIds : ['source-1'],
            })),
        };
        const approvedGateAArtifact = hasExplicitLongformApproval(config)
            ? buildApprovedGateAArtifact(scriptOutput, config)
            : undefined;

        return {
            output: {
                ...scriptOutput,
                ...(approvedGateAArtifact
                    ? {
                          reviewStatus: 'approved',
                          mediaExecutionAllowed: true,
                          gateBApproved: true,
                          approvedArtifactId:
                              firstString(config?.approvedArtifactId) ?? 'longform-review-approved-artifact',
                          approvedGateAArtifact,
                      }
                    : {}),
            },
            durationMs: Date.now() - start,
        };
    },
};

export const longformStoryboardBlock: BlockExecutor = {
    blockType: 'longform-storyboard',
    async execute(input: unknown): Promise<BlockExecutorResult> {
        const start = Date.now();
        const script = toRecord(input);
        const sections = arrayOfRecords(script.sections);
        const aiStoryboard = await generateAiStoryboard(script);
        const visualChapters = normalizeVisualChapters(aiStoryboard.output.visualChapters, sections, script);

        return {
            output: {
                ...script,
                visualChapters,
                aiStoryboard: {
                    provider: 'openai',
                    model: aiStoryboard.model,
                    latencyMs: aiStoryboard.latencyMs,
                },
            },
            durationMs: Date.now() - start,
        };
    },
};

export const longformSceneJsonBlock: BlockExecutor = {
    blockType: 'longform-scene-json',
    async execute(input: unknown): Promise<BlockExecutorResult> {
        const start = Date.now();
        const storyboard = toRecord(input);
        const visualChapters = arrayOfRecords(storyboard.visualChapters);
        const scenes = visualChapters.map((chapter, index) => {
            const chapterId = firstString(chapter.chapterId) ?? `chapter-${index + 1}`;
            const objects = arrayOfRecords(chapter.objects);
            const headline = firstString(chapter.headline) ?? `Scene ${index + 1}`;
            const visualType = normalizeVisualType(firstString(chapter.visualType, chapter.visualArchetype), index);
            return {
                sceneId: `scene-${index + 1}`,
                chapterId,
                layout: visualType,
                visualType,
                headline,
                objects,
                visualData: buildVisualData(visualType, chapter, {}, headline, objects),
                subtitleDraft: buildSubtitleDraft(chapter, {}, headline, objects),
                onScreenTextPlan: buildOnScreenTextPlan(chapter, {}, headline, objects),
                perCueActivity: [
                    {
                        cueIndex: index * 3,
                        activeObjectIds: objects.map(object => firstString(object.id)).filter(Boolean),
                        emphasis: pickEmphasis(index),
                    },
                ],
            };
        });

        return {
            output: {
                ...storyboard,
                renderer: 'hyperframes',
                resolution: '2560x1440',
                fps: 30,
                scenes,
            },
            durationMs: Date.now() - start,
        };
    },
};

export const longformReviewBlock: BlockExecutor = {
    blockType: 'longform-review',
    async execute(input: unknown, config?: RecordValue): Promise<BlockExecutorResult> {
        const start = Date.now();
        const base = toRecord(input);
        const reviewed = parseRecord(config?.reviewedOutput);
        const existingApprovedArtifact = isApprovedGateAArtifact(base.approvedGateAArtifact)
            ? toRecord(base.approvedGateAArtifact)
            : undefined;
        const approvedByConfig = hasExplicitLongformApproval(config);
        const approved = approvedByConfig || !!existingApprovedArtifact;
        const reviewInput = reviewed ? { ...base, ...reviewed } : base;
        const approvedGateAArtifact = approvedByConfig
            ? buildApprovedGateAArtifact(reviewInput, config)
            : existingApprovedArtifact;

        return {
            output: {
                ...reviewInput,
                gate: 'A',
                mode: 'longform-gate-a',
                reviewStatus: approved ? 'approved' : 'draft',
                mediaExecutionAllowed: approved,
                gateBApproved: approved,
                ...(approvedGateAArtifact
                    ? {
                          approvedArtifactId:
                              firstString(
                                  config?.approvedArtifactId,
                                  approvedGateAArtifact.approvedArtifactId,
                                  base.approvedArtifactId
                              ) ?? 'longform-review-approved-artifact',
                          approvedGateAArtifact,
                      }
                    : {}),
            },
            durationMs: Date.now() - start,
        };
    },
};

export const longformTtsBlock: BlockExecutor = {
    blockType: 'longform-tts',
    async execute(input, config, context) {
        const adaptedInput = buildLongformTtsInput(input);
        const result = await mediaTtsBlock.execute(adaptedInput, { ...config, provider: 'elevenlabs' }, context);
        const output = toRecord(result.output);
        const audio = toRecord(output.audio);

        return {
            ...result,
            output: {
                ...adaptedInput,
                ...output,
                audio: {
                    ...audio,
                    provider: firstString(audio.provider) ?? 'elevenlabs',
                    voiceId: firstString(audio.voiceId, config?.voiceId) ?? env.elevenLabsTtsVoiceId,
                },
                normalizedScenes: Array.isArray(output.normalizedScenes)
                    ? output.normalizedScenes
                    : adaptedInput.normalizedScenes,
            },
        };
    },
};

export const longformSrtAlignBlock: BlockExecutor = {
    blockType: 'longform-srt-align',
    async execute(input: unknown): Promise<BlockExecutorResult> {
        const start = Date.now();
        const record = toRecord(input);
        const subtitleCues = normalizeSubtitleCues(record.subtitleCues);

        if (subtitleCues.length === 0) {
            throw new Error('longform-srt-align requires subtitle cues from ElevenLabs TTS output');
        }

        return {
            output: {
                ...record,
                subtitleCues,
                alignmentMethod: firstString(record.alignmentMethod) ?? 'elevenlabs-tts-duration-aligned',
                driftWarnings: [],
            },
            durationMs: Date.now() - start,
        };
    },
};

export const longformMotionComposeBlock: BlockExecutor = {
    blockType: 'longform-motion-compose',
    async execute(input: unknown): Promise<BlockExecutorResult> {
        const start = Date.now();
        const record = toRecord(input);
        const scenes = arrayOfRecords(record.scenes);
        const subtitleCues = arrayOfRecords(record.subtitleCues);
        const aiMotion = await generateAiMotion(record, scenes, subtitleCues);
        const motionCues = buildMotionCuesFromAiMotion(aiMotion.output, scenes, subtitleCues);
        return {
            output: {
                ...record,
                compositionProjectPath: firstString(record.compositionProjectPath),
                motionCues,
                motionStyle: firstString(aiMotion.output.motionStyle),
                compositionNotes: stringArray(aiMotion.output.compositionNotes),
                aiMotion: {
                    provider: 'openai',
                    model: aiMotion.model,
                    latencyMs: aiMotion.latencyMs,
                },
                estimatedComposeCostUsd: positiveNumber(record.estimatedComposeCostUsd) ?? 0.5,
            },
            durationMs: Date.now() - start,
        };
    },
};

export const longformRenderBlock: BlockExecutor = {
    blockType: 'longform-render',
    async execute(input, config, context) {
        return mediaVideoBlock.execute(
            input,
            { ...config, mode: 'longform-gate-b', rendererRoute: 'hyperframes' },
            context
        );
    },
};

export const longformQaBlock: BlockExecutor = {
    blockType: 'longform-qa',
    async execute(input: unknown): Promise<BlockExecutorResult> {
        const start = Date.now();
        const record = toRecord(input);
        const video = toRecord(record.video);
        const probe = toRecord(record.qa);
        const width = positiveNumber(video.width);
        const height = positiveNumber(video.height);
        const probeWidth = positiveNumber(probe.width);
        const probeHeight = positiveNumber(probe.height);
        const probeDurationSec = positiveNumber(probe.durationSec);
        const hasPreview = Boolean(firstString(video.previewUrl, video.url));
        const videoStream = probe.hasVideo === true;
        const audioStream = probe.hasAudio === true;
        const resolution2k = width === 2560 && height === 1440 && probeWidth === 2560 && probeHeight === 1440;
        const durationPresent = probeDurationSec !== undefined;
        const productionQa = toRecord(record.longformProductionQa);
        const subtitleLayer = (positiveNumber(productionQa.subtitleCueCount) ?? 0) > 0;
        const motionCues = (positiveNumber(productionQa.motionCueCount) ?? 0) > 0;
        const visualSceneCount = positiveNumber(productionQa.visualSceneCount) ?? 0;
        const visualDataSceneCount = positiveNumber(productionQa.visualDataSceneCount) ?? 0;
        const visualDensity = visualSceneCount > 0 && visualDataSceneCount >= visualSceneCount;
        const placeholderFree = productionQa.placeholderFree === true;
        const passed =
            hasPreview &&
            videoStream &&
            audioStream &&
            resolution2k &&
            durationPresent &&
            subtitleLayer &&
            motionCues &&
            visualDensity &&
            placeholderFree;
        return {
            output: {
                ...record,
                qaReport: {
                    passed,
                    checks: {
                        previewUrl: hasPreview,
                        videoStream,
                        audioStream,
                        resolution2k,
                        durationPresent,
                        subtitleLayer,
                        motionCues,
                        visualDensity,
                        placeholderFree,
                    },
                },
            },
            durationMs: Date.now() - start,
        };
    },
};

export const longformPackageBlock: BlockExecutor = {
    blockType: 'longform-package',
    async execute(input: unknown): Promise<BlockExecutorResult> {
        const start = Date.now();
        const record = toRecord(input);
        const video = toRecord(record.video);
        const downloadUrl = firstString(video.downloadUrl, video.previewUrl, video.url);
        return {
            output: {
                ...record,
                mp4Url: firstString(video.url),
                downloadUrl,
                qaReport: record.qaReport,
            },
            durationMs: Date.now() - start,
        };
    },
};

async function generateAiSourceResearch(
    requestText: string,
    primarySources: RecordValue[],
    supportingSources: RecordValue[]
): Promise<{ output: RecordValue; model: string; latencyMs: number }> {
    const response = await openaiAdapter.chatJson({
        model: env.openaiModel,
        systemPrompt: LONGFORM_SOURCE_RESEARCH_SYSTEM_PROMPT,
        userMessage: JSON.stringify(
            {
                requestText,
                primarySources: primarySources.map(compactSourceForAi),
                supportingSources: supportingSources.slice(0, 3).map(compactSourceForAi),
            },
            null,
            2
        ),
        maxTokens: 1800,
        timeoutMs: env.openaiTextTimeoutMs,
    });
    return {
        output: parseAiJsonObject(response.content, 'longform source researcher'),
        model: response.model,
        latencyMs: response.latencyMs,
    };
}

async function generateAiBrief(
    source: RecordValue,
    estimatedDurationSec: number
): Promise<{ output: RecordValue; model: string; latencyMs: number }> {
    const response = await openaiAdapter.chatJson({
        model: env.openaiModel,
        systemPrompt: LONGFORM_BRIEF_SYSTEM_PROMPT,
        userMessage: JSON.stringify(
            {
                estimatedDurationSec,
                requestText: source.requestText,
                sourceDigest: source.sourceDigest,
                factualSpine: source.factualSpine,
                primarySources: arrayOfRecords(source.primarySources).map(compactSourceForAi),
                supportingSources: arrayOfRecords(source.supportingSources).slice(0, 3).map(compactSourceForAi),
            },
            null,
            2
        ),
        maxTokens: 1600,
        timeoutMs: env.openaiTextTimeoutMs,
    });
    return {
        output: parseAiJsonObject(response.content, 'longform angle strategist'),
        model: response.model,
        latencyMs: response.latencyMs,
    };
}

async function generateAiStoryboard(
    script: RecordValue
): Promise<{ output: RecordValue; model: string; latencyMs: number }> {
    const response = await openaiAdapter.chatJson({
        model: env.openaiModel,
        systemPrompt: LONGFORM_STORYBOARD_SYSTEM_PROMPT,
        userMessage: JSON.stringify(
            {
                titleCandidates: script.titleCandidates,
                angle: script.angle,
                fullScriptDraft: script.fullScriptDraft,
                sections: arrayOfRecords(script.sections),
                sourceMap: script.sourceMap,
                evidencePlan: script.evidencePlan,
            },
            null,
            2
        ),
        maxTokens: 2400,
        timeoutMs: env.openaiTextTimeoutMs,
    });
    return {
        output: parseAiJsonObject(response.content, 'longform visual storyboard director'),
        model: response.model,
        latencyMs: response.latencyMs,
    };
}

async function generateAiMotion(
    record: RecordValue,
    scenes: RecordValue[],
    subtitleCues: RecordValue[]
): Promise<{ output: RecordValue; model: string; latencyMs: number }> {
    const response = await openaiAdapter.chatJson({
        model: env.openaiModel,
        systemPrompt: LONGFORM_MOTION_SYSTEM_PROMPT,
        userMessage: JSON.stringify(
            {
                renderer: firstString(record.renderer) ?? 'hyperframes',
                resolution: firstString(record.resolution) ?? '2560x1440',
                scenes: scenes.map(scene => ({
                    sceneId: firstString(scene.sceneId),
                    headline: firstString(scene.headline),
                    layout: firstString(scene.layout),
                    visualType: firstString(scene.visualType),
                    visualData: scene.visualData,
                    subtitleDraft: firstString(scene.subtitleDraft),
                    objects: arrayOfRecords(scene.objects).map(object => ({
                        id: firstString(object.id),
                        type: firstString(object.type),
                        text: trimText(firstString(object.text) ?? '', 160),
                    })),
                })),
                subtitleTiming: summarizeSubtitleTimingForAi(subtitleCues),
            },
            null,
            2
        ),
        maxTokens: 1400,
        timeoutMs: env.openaiTextTimeoutMs,
    });
    return {
        output: parseAiJsonObject(response.content, 'longform motion graphics director'),
        model: response.model,
        latencyMs: response.latencyMs,
    };
}

function parseAiJsonObject(content: string, label: string): RecordValue {
    const trimmed = content.trim();
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    const json = start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
    const parsed = JSON.parse(json) as unknown;
    if (!isRecordValue(parsed)) throw new Error(`${label} returned non-object JSON`);
    return parsed;
}

function compactSourceForAi(source: RecordValue): RecordValue {
    return {
        id: firstString(source.id),
        title: firstString(source.title),
        url: firstString(source.url),
        source: firstString(source.source),
        publishedAt: firstString(source.publishedAt),
        sourceType: firstString(source.sourceType),
        confidence: positiveNumber(source.confidence),
        summary: trimText(firstString(source.summary) ?? '', 800),
        fullText: trimText(firstString(source.fullText, source.summary) ?? '', 3500),
        keyClaims: stringArray(source.keyClaims),
        primarySource: source.primarySource === true,
        sourcePriority: positiveNumber(source.sourcePriority),
    };
}

function requireStringArray(value: unknown, fieldName: string): string[] {
    const values = stringArray(value);
    if (values.length === 0) throw new Error(`AI longform output requires non-empty ${fieldName}`);
    return values;
}

function normalizeVisualChapters(value: unknown, sections: RecordValue[], script: RecordValue): RecordValue[] {
    const chapters = arrayOfRecords(value).map((chapter, index) =>
        normalizeVisualChapter(chapter, sections, script, index)
    );
    if (chapters.length === 0) throw new Error('AI storyboard output requires at least one visual chapter');
    return chapters;
}

function normalizeVisualChapter(
    chapter: RecordValue,
    sections: RecordValue[],
    script: RecordValue,
    index: number
): RecordValue {
    const section = sections[index] ?? {};
    const sectionId = firstString(chapter.sectionId, section.sectionId) ?? `section-${index + 1}`;
    const headline = firstString(chapter.headline, section.title) ?? `챕터 ${index + 1}`;
    const visualArchetype = normalizeVisualType(firstString(chapter.visualType, chapter.visualArchetype), index);
    const objects = arrayOfRecords(chapter.objects).map((object, objectIndex) => ({
        id: firstString(object.id) ?? `${sectionId}-object-${objectIndex + 1}`,
        type: firstString(object.type) ?? (objectIndex === 0 ? 'headline' : visualArchetype),
        text: firstString(object.text) ?? headline,
    }));
    if (!objects.some(object => firstString(object.id) === `${sectionId}-headline`)) {
        objects.unshift({ id: `${sectionId}-headline`, type: 'headline', text: headline });
    }
    return {
        chapterId: firstString(chapter.chapterId) ?? `chapter-${index + 1}`,
        sectionId,
        headline,
        visualArchetype,
        viewerPurpose: firstString(chapter.viewerPurpose) ?? '지금 듣는 내용을 화면 구조로 즉시 이해하게 만든다.',
        objects,
        subtitleDraft: buildSubtitleDraft(chapter, section, headline, objects),
        onScreenTextPlan: buildOnScreenTextPlan(chapter, section, headline, objects),
        visualData: buildVisualData(visualArchetype, chapter, section, headline, objects),
        motionPlan:
            firstString(chapter.motionPlan) ??
            'stable chapter canvas with cue-driven focus, highlight, reveal, and connector motion',
        evidenceRefs: stringArray(chapter.evidenceRefs).length
            ? stringArray(chapter.evidenceRefs)
            : sourceIdsForSection(script.sourceMap, sectionId),
    };
}

function normalizeVisualType(value: string | undefined, index: number): string {
    const normalized = value?.trim().toLowerCase();
    if (normalized === 'timeline') return 'event-timeline';
    if (normalized === 'diagram' || normalized === 'diagram-board') return 'process-flow';
    if (normalized && normalized !== 'chapter-board' && allowedVisualTypes().includes(normalized)) return normalized;
    return index === 0 ? 'fact-card' : pickArchetype(index);
}

function allowedVisualTypes(): string[] {
    return ['source-proof', 'event-timeline', 'comparison', 'metric-reveal', 'fact-card', 'quote-card', 'process-flow'];
}

function buildSubtitleDraft(
    chapter: RecordValue,
    section: RecordValue,
    headline: string,
    objects: RecordValue[]
): string {
    return (
        firstString(chapter.subtitleDraft, chapter.onScreenSubtitle, section.subtitleDraft, section.narration) ??
        visualTexts(objects).find(text => text !== headline) ??
        headline
    );
}

function buildOnScreenTextPlan(
    chapter: RecordValue,
    section: RecordValue,
    headline: string,
    objects: RecordValue[]
): string[] {
    const explicit = [
        ...stringArray(chapter.onScreenTextPlan),
        ...arrayOfRecords(chapter.onScreenTextPlan)
            .map(item => firstString(item.text))
            .filter((text): text is string => Boolean(text)),
    ];
    const values = explicit.length
        ? explicit
        : [
              headline,
              ...visualTexts(objects).filter(text => text !== headline),
              firstString(section.summary, section.narration),
          ].filter((text): text is string => Boolean(text));
    return [...new Set(values.map(text => trimText(cleanText(text), 96)).filter(Boolean))].slice(0, 5);
}

function buildVisualData(
    visualType: string,
    chapter: RecordValue,
    section: RecordValue,
    headline: string,
    objects: RecordValue[]
): RecordValue {
    const explicit = toRecord(chapter.visualData);
    if (Object.keys(explicit).length > 0) return sanitizeVisualData(visualType, explicit, headline, objects);

    const objectTexts = visualTexts(objects).filter(text => text !== headline);
    const body =
        firstString(objectTexts.join(' '), chapter.viewerPurpose, section.summary, section.narration, headline) ??
        headline;
    const items = objectTexts.length ? objectTexts : [body];

    if (visualType === 'event-timeline') return { title: headline, items: items.slice(0, 5) };
    if (visualType === 'comparison') {
        return {
            title: headline,
            leftLabel: '겉보기',
            leftItems: items.slice(0, 2),
            rightLabel: '핵심',
            rightItems: items.slice(2, 4).length ? items.slice(2, 4) : [body],
        };
    }
    if (visualType === 'quote-card') {
        return {
            title: headline,
            quote: items[0] ?? body,
            source: firstString(arrayOfRecords(section.sourceRefs)[0]?.id) ?? '자료 기반',
        };
    }
    if (visualType === 'process-flow') return { title: headline, steps: items.slice(0, 5) };
    if (visualType === 'metric-reveal') {
        return {
            title: headline,
            metrics: items.slice(0, 3).map((text, itemIndex) => ({ label: `핵심 ${itemIndex + 1}`, value: text })),
        };
    }
    if (visualType === 'source-proof') return { title: headline, claims: items.slice(0, 4) };
    return { title: headline, body };
}

function sanitizeVisualData(
    visualType: string,
    data: RecordValue,
    headline: string,
    objects: RecordValue[]
): RecordValue {
    const title = firstString(data.title, headline) ?? headline;
    if (visualType === 'event-timeline') {
        return { ...data, title, items: ensureStringItems(data.items, objects, headline) };
    }
    if (visualType === 'comparison') {
        const items = ensureStringItems(data.items, objects, headline);
        return {
            ...data,
            title,
            leftItems: stringArray(data.leftItems).length ? stringArray(data.leftItems) : items.slice(0, 2),
            rightItems: stringArray(data.rightItems).length ? stringArray(data.rightItems) : items.slice(2, 4),
        };
    }
    if (visualType === 'quote-card') {
        return {
            ...data,
            title,
            quote: firstString(data.quote, ensureStringItems(data.items, objects, headline)[0], headline),
        };
    }
    if (visualType === 'process-flow') {
        return { ...data, title, steps: ensureStringItems(data.steps, objects, headline) };
    }
    if (visualType === 'metric-reveal') {
        const metrics = arrayOfRecords(data.metrics).length
            ? arrayOfRecords(data.metrics)
            : ensureStringItems(data.items, objects, headline).map((text, itemIndex) => ({
                  label: `핵심 ${itemIndex + 1}`,
                  value: text,
              }));
        return { ...data, title, metrics };
    }
    if (visualType === 'source-proof') {
        return { ...data, title, claims: ensureStringItems(data.claims, objects, headline) };
    }
    return {
        ...data,
        title,
        body: firstString(data.body, ensureStringItems(data.items, objects, headline).join(' '), headline),
    };
}

function ensureStringItems(value: unknown, objects: RecordValue[], headline: string): string[] {
    const items = stringArray(value);
    if (items.length > 0) return items.slice(0, 6);
    const objectTexts = visualTexts(objects).filter(text => text !== headline);
    return (objectTexts.length ? objectTexts : [headline]).slice(0, 6);
}

function visualTexts(objects: RecordValue[]): string[] {
    return objects.map(object => firstString(object.text)).filter((text): text is string => Boolean(text));
}

function normalizeMotionCues(value: unknown, scenes: RecordValue[], subtitleCues: RecordValue[]): RecordValue[] {
    const aiCues = arrayOfRecords(value);
    if (aiCues.length === 0) throw new Error('AI motion output requires at least one motion cue');
    return aiCues.map((cue, index) => normalizeMotionCue(cue, scenes, subtitleCues, index));
}

function buildMotionCuesFromAiMotion(
    aiMotion: RecordValue,
    scenes: RecordValue[],
    subtitleCues: RecordValue[]
): RecordValue[] {
    const directCues = arrayOfRecords(aiMotion.motionCues);
    if (directCues.length > 0) return normalizeMotionCues(directCues, scenes, subtitleCues);

    const directives = arrayOfRecords(aiMotion.sceneDirectives);
    if (directives.length === 0) throw new Error('AI motion output requires sceneDirectives or motionCues');

    return subtitleCues.map((cue, index) => {
        const sceneId = resolveSceneIdForCue(cue, scenes, index);
        const directive =
            directives.find(item => firstString(item.sceneId) === sceneId) ??
            directives[Math.min(index, Math.max(0, directives.length - 1))] ??
            {};
        const cueTypes = stringArray(directive.cueTypes);
        const targetIds = resolveDirectiveTargetIds(directive, scenes, sceneId, index);

        return {
            sceneId,
            cueIndex: nonNegativeNumber(cue.cueIndex) ?? index,
            type: cueTypes[index % Math.max(1, cueTypes.length)] ?? pickEmphasis(index),
            targetIds,
            startSec: nonNegativeNumber(cue.startSec) ?? index * 4,
            endSec: nonNegativeNumber(cue.endSec) ?? index * 4 + 4,
            easing: pickDirectiveEasing(directive, index),
            description: firstString(directive.description),
        };
    });
}

function normalizeMotionCue(
    cue: RecordValue,
    scenes: RecordValue[],
    subtitleCues: RecordValue[],
    index: number
): RecordValue {
    const subtitleCue = subtitleCues[index] ?? {};
    const sceneId =
        firstString(cue.sceneId) ??
        firstString(scenes[Math.min(index, Math.max(0, scenes.length - 1))]?.sceneId) ??
        'scene-1';
    const validTargetIds = new Set(
        scenes
            .flatMap(scene => arrayOfRecords(scene.objects))
            .map(object => firstString(object.id))
            .filter((id): id is string => Boolean(id))
    );
    const requestedTargetIds = stringArray(cue.targetIds).filter(id => validTargetIds.has(id));
    const targetIds = requestedTargetIds.length ? requestedTargetIds : resolveMotionTargetIds(scenes, sceneId, index);
    return {
        sceneId,
        cueIndex: nonNegativeNumber(cue.cueIndex, subtitleCue.cueIndex) ?? index,
        type: firstString(cue.type) ?? pickEmphasis(index),
        targetIds,
        startSec: nonNegativeNumber(cue.startSec, subtitleCue.startSec) ?? index * 4,
        endSec: nonNegativeNumber(cue.endSec, subtitleCue.endSec) ?? index * 4 + 4,
        easing: firstString(cue.easing) ?? 'power2.out',
        description: firstString(cue.description),
    };
}

function summarizeSubtitleTimingForAi(subtitleCues: RecordValue[]): RecordValue[] {
    const groups = new Map<string, RecordValue[]>();
    subtitleCues.forEach((cue, index) => {
        const sceneNumber = positiveNumber(cue.sceneNumber);
        const key = sceneNumber !== undefined ? `scene-${sceneNumber}` : `scene-${Math.floor(index / 4) + 1}`;
        groups.set(key, [...(groups.get(key) ?? []), cue]);
    });

    return Array.from(groups.entries()).map(([sceneId, cues]) => ({
        sceneId,
        cueCount: cues.length,
        startSec: nonNegativeNumber(cues[0]?.startSec) ?? 0,
        endSec: nonNegativeNumber(cues[cues.length - 1]?.endSec) ?? 0,
        sampleTexts: cues.slice(0, 2).map(cue => trimText(firstString(cue.text) ?? '', 120)),
    }));
}

function resolveSceneIdForCue(cue: RecordValue, scenes: RecordValue[], index: number): string {
    const sceneNumber = positiveNumber(cue.sceneNumber);
    const bySceneNumber = sceneNumber !== undefined ? `scene-${sceneNumber}` : undefined;
    const requested = firstString(cue.sceneId, bySceneNumber);
    if (requested && scenes.some(scene => firstString(scene.sceneId) === requested)) return requested;
    return firstString(scenes[Math.min(index, Math.max(0, scenes.length - 1))]?.sceneId) ?? 'scene-1';
}

function resolveDirectiveTargetIds(
    directive: RecordValue,
    scenes: RecordValue[],
    sceneId: string,
    index: number
): string[] {
    const validTargetIds = new Set(
        scenes
            .flatMap(scene => arrayOfRecords(scene.objects))
            .map(object => firstString(object.id))
            .filter((id): id is string => Boolean(id))
    );
    const requestedTargetIds = stringArray(directive.targetIds).filter(id => validTargetIds.has(id));
    return requestedTargetIds.length ? requestedTargetIds : resolveMotionTargetIds(scenes, sceneId, index);
}

function pickDirectiveEasing(directive: RecordValue, index: number): string {
    const explicit = firstString(directive.easing);
    if (explicit) return explicit;
    const pacing = firstString(directive.pacing);
    if (pacing === 'fast') return 'power3.out';
    if (pacing === 'dramatic') return 'expo.out';
    return index % 2 === 0 ? 'power2.out' : 'sine.inOut';
}

function extractArticles(input: unknown): RecordValue[] {
    const record = toRecord(input);
    return arrayOfRecords(record.articles).map((article, index) => ({
        id: firstString(article.id) ?? `source-${index + 1}`,
        title: firstString(article.title) ?? `Source ${index + 1}`,
        url: firstString(article.url) ?? '',
        source: firstString(article.source) ?? 'unknown',
        publishedAt: firstString(article.publishedAt) ?? null,
        sourceType: firstString(article.sourceType) ?? 'other',
        confidence: positiveNumber(article.confidence) ?? 0.5,
        summary: cleanText(firstString(article.summary, article.fullText) ?? ''),
        fullText: cleanText(firstString(article.fullText, article.summary) ?? ''),
        keyClaims: Array.isArray(article.keyClaims) ? article.keyClaims.map(String).map(cleanText) : [],
        primarySource: article.primarySource === true,
        sourcePriority: positiveNumber(article.sourcePriority),
    }));
}

function assertRequestedPrimaryUrlsCollected(requestText: string, articles: RecordValue[]): void {
    const requestedUrls = extractUrls(requestText);
    if (requestedUrls.length === 0) return;
    const collectedUrls = new Set(
        articles
            .filter(article => article.primarySource || article.sourcePriority === 1)
            .map(article => firstString(article.url))
            .filter((url): url is string => Boolean(url))
    );
    const missingUrls = requestedUrls.filter(url => !collectedUrls.has(url));
    if (missingUrls.length === 0) return;

    throw new Error(
        `longform-source requires readable primary URL text before script generation: ${missingUrls.join(', ')}`
    );
}

function extractUrls(text: string): string[] {
    return Array.from(text.matchAll(/https?:\/\/[^\s"'<>]+/gi), match => match[0].replace(/[),.;!?]+$/g, ''));
}

async function collectLongformSourceInput(input: unknown, config?: RecordValue): Promise<unknown> {
    if (extractArticles(input).length > 0) return input;

    const record = toRecord(input);
    const query = firstString(
        config?.userRequest,
        config?.query,
        record.userRequest,
        record.query,
        record.topic,
        input
    );
    if (!query) return input;

    const result = await searchBlock.execute(query, config);
    return {
        ...toRecord(result.output),
        requestText: query,
    };
}

function extractSourceIds(...records: RecordValue[]): string[] {
    const sources = records.flatMap(record => [
        ...arrayOfRecords(record.primarySources),
        ...arrayOfRecords(record.sources),
        ...arrayOfRecords(record.articles),
    ]);
    return [
        ...new Set(
            sources
                .map((source, index) => firstString(source.id) ?? `source-${index + 1}`)
                .filter((id): id is string => Boolean(id))
        ),
    ];
}

function withWriterArticles(brief: RecordValue): RecordValue {
    if (arrayOfRecords(brief.articles).length > 0) return brief;
    const sources = [...arrayOfRecords(brief.primarySources), ...arrayOfRecords(brief.supportingSources)];
    return sources.length > 0
        ? {
              ...brief,
              articles: sources,
          }
        : brief;
}

function buildSectionsFromGenerated(generated: RecordValue, brief: RecordValue): RecordValue[] {
    const existingSections = arrayOfRecords(generated.sections);
    if (existingSections.length > 0) return existingSections;

    const paragraphs = splitDraftParagraphs(firstString(generated.fullScriptDraft, brief.fullScriptDraft));
    const outline = arrayOfRecords(generated.outline);
    if (outline.length > 0) {
        return outline.map((item, index) => ({
            sectionId: firstString(item.sectionId, item.id) ?? `section-${index + 1}`,
            title: firstString(item.title) ?? `섹션 ${index + 1}`,
            purpose: firstString(item.purpose) ?? pickPurpose(index),
            summary: firstString(item.summary),
            narration: paragraphs[index] ?? firstString(item.narration, item.body, item.summary, item.title) ?? '',
        }));
    }

    const scenePlan = arrayOfRecords(generated.scenePlan);
    if (scenePlan.length > 0) {
        return scenePlan.map((scene, index) => ({
            sectionId: `section-${index + 1}`,
            title: firstString(scene.title) ?? `장면 ${index + 1}`,
            purpose: pickPurpose(index),
            summary: firstString(scene.visualPlan),
            narration:
                paragraphs[index] ?? firstString(scene.narration, scene.summary, scene.visualPlan, scene.title) ?? '',
            durationSec: positiveNumber(scene.durationSec),
        }));
    }

    const sourceDigest = stringArray(generated.sourceDigest).length
        ? stringArray(generated.sourceDigest)
        : stringArray(brief.sourceDigest);
    if (sourceDigest.length > 0) {
        return sourceDigest.slice(0, DEFAULT_SECTION_COUNT).map((digest, index) => ({
            sectionId: `section-${index + 1}`,
            title: index === 0 ? '핵심 요약' : `근거 ${index}`,
            purpose: pickPurpose(index),
            narration: digest,
        }));
    }

    return [
        {
            sectionId: 'section-1',
            title: firstString(generated.title, brief.angle, brief.requestText) ?? '롱폼 해설',
            purpose: 'explain',
            narration:
                firstString(generated.fullScriptDraft, brief.requestText) ??
                '수집된 자료를 바탕으로 롱폼 대본을 다시 생성해야 합니다.',
        },
    ];
}

function splitDraftParagraphs(value: string | undefined): string[] {
    if (!value) return [];
    return value
        .split(/\n{2,}/)
        .map(line => cleanText(line))
        .filter(Boolean);
}

function stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.map(String).map(cleanText).filter(Boolean) : [];
}

function parseRecord(value: unknown): RecordValue | undefined {
    if (isRecordValue(value)) return value;
    if (typeof value !== 'string' || !value.trim()) return undefined;
    try {
        const parsed = JSON.parse(value);
        return isRecordValue(parsed) ? parsed : undefined;
    } catch {
        return undefined;
    }
}

function hasExplicitLongformApproval(config: RecordValue | undefined): boolean {
    return (
        config?.reviewStatus === 'approved' ||
        config?.mediaExecutionAllowed === true ||
        config?.gateBApproved === true ||
        config?.reviewDecision === 'approved'
    );
}

function isApprovedGateAArtifact(value: unknown): boolean {
    if (!isRecordValue(value)) return false;
    return (
        (value.mode === 'longform-gate-a' || value.gate === 'A') &&
        (value.reviewStatus === 'approved' || value.mediaExecutionAllowed === true || value.gateBApproved === true) &&
        (typeof value.fullScriptDraft === 'string' ||
            Array.isArray(value.sections) ||
            Array.isArray(value.scenePlan) ||
            Array.isArray(value.visualChapters))
    );
}

function buildApprovedGateAArtifact(input: RecordValue, config?: RecordValue): RecordValue {
    const scenePlan = buildScenePlan(input);
    return {
        ...input,
        gate: 'A',
        mode: 'longform-gate-a',
        reviewStatus: 'approved',
        mediaExecutionAllowed: true,
        approved: true,
        approvedArtifactId: firstString(config?.approvedArtifactId) ?? 'longform-review-approved-artifact',
        scenePlan,
        rendererRoute: firstString(input.rendererRoute, input.renderer) ?? 'hyperframes',
    };
}

function buildScenePlan(input: RecordValue): RecordValue[] {
    const existingScenePlan = arrayOfRecords(input.scenePlan);
    if (existingScenePlan.length > 0) return existingScenePlan;

    const chapters = arrayOfRecords(input.visualChapters);
    if (chapters.length > 0) {
        return chapters.map((chapter, index) => ({
            sceneNumber: index + 1,
            title: firstString(chapter.headline, chapter.title) ?? `롱폼 장면 ${index + 1}`,
            visualPlan: firstString(chapter.motionPlan, chapter.viewerPurpose),
            durationSec: positiveNumber(chapter.durationSec) ?? 20,
        }));
    }

    const scenes = arrayOfRecords(input.scenes);
    if (scenes.length > 0) {
        return scenes.map((scene, index) => ({
            sceneNumber: index + 1,
            title: firstString(scene.headline, scene.title, scene.sceneId) ?? `롱폼 장면 ${index + 1}`,
            visualPlan: firstString(scene.layout, scene.description),
            durationSec: positiveNumber(scene.durationSec) ?? 20,
        }));
    }

    return [{ sceneNumber: 1, title: '롱폼 장면 1', durationSec: 20 }];
}

function buildLongformTtsInput(input: unknown): RecordValue & {
    normalizedScenes: Array<{ sceneNumber: number; narration: string; durationSec: number }>;
} {
    const record = toRecord(input);
    const approvedArtifact = toRecord(record.approvedGateAArtifact);
    const approvedSectionScenes = arrayOfRecords(approvedArtifact.sections)
        .map((section, index) => ({
            sceneNumber: positiveNumber(section.sceneNumber) ?? index + 1,
            narration: firstString(section.narration, section.body, section.summary, section.title) ?? '',
            durationSec: positiveNumber(section.durationSec) ?? 24,
        }))
        .filter(scene => scene.narration.trim().length > 0);
    const approvedDraftScenes = firstString(approvedArtifact.fullScriptDraft)
        ?.split(/\n{2,}/)
        .map(line => line.trim())
        .filter(Boolean)
        .map((line, index) => ({
            sceneNumber: index + 1,
            narration: line,
            durationSec: 24,
        }));
    const approvedScenes = approvedSectionScenes.length ? approvedSectionScenes : (approvedDraftScenes ?? []);

    const existingScenes = arrayOfRecords(record.normalizedScenes);
    const normalizedInputScenes = existingScenes
        .map((scene, index) => ({
            sceneNumber: positiveNumber(scene.sceneNumber) ?? index + 1,
            narration: firstString(scene.narration, scene.caption) ?? '',
            durationSec: positiveNumber(scene.durationSec) ?? 12,
        }))
        .filter(scene => scene.narration.trim().length > 0);

    const sectionScenes = arrayOfRecords(record.sections)
        .map((section, index) => ({
            sceneNumber: index + 1,
            narration: firstString(section.narration, section.body, section.summary, section.title) ?? '',
            durationSec: positiveNumber(section.durationSec) ?? 24,
        }))
        .filter(scene => scene.narration.trim().length > 0);

    const draftScenes = firstString(record.fullScriptDraft)
        ?.split(/\n{2,}/)
        .map(line => line.trim())
        .filter(Boolean)
        .map((line, index) => ({
            sceneNumber: index + 1,
            narration: line,
            durationSec: 24,
        }));

    const normalizedScenes = approvedScenes.length
        ? approvedScenes
        : normalizedInputScenes.length
          ? normalizedInputScenes
          : sectionScenes.length
            ? sectionScenes
            : (draftScenes ?? []);

    return {
        ...record,
        normalizedScenes,
    };
}

function normalizeSubtitleCues(value: unknown): Array<{
    cueIndex: number;
    sceneNumber?: number;
    sectionId: string;
    text: string;
    startSec: number;
    endSec: number;
}> {
    return arrayOfRecords(value)
        .map((cue, index) => {
            const text = firstString(cue.text);
            const startSec = nonNegativeNumber(cue.startSec);
            const endSec = nonNegativeNumber(cue.endSec);
            if (!text || startSec === undefined || endSec === undefined || endSec <= startSec) return null;

            const sceneNumber = positiveNumber(cue.sceneNumber);
            const cueIndex = nonNegativeNumber(cue.cueIndex) ?? index;
            const sectionId =
                firstString(cue.sectionId) ??
                (sceneNumber !== undefined ? `section-${sceneNumber}` : `section-${Math.floor(index / 3) + 1}`);

            return {
                cueIndex,
                ...(sceneNumber !== undefined ? { sceneNumber } : {}),
                sectionId,
                text,
                startSec,
                endSec,
            };
        })
        .filter((cue): cue is NonNullable<typeof cue> => cue !== null);
}

function digestArticle(article: RecordValue): string {
    return trimText(cleanText(firstString(article.summary, article.fullText, article.title) ?? ''), 240);
}

function sourceIdsForSection(sourceMap: unknown, sectionId: string): string[] {
    return arrayOfRecords(sourceMap)
        .filter(item => firstString(item.sectionId) === sectionId)
        .flatMap(item => (Array.isArray(item.sourceIds) ? item.sourceIds.map(String) : []));
}

function resolveMotionTargetIds(scenes: RecordValue[], sceneId: string, index: number): string[] {
    const scene =
        scenes.find(item => firstString(item.sceneId) === sceneId) ??
        scenes[Math.min(index, Math.max(0, scenes.length - 1))];
    const objects = arrayOfRecords(scene?.objects);
    const headlineObject = objects.find(object => firstString(object.type) === 'headline');
    const headlineId = firstString(headlineObject?.id);
    if (headlineId) return [headlineId];

    const firstObjectId = firstString(objects[0]?.id);
    return firstObjectId ? [firstObjectId] : ['headline'];
}

function pickArchetype(index: number): string {
    return ['source-proof', 'event-timeline', 'comparison', 'metric-reveal', 'fact-card'][
        index % DEFAULT_SECTION_COUNT
    ];
}

function pickEmphasis(index: number): string {
    return ['highlight', 'draw-line', 'count-up', 'zoom', 'reveal'][index % DEFAULT_SECTION_COUNT];
}

function pickPurpose(index: number): string {
    return ['hook', 'context', 'explain', 'evidence', 'conclusion'][index % DEFAULT_SECTION_COUNT];
}

function toRecord(value: unknown): RecordValue {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : {};
}

function isRecordValue(value: unknown): value is RecordValue {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function arrayOfRecords(value: unknown): RecordValue[] {
    return Array.isArray(value)
        ? value.filter((item): item is RecordValue => Boolean(item && typeof item === 'object'))
        : [];
}

function firstString(...values: unknown[]): string | undefined {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
}

function positiveNumber(...values: unknown[]): number | undefined {
    for (const value of values) {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return undefined;
}

function nonNegativeNumber(...values: unknown[]): number | undefined {
    for (const value of values) {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    }
    return undefined;
}

function cleanText(value: string): string {
    return value
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function trimText(value: string, limit: number): string {
    if (value.length <= limit) return value;
    return `${value.slice(0, limit - 1).trim()}…`;
}
