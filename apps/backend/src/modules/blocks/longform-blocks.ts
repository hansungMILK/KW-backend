import { mediaTtsBlock } from './media-tts-block';
import { mediaVideoBlock } from './media-video-block';
import { env } from '../../config/env';

import type { BlockExecutor, BlockExecutorResult } from './types';

type RecordValue = Record<string, unknown>;

const DEFAULT_DURATION_SEC = 300;
const DEFAULT_SECTION_COUNT = 5;

export const longformSourceBlock: BlockExecutor = {
    blockType: 'longform-source',
    async execute(input: unknown, config?: RecordValue): Promise<BlockExecutorResult> {
        const start = Date.now();
        const articles = extractArticles(input);
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
                requestText: firstString(config?.userRequest, config?.query, input) ?? '롱폼 만들어줘',
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
    async execute(input: unknown): Promise<BlockExecutorResult> {
        const start = Date.now();
        const brief = toRecord(input);
        const titleCandidates = Array.isArray(brief.titleCandidates) ? brief.titleCandidates : [];
        const topic = firstString(brief.angle, titleCandidates[0], brief.requestText) ?? '롱폼 주제';
        const sourceIds = arrayOfRecords(brief.primarySources).map(
            (source, index) => firstString(source.id) ?? `source-${index + 1}`
        );
        const sections = buildScriptSections(topic);

        return {
            output: {
                ...brief,
                fullScriptDraft: sections.map(section => section.narration).join('\n\n'),
                sections,
                sourceMap: sections.map(section => ({
                    sectionId: section.sectionId,
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
        const approved =
            reviewed !== undefined ||
            config?.reviewStatus === 'approved' ||
            config?.mediaExecutionAllowed === true ||
            config?.gateBApproved === true;
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
        const motionCues = subtitleCues.map((cue, index) => ({
            sceneId: firstString(scenes[Math.min(index, Math.max(0, scenes.length - 1))]?.sceneId) ?? 'scene-1',
            cueIndex: positiveNumber(cue.cueIndex) ?? index,
            type: pickEmphasis(index),
            targetIds: ['headline'],
            startSec: positiveNumber(cue.startSec) ?? index * 4,
            endSec: positiveNumber(cue.endSec) ?? index * 4 + 4,
        }));
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
        const width = positiveNumber(video.width);
        const height = positiveNumber(video.height);
        const hasPreview = Boolean(firstString(video.previewUrl, video.url));
        const passed = width === 2560 && height === 1440 && hasPreview;
        return {
            output: {
                ...record,
                qaReport: {
                    passed,
                    checks: {
                        previewUrl: hasPreview,
                        resolution2k: width === 2560 && height === 1440,
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
    const existingScenes = arrayOfRecords(record.normalizedScenes).length
        ? arrayOfRecords(record.normalizedScenes)
        : arrayOfRecords(record.scenes);
    const scenesWithNarration = existingScenes
        .map((scene, index) => ({
            sceneNumber: positiveNumber(scene.sceneNumber) ?? index + 1,
            narration: firstString(scene.narration, scene.caption, scene.headline, scene.title) ?? '',
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

    const normalizedScenes = scenesWithNarration.length
        ? scenesWithNarration
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

function buildScriptSections(topic: string) {
    return [
        {
            sectionId: 'section-1',
            title: '오프닝',
            purpose: 'hook',
            narration: `${topic} 이슈는 겉보기보다 구조가 중요합니다. 먼저 핵심부터 잡겠습니다.`,
        },
        {
            sectionId: 'section-2',
            title: '배경',
            purpose: 'context',
            narration: `이 사안의 출발점은 관련 자료에서 확인되는 변화와 시장의 반응입니다.`,
        },
        {
            sectionId: 'section-3',
            title: '핵심 설명',
            purpose: 'explain',
            narration: `여기서 중요한 건 단순한 소식이 아니라 왜 이 변화가 의미를 갖는지입니다.`,
        },
        {
            sectionId: 'section-4',
            title: '근거 확인',
            purpose: 'evidence',
            narration: `원문과 보조 자료를 나눠 보면 확인된 사실과 아직 조심해야 할 부분이 갈립니다.`,
        },
        {
            sectionId: 'section-5',
            title: '정리',
            purpose: 'conclusion',
            narration: `정리하면 중요한 건 화제성보다 이 흐름이 앞으로 어떤 선택을 만들지입니다.`,
        },
    ] as const;
}

function sourceIdsForSection(sourceMap: unknown, sectionId: string): string[] {
    return arrayOfRecords(sourceMap)
        .filter(item => firstString(item.sectionId) === sectionId)
        .flatMap(item => (Array.isArray(item.sourceIds) ? item.sourceIds.map(String) : []));
}

function pickArchetype(index: number): string {
    return ['source-proof', 'timeline', 'comparison', 'metric-reveal', 'chapter-board'][index % DEFAULT_SECTION_COUNT];
}

function pickEmphasis(index: number): string {
    return ['highlight', 'draw-line', 'count-up', 'zoom', 'reveal'][index % DEFAULT_SECTION_COUNT];
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
