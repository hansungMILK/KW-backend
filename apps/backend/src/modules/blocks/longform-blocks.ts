import { contentBlock } from './content-block';
import { mediaTtsBlock } from './media-tts-block';
import { mediaVideoBlock } from './media-video-block';
import { searchBlock } from './search-block';
import { env } from '../../config/env';

import type { BlockExecutor, BlockExecutorResult } from './types';

type RecordValue = Record<string, unknown>;

const DEFAULT_DURATION_SEC = 300;
const DEFAULT_SECTION_COUNT = 5;

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

        return {
            output: {
                gate: 'A',
                mode: 'longform-gate-a',
                primarySources: effectivePrimarySources,
                supportingSources,
                sourceDigest,
                factualSpine: {
                    what: sourceDigest[0] ?? '롱폼 주제의 핵심 사실을 정리한다.',
                    whyItMatters: '시청자가 이 이슈의 배경과 의미를 이해할 수 있게 만든다.',
                    caveats: supportingSources.length > 0 ? ['보조 출처는 원문을 대체하지 않는다.'] : [],
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

        return {
            output: {
                ...source,
                titleCandidates: [title, `${title} 핵심 정리`, `${title} 제대로 이해하기`],
                viewerPromise: '핵심 근거와 흐름을 따라가면 이 이슈의 본질을 이해할 수 있다.',
                targetViewer: '이슈를 깊게 이해하고 싶은 일반 시청자',
                angle: firstString(source.factualSpine && toRecord(source.factualSpine).what, title) ?? title,
                structure: 'explainer',
                estimatedDurationSec,
                evidencePlan: primarySources.slice(0, 3).map((sourceRef, index) => ({
                    sourceId: firstString(sourceRef.id) ?? `source-${index + 1}`,
                    useAt: index === 0 ? 'context' : 'proof',
                    visualUse: index === 0 ? 'source-proof' : 'quote-card',
                })),
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

        return {
            output: {
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
        const visualChapters = sections.map((section, index) => {
            const sectionId = firstString(section.sectionId) ?? `section-${index + 1}`;
            const archetype = pickArchetype(index);
            return {
                chapterId: `chapter-${index + 1}`,
                sectionId,
                headline: firstString(section.title) ?? `챕터 ${index + 1}`,
                visualArchetype: archetype,
                viewerPurpose: '지금 듣는 내용을 화면 구조로 즉시 이해하게 만든다.',
                objects: [
                    {
                        id: `${sectionId}-headline`,
                        type: 'headline',
                        text: firstString(section.title) ?? `챕터 ${index + 1}`,
                    },
                    {
                        id: `${sectionId}-proof`,
                        type: archetype,
                        text: trimText(firstString(section.narration) ?? '', 120),
                    },
                ],
                motionPlan: 'stable chapter canvas with cue-driven focus, highlight, reveal, and connector motion',
                evidenceRefs: sourceIdsForSection(script.sourceMap, sectionId),
            };
        });

        return { output: { ...script, visualChapters }, durationMs: Date.now() - start };
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
            return {
                sceneId: `scene-${index + 1}`,
                chapterId,
                layout: firstString(chapter.visualArchetype) ?? 'chapter-board',
                headline: firstString(chapter.headline) ?? `Scene ${index + 1}`,
                objects,
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
        const approved = hasExplicitLongformApproval(config);
        const reviewInput = reviewed ? { ...base, ...reviewed } : base;
        const approvedGateAArtifact = approved ? buildApprovedGateAArtifact(reviewInput, config) : undefined;

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
                              firstString(config?.approvedArtifactId) ?? 'longform-review-approved-artifact',
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
        const motionCues = subtitleCues.map((cue, index) => {
            const sceneId = firstString(scenes[Math.min(index, Math.max(0, scenes.length - 1))]?.sceneId) ?? 'scene-1';
            return {
                sceneId,
                cueIndex: positiveNumber(cue.cueIndex) ?? index,
                type: pickEmphasis(index),
                targetIds: resolveMotionTargetIds(scenes, sceneId, index),
                startSec: positiveNumber(cue.startSec) ?? index * 4,
                endSec: positiveNumber(cue.endSec) ?? index * 4 + 4,
            };
        });
        return {
            output: {
                ...record,
                compositionProjectPath: firstString(record.compositionProjectPath),
                motionCues,
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
        const passed = hasPreview && videoStream && audioStream && resolution2k && durationPresent;
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
    return ['source-proof', 'timeline', 'comparison', 'metric-reveal', 'chapter-board'][index % DEFAULT_SECTION_COUNT];
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
