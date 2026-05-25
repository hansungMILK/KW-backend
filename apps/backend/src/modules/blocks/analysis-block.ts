import { extractFocusTerms } from './request-contract';
import { AnalysisOutputSchema } from './types';
import { openaiAdapter } from '../../adapters/ai/openai-adapter';
import { env } from '../../config/env';
import { log } from '../../utils/logger';
import { selectShortsRulepack } from '../shorts/topic-router';

import type { BlockExecutor, BlockExecutorResult } from './types';

// ── Constants ─────────────────────────────────────────────────────────────────

const BANNED_KEYWORDS = ['정치', '성인', '도박', '폭력', '마약', '음란', '혐오', '사기', '불법'];

const MIN_NARRATION_CHARS = 10;
const MAX_NARRATION_CHARS = 300;
const MIN_SCENE_COUNT = 10;
const MAX_SCENE_COUNT = 15;

const SAFETY_THRESHOLD = 70;
const ADMISSION_SAFE_VIOLENCE_TERMS = ['학교폭력', '학폭', '폭력 조치사항'];
const MIN_COUNTRYBALL_DRAMATIZED_ACTION_CHARS = 8;
const MAX_COUNTRYBALL_DIALOGUE_LINES_PER_SCENE = 4;
const MAX_COUNTRYBALL_DIALOGUE_TEXT_CHARS = 28;
const MAX_COUNTRYBALL_DIALOGUE_DURATION_SEC = 2.8;

// ── Prompts ───────────────────────────────────────────────────────────────────

const ANALYSIS_SYSTEM_PROMPT = `You are a Korean YouTube Shorts content safety and quality reviewer.
Review the provided scene narrations and return a brief assessment.

Severity rules:
- critical/high: only unsafe, unsupported, source-missing, or materially false content that must stop production.
- medium: source-backed factual wording that needs softer attribution such as "공식 발표 기준으로" or "보도에 따르면".
- low: style, pacing, wording, or layout polish.
- If claimType=fact has sourceRefs, do not mark it as source-missing. Prefer medium for phrasing/date freshness cautions.

Respond with JSON only — no markdown fences, no extra text:
{
  "safetyComment": "brief safety assessment in Korean (1–2 sentences)",
  "qualityComment": "brief quality assessment in Korean (1–2 sentences)",
  "flaggedScenes": [<sceneNumber>, ...],
  "suggestedIssues": [
    { "severity": "low|medium|high|critical", "message": "...", "sceneNumber": <optional> }
  ]
}`;

// ── Types ─────────────────────────────────────────────────────────────────────

interface Issue {
    severity: 'low' | 'medium' | 'high' | 'critical';
    message: string;
    sceneNumber?: number;
}

interface AutoRemediation {
    sceneNumber: number;
    action: 'soften-factual-wording' | 'rewrite-creative-simulation-scenes';
    before: string;
    after: string;
    reason: string;
}

interface NormalizedScene {
    sceneNumber?: unknown;
    caption?: unknown;
    narration?: unknown;
    imagePrompt?: unknown;
    visualText?: unknown;
    visual?: unknown;
    topTitle?: unknown;
    claimType?: unknown;
    sourceRefs?: unknown;
    scenePurpose?: unknown;
    location?: unknown;
    visualTone?: unknown;
    screenAction?: unknown;
    characters?: unknown;
    dramatizedAction?: unknown;
    dialogueLines?: unknown;
    expressionChanges?: unknown;
    sfx?: unknown;
    editBeat?: unknown;
    narratorLine?: unknown;
    factualClaim?: unknown;
    evidenceRefs?: unknown;
    keywords?: unknown;
    durationSec?: unknown;
}

interface DialogueLine {
    country?: string;
    line?: string;
    speaker: string;
    text: string;
    tone?: string;
    emotion?: string;
    captionStyle?: string;
    durationSec?: number;
    structured: boolean;
}

// ── Dummy (mock mode) ─────────────────────────────────────────────────────────

function dummyAnalysis(): BlockExecutorResult {
    const start = Date.now();
    const output = {
        safetyScore: 95,
        qualityScore: 88,
        issues: [],
        approved: true,
    };
    return { output, durationMs: Date.now() - start };
}

// ── Rule-based checks ─────────────────────────────────────────────────────────

function runRuleChecks(
    scenes: NormalizedScene[],
    presetId: string,
    requestTopic?: string,
    outputContract?: unknown
): {
    safetyScore: number;
    qualityScore: number;
    issues: Issue[];
} {
    const issues: Issue[] = [];
    let safetyDeductions = 0;
    let qualityDeductions = 0;
    const creativeSimulationMode = isCreativeSimulationContract(outputContract);
    const countryballMode = presetId === 'countryball-shorts' || isCountryballContract(outputContract);
    let countryballDialogueSceneCount = 0;
    let countryballSpecificActionSceneCount = 0;

    // 1. Scene count check
    if (scenes.length < MIN_SCENE_COUNT || scenes.length > MAX_SCENE_COUNT) {
        const severity = scenes.length === 0 ? 'critical' : 'medium';
        issues.push({
            severity,
            message: `씬 수가 ${MIN_SCENE_COUNT}~${MAX_SCENE_COUNT}개여야 하나 ${scenes.length}개입니다.`,
        });
        qualityDeductions += scenes.length === 0 ? 40 : 10;
    }

    // 2. Per-scene checks
    const topTitles: Array<{ sceneNumber?: number; value: string }> = [];
    for (const scene of scenes) {
        const sceneNum = typeof scene.sceneNumber === 'number' ? scene.sceneNumber : undefined;
        const narration = typeof scene.narration === 'string' ? scene.narration : '';
        const visual = isRecord(scene.visual) ? scene.visual : {};
        const caption =
            typeof visual['mainCaption'] === 'string'
                ? visual['mainCaption']
                : typeof scene.caption === 'string'
                  ? scene.caption
                  : '';
        const visualText =
            typeof scene.visualText === 'string'
                ? scene.visualText
                : typeof visual['mainCaption'] === 'string'
                  ? visual['mainCaption']
                  : caption;
        const topTitle =
            typeof scene.topTitle === 'string'
                ? scene.topTitle
                : typeof visual['topTitle'] === 'string'
                  ? visual['topTitle']
                  : '';
        const sourceLabel = typeof visual['sourceLabel'] === 'string' ? visual['sourceLabel'] : '';
        const claimType = typeof scene.claimType === 'string' ? scene.claimType : undefined;
        const sourceRefs = Array.isArray(scene.sourceRefs) ? scene.sourceRefs : [];
        const evidenceRefs = Array.isArray(scene.evidenceRefs) ? scene.evidenceRefs : [];
        const dialogueLines = normalizeDialogueLines(scene.dialogueLines);
        const dialogueTexts = dialogueLines.map(line =>
            [line.speaker, line.text, line.emotion].filter(Boolean).join(' ')
        );
        const factualClaim = typeof scene.factualClaim === 'string' ? scene.factualClaim : '';
        const dramatizedAction = typeof scene.dramatizedAction === 'string' ? scene.dramatizedAction : '';
        const scenePurpose = typeof scene.scenePurpose === 'string' ? scene.scenePurpose : '';
        const screenAction = typeof scene.screenAction === 'string' ? scene.screenAction : dramatizedAction;
        const visualTone = typeof scene.visualTone === 'string' ? scene.visualTone : '';
        const expressionChanges = Array.isArray(scene.expressionChanges) ? scene.expressionChanges : [];
        const sfx = Array.isArray(scene.sfx) ? scene.sfx : [];
        const editBeat = typeof scene.editBeat === 'string' ? scene.editBeat : '';
        const narratorLineText = readNarratorLineText(scene.narratorLine);

        if (topTitle) {
            topTitles.push({ sceneNumber: sceneNum, value: topTitle });
        }

        if (!topTitle) {
            issues.push({
                severity: 'medium',
                message: '상단 고정 제목(topTitle)이 없습니다.',
                sceneNumber: sceneNum,
            });
            qualityDeductions += 4;
        } else if (topTitle.length > 18) {
            issues.push({
                severity: 'medium',
                message: `상단 제목이 너무 깁니다 (${topTitle.length}자). 18자 이하 권장.`,
                sceneNumber: sceneNum,
            });
            qualityDeductions += 4;
        }

        // Narration length
        if (narration.length < MIN_NARRATION_CHARS) {
            issues.push({
                severity: 'medium',
                message: `나레이션이 너무 짧습니다 (${narration.length}자). 최소 ${MIN_NARRATION_CHARS}자 필요.`,
                sceneNumber: sceneNum,
            });
            qualityDeductions += 5;
        } else if (narration.length > MAX_NARRATION_CHARS) {
            issues.push({
                severity: 'low',
                message: `나레이션이 너무 깁니다 (${narration.length}자). 최대 ${MAX_NARRATION_CHARS}자 권장.`,
                sceneNumber: sceneNum,
            });
            qualityDeductions += 3;
        }

        // Banned keyword check
        const combinedText = [
            narration,
            typeof scene.imagePrompt === 'string' ? scene.imagePrompt : '',
            ...dialogueTexts,
        ]
            .join(' ')
            .toLowerCase();

        for (const banned of BANNED_KEYWORDS) {
            if (hasBannedKeyword(combinedText, banned, presetId, creativeSimulationMode, claimType)) {
                if (isSourceBackedNewsContext(combinedText, banned, claimType, sourceRefs)) {
                    continue;
                }
                issues.push({
                    severity: 'high',
                    message: `금지 키워드 "${banned}" 감지됨.`,
                    sceneNumber: sceneNum,
                });
                safetyDeductions += 20;
                break; // one deduction per scene
            }
        }

        if (!countryballMode && claimType === 'fact' && sourceRefs.length === 0 && evidenceRefs.length === 0) {
            issues.push({
                severity: 'high',
                message: 'fact 장면인데 sourceRefs가 없습니다.',
                sceneNumber: sceneNum,
            });
            qualityDeductions += 8;
        }

        if (
            countryballMode &&
            hasWholeNationDemeaningClaim(
                [caption, visualText, narration, scene.imagePrompt, factualClaim, dramatizedAction, ...dialogueTexts]
                    .filter((value): value is string => typeof value === 'string')
                    .join(' ')
            )
        ) {
            issues.push({
                severity: 'high',
                message: '컨트리볼 상황극에서 국가/민족 전체를 비하하는 표현이 포함되어 있습니다.',
                sceneNumber: sceneNum,
            });
            safetyDeductions += 25;
        }

        if (countryballMode) {
            if (dialogueLines.length > 0) {
                countryballDialogueSceneCount += 1;
            }
            if (hasSpecificCountryballAction(dramatizedAction)) {
                countryballSpecificActionSceneCount += 1;
            }

            if (!scenePurpose.trim()) {
                issues.push({
                    severity: 'medium',
                    message: '컨트리볼 장면에는 scenePurpose가 필요합니다.',
                    sceneNumber: sceneNum,
                });
                qualityDeductions += 4;
            }

            if (!visualTone.trim()) {
                issues.push({
                    severity: 'medium',
                    message: '컨트리볼 장면에는 visualTone이 필요합니다.',
                    sceneNumber: sceneNum,
                });
                qualityDeductions += 4;
            }

            if (!screenAction.trim()) {
                issues.push({
                    severity: 'high',
                    message: '컨트리볼 장면에는 실제 화면 행동(screenAction)이 필요합니다.',
                    sceneNumber: sceneNum,
                });
                qualityDeductions += 10;
            }

            if (expressionChanges.length === 0 || sfx.length === 0 || !editBeat.trim()) {
                issues.push({
                    severity: 'medium',
                    message: '컨트리볼 장면에는 표정 변화, SFX, 편집 지시가 필요합니다.',
                    sceneNumber: sceneNum,
                });
                qualityDeductions += 4;
            }

            if (narratorLineText && isExplanatoryCountryballNarratorLine(narratorLineText)) {
                issues.push({
                    severity: 'high',
                    message: '컨트리볼 narratorLine은 제목/시간점프/엔딩 메타만 허용되며 설명문을 대신하면 안 됩니다.',
                    sceneNumber: sceneNum,
                });
                qualityDeductions += 10;
            }

            if (dramatizedAction.trim().length < MIN_COUNTRYBALL_DRAMATIZED_ACTION_CHARS) {
                issues.push({
                    severity: 'high',
                    message: '컨트리볼 상황극 장면에는 대사와 별개로 실제 장면 행동(dramatizedAction)이 필요합니다.',
                    sceneNumber: sceneNum,
                });
                qualityDeductions += 10;
            }

            if (dialogueLines.length > MAX_COUNTRYBALL_DIALOGUE_LINES_PER_SCENE) {
                issues.push({
                    severity: 'high',
                    message: '컨트리볼 상황극 대사는 장면당 4줄 이하로 제한해야 합니다.',
                    sceneNumber: sceneNum,
                });
                qualityDeductions += 10;
            }

            for (const line of dialogueLines) {
                if (!line.structured || !line.speaker.trim() || !line.text.trim()) {
                    issues.push({
                        severity: 'high',
                        message: '컨트리볼 대사는 dialogueLines의 country/line 및 speaker/text 구조로 작성해야 합니다.',
                        sceneNumber: sceneNum,
                    });
                    qualityDeductions += 10;
                    continue;
                }

                if (isNarratorSpeaker(line.speaker)) {
                    issues.push({
                        severity: 'high',
                        message: '컨트리볼 대사의 speaker는 narrator가 아니라 국가볼 캐릭터여야 합니다.',
                        sceneNumber: sceneNum,
                    });
                    qualityDeductions += 8;
                }

                if (line.text.length > MAX_COUNTRYBALL_DIALOGUE_TEXT_CHARS) {
                    issues.push({
                        severity: 'medium',
                        message: `컨트리볼 대사가 너무 깁니다 (${line.text.length}자). ${MAX_COUNTRYBALL_DIALOGUE_TEXT_CHARS}자 이하 권장.`,
                        sceneNumber: sceneNum,
                    });
                    qualityDeductions += 4;
                }

                if (
                    typeof line.durationSec === 'number' &&
                    Number.isFinite(line.durationSec) &&
                    line.durationSec > MAX_COUNTRYBALL_DIALOGUE_DURATION_SEC
                ) {
                    issues.push({
                        severity: 'medium',
                        message: `컨트리볼 대사 durationSec가 너무 깁니다 (${line.durationSec}초). ${MAX_COUNTRYBALL_DIALOGUE_DURATION_SEC}초 이하 권장.`,
                        sceneNumber: sceneNum,
                    });
                    qualityDeductions += 3;
                }
            }
        }

        if (presetId === 'education-admission') {
            const factualText = [caption, visualText, narration].join(' ');
            const hasExactClaim = hasAdmissionExactClaim(factualText);
            if (hasExactClaim && sourceRefs.length === 0) {
                issues.push({
                    severity: 'high',
                    message: '입시 날짜/전형/점수/마감 등 확정성 정보에 sourceRefs가 없습니다.',
                    sceneNumber: sceneNum,
                });
                qualityDeductions += 8;
            }

            if (hasAdmissionGuaranteeClaim(factualText)) {
                issues.push({
                    severity: 'high',
                    message: '입시 콘텐츠에 보장/과장 표현이 포함되어 있습니다.',
                    sceneNumber: sceneNum,
                });
                safetyDeductions += 12;
            }
        }

        if (caption.length > 18) {
            issues.push({
                severity: 'medium',
                message: `중앙 자막이 너무 깁니다 (${caption.length}자). 18자 이하 권장.`,
                sceneNumber: sceneNum,
            });
            qualityDeductions += 4;
        }

        if (visualText.length > 24) {
            issues.push({
                severity: 'medium',
                message: `이미지 안 텍스트가 너무 깁니다 (${visualText.length}자). GPT-image-2용 문구는 24자 이하 권장.`,
                sceneNumber: sceneNum,
            });
            qualityDeductions += 4;
        }

        if (/https?:\/\//i.test(sourceLabel) || sourceLabel.length > 36) {
            issues.push({
                severity: 'medium',
                message: 'sourceLabel에는 긴 URL이나 긴 출처 문구를 넣지 마세요.',
                sceneNumber: sceneNum,
            });
            qualityDeductions += 4;
        }

        if (/출처\s*확인\s*필요/.test(sourceLabel)) {
            issues.push({
                severity: 'medium',
                message: '출처 없음은 화면 문구로 대체하지 말고 sourceRefs 누락 이슈로 처리해야 합니다.',
                sceneNumber: sceneNum,
            });
            qualityDeductions += 4;
        }
    }

    if (countryballMode && scenes.length > 0) {
        const minDialogueScenes = Math.ceil(scenes.length * 0.6);
        if (countryballDialogueSceneCount < minDialogueScenes) {
            issues.push({
                severity: 'high',
                message: `컨트리볼 상황극은 국가볼 캐릭터 대사가 중심이어야 합니다. 최소 ${minDialogueScenes}개 씬에 speaker/text 대사가 필요합니다.`,
            });
            qualityDeductions += 20;
        }

        const minActionScenes = Math.ceil(scenes.length * 0.7);
        if (countryballSpecificActionSceneCount < minActionScenes) {
            issues.push({
                severity: 'high',
                message: `컨트리볼 상황극은 설명이 아니라 상황을 행동으로 보여주는 장면이어야 합니다. 최소 ${minActionScenes}개 씬에 구체적인 dramatizedAction이 필요합니다.`,
            });
            qualityDeductions += 20;
        }
    }

    const firstTopTitle = topTitles[0]?.value;
    if (firstTopTitle) {
        const changed = topTitles.filter(item => item.value !== firstTopTitle);
        if (changed.length > 0) {
            issues.push({
                severity: 'high',
                message: `모든 씬의 topTitle이 같아야 합니다. ${changed.length}개 씬에서 제목이 바뀌었습니다.`,
            });
            qualityDeductions += 12;
        }
    }

    // 3. Empty scenes check
    const emptyNarrations = scenes.filter(
        s => typeof s.narration !== 'string' || (s.narration as string).trim().length === 0
    ).length;
    if (emptyNarrations > 0) {
        issues.push({
            severity: 'high',
            message: `${emptyNarrations}개 씬의 나레이션이 비어있습니다.`,
        });
        qualityDeductions += emptyNarrations * 8;
    }

    const missingTopicTerms = getMissingRequestedTopicTerms(requestTopic, scenes, outputContract);
    if (missingTopicTerms.length > 0) {
        issues.push({
            severity: 'high',
            message: `요청한 핵심 주제(${missingTopicTerms.join(', ')})가 대본 본문/자막에 충분히 반영되지 않았습니다.`,
        });
        qualityDeductions += 20;
    }

    const safetyScore = Math.max(0, Math.min(100, 100 - safetyDeductions));
    const qualityScore = Math.max(0, Math.min(100, 100 - qualityDeductions));

    return { safetyScore, qualityScore, issues };
}

function getMissingRequestedTopicTerms(
    requestTopic: unknown,
    scenes: NormalizedScene[],
    outputContract?: unknown
): string[] {
    const contract = isRecord(outputContract) ? outputContract : {};
    if (contract['exactSubjectRequired'] === false) return [];
    const contractTerms = Array.isArray(contract['requiredCoverageTerms'])
        ? contract['requiredCoverageTerms'].map(String).filter(Boolean)
        : [];
    if (typeof requestTopic !== 'string' && contractTerms.length === 0) return [];
    const focusTerms = contractTerms.length > 0 ? contractTerms : extractRequestedFocusTerms(String(requestTopic));
    if (focusTerms.length < 2) return [];

    const bodyText = normalizeTopicText(
        scenes
            .flatMap(scene => {
                const visual = isRecord(scene.visual) ? scene.visual : {};
                return [
                    scene.caption,
                    scene.narration,
                    scene.visualText,
                    visual['mainCaption'],
                    ...normalizeDialogueLines(scene.dialogueLines).map(line => line.text),
                ];
            })
            .filter((value): value is string => typeof value === 'string')
            .join(' ')
    );
    const compactBodyText = compactTopicText(bodyText);

    return focusTerms.filter(term => {
        const normalizedTerm = normalizeTopicText(term);
        return !bodyText.includes(normalizedTerm) && !compactBodyText.includes(compactTopicText(normalizedTerm));
    });
}

function extractRequestedFocusTerms(requestTopic: string): string[] {
    return extractFocusTerms(requestTopic).slice(0, 8);
}

function normalizeTopicText(input: string): string {
    return input
        .toLowerCase()
        .replace(/(^|\s)예스(?=\s|$)/g, '$1yes')
        .replace(/(^|\s)오어(?=\s|$)/g, '$1or')
        .replace(/(^|\s)노(?=\s|$)/g, '$1no')
        .replace(/\s+/g, ' ')
        .trim();
}

function compactTopicText(input: string): string {
    return normalizeTopicText(input).replace(/\s+/g, '');
}

function hasBannedKeyword(
    text: string,
    banned: string,
    presetId: string,
    creativeSimulationMode: boolean,
    claimType: string | undefined
): boolean {
    if (
        creativeSimulationMode &&
        banned === '폭력' &&
        (claimType === 'hypothetical' || claimType === 'opinion' || claimType === 'joke')
    ) {
        return false;
    }
    if (banned === '폭력' && presetId === 'education-admission') {
        const normalized = ADMISSION_SAFE_VIOLENCE_TERMS.reduce(
            (current, safeTerm) => current.replaceAll(safeTerm, ''),
            text
        );
        return normalized.includes(banned);
    }
    return text.includes(banned);
}

function isCreativeSimulationContract(input: unknown): boolean {
    if (!isRecord(input)) return false;
    if (input['contentMode'] === 'creative-simulation') return true;
    const requestSpec = input['requestSpec'];
    return isRecord(requestSpec) && requestSpec['contentMode'] === 'creative-simulation';
}

function isCountryballContract(input: unknown): boolean {
    if (!isRecord(input)) return false;
    return (
        input['contentProfileId'] === 'shorts.countryball.v1' ||
        input['imageStyleId'] === 'countryball-comic' ||
        input['visualStyle'] === 'countryball-comic' ||
        input['narrativeMode'] === 'countryball-situation-reenactment'
    );
}

function hasWholeNationDemeaningClaim(input: string): boolean {
    const text = input.toLowerCase().replace(/\s+/g, ' ');
    const group =
        '(?:한국인|일본인|중국인|미국인|러시아인|조선인|북한인|남한인|한국볼|일본볼|중국볼|미국볼|러시아볼|국민|민족|people|nationals)';
    const universal = '(?:전부|모두|다|항상|원래|inherently|all|always)';
    const insult = '(?:열등|멍청|미개|더럽|악랄|범죄자|쓰레기|하등|inferior|stupid|dirty|evil|criminal)';
    return new RegExp(`${group}.{0,18}${universal}.{0,18}${insult}`).test(text);
}

function hasSpecificCountryballAction(input: string): boolean {
    const text = input.trim();
    if (text.length < MIN_COUNTRYBALL_DRAMATIZED_ACTION_CHARS) return false;
    if (/설명|해설|나레이션|상황극\s*장면|재연하는\s*설명/.test(text)) return false;

    const hasCountryballActor =
        /[가-힣A-Za-z]+볼|[가-힣A-Za-z]+공|\b(?:KR|JP|US|CN|UK|FR|DE)\b|한국|일본|미국|중국|영국|프랑스|독일/.test(
            text
        );
    if (!hasCountryballActor) return false;

    return /걷|뛰|도망|떨|숨|가리키|던지|내밀|끄덕|열|찢|잡|들고|들어|줄을|쌓|주문|먹|마시|웃|울|당황|놀라|비웃|빼|꺼내|올라|브이|서류|스마트폰|배달|골목|한강|팝콘|차트|금|반지|문서|경례|박수|흔들|쓰러|올려/.test(
        text
    );
}

function buildAnalysisContract(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
    if (!metadata) return undefined;
    const outputContract = isRecord(metadata['outputContract']) ? metadata['outputContract'] : undefined;
    const requestSpec = isRecord(metadata['requestSpec']) ? metadata['requestSpec'] : undefined;
    if (outputContract) {
        return {
            ...outputContract,
            ...(requestSpec ? { requestSpec } : {}),
        };
    }
    if (!requestSpec) return undefined;
    return {
        requestTopic: requestSpec['userRequest'],
        outputKind: requestSpec['outputKind'],
        contentMode: requestSpec['contentMode'],
        requiredCoverageTerms: Array.isArray(requestSpec['focusTerms']) ? requestSpec['focusTerms'] : [],
        exactSubjectRequired:
            typeof requestSpec['exactSubjectRequired'] === 'boolean' ? requestSpec['exactSubjectRequired'] : true,
        requestSpec,
    };
}

function isSourceBackedNewsContext(
    text: string,
    banned: string,
    claimType: string | undefined,
    sourceRefs: unknown[]
): boolean {
    if (sourceRefs.length === 0) return false;
    if (claimType !== 'fact' && claimType !== 'context') return false;
    if (banned !== '사기' && banned !== '도박' && banned !== '폭력') return false;
    return /논란|의혹|혐의|사건|보도|수사|소송|판결|피해|문제/.test(text);
}

function hasAdmissionGuaranteeClaim(text: string): boolean {
    return (
        /100%/.test(text) ||
        /합격\s*보장|반드시\s*합격/.test(text) ||
        /무조건\s*(합격|붙|가능|성공|유리|불리|오른|떨어|된다|돼|됩니다)/.test(text)
    );
}

function hasAdmissionExactClaim(text: string): boolean {
    return (
        /\d{4}|\d+월|\d+일|\d+%|\d+등급|\d+점/.test(text) ||
        /정시|수시|모집|마감|원서|전형|수능|내신|등급|컷|경쟁률|반영/.test(text)
    );
}

function isRecord(input: unknown): input is Record<string, unknown> {
    return input != null && typeof input === 'object' && !Array.isArray(input);
}

function normalizeDialogueLines(input: unknown): DialogueLine[] {
    if (!Array.isArray(input)) return [];
    return input
        .map(item => {
            if (typeof item === 'string') {
                return {
                    speaker: '',
                    text: item.trim(),
                    structured: false,
                };
            }
            if (!isRecord(item)) {
                return {
                    speaker: '',
                    text: String(item ?? '').trim(),
                    structured: false,
                };
            }
            const text =
                typeof item['line'] === 'string'
                    ? item['line'].trim()
                    : typeof item['text'] === 'string'
                      ? item['text'].trim()
                      : '';
            const speaker =
                typeof item['speaker'] === 'string'
                    ? item['speaker'].trim()
                    : typeof item['country'] === 'string'
                      ? item['country'].trim()
                      : '';
            return {
                ...(typeof item['country'] === 'string' && item['country'].trim()
                    ? { country: item['country'].trim() }
                    : {}),
                ...(typeof item['line'] === 'string' && item['line'].trim() ? { line: item['line'].trim() } : {}),
                speaker,
                text,
                ...(typeof item['tone'] === 'string' && item['tone'].trim() ? { tone: item['tone'].trim() } : {}),
                ...(typeof item['emotion'] === 'string' && item['emotion'].trim()
                    ? { emotion: item['emotion'].trim() }
                    : {}),
                ...(typeof item['captionStyle'] === 'string' && item['captionStyle'].trim()
                    ? { captionStyle: item['captionStyle'].trim() }
                    : {}),
                ...(typeof item['durationSec'] === 'number' && Number.isFinite(item['durationSec'])
                    ? { durationSec: item['durationSec'] }
                    : {}),
                structured: true,
            };
        })
        .filter(line => line.text.length > 0 || line.speaker.length > 0);
}

function isNarratorSpeaker(input: string): boolean {
    return /^(narrator|voiceover|voice-over|해설|나레이터|내레이션|화자)$/i.test(input.trim());
}

function readNarratorLineText(input: unknown): string {
    if (typeof input === 'string') return input.trim();
    if (!isRecord(input)) return '';
    return typeof input['text'] === 'string' ? input['text'].trim() : '';
}

function isExplanatoryCountryballNarratorLine(input: string): boolean {
    if (input.length > 32) return true;
    return /이\s*장면|상황극|흐름|설명|해설|나레이션|보여줍니다|입니다|공식\s*지표|보도에\s*따르면|연구에\s*따르면/.test(
        input
    );
}

// ── AI enhancement ────────────────────────────────────────────────────────────

async function runAIReview(scenes: NormalizedScene[], ruleIssues: Issue[], analysisPrompt: string): Promise<Issue[]> {
    const narrationSummary = scenes
        .map(s => {
            const sourceRefs = Array.isArray(s.sourceRefs) ? s.sourceRefs.join(', ') : '';
            const evidenceRefs = Array.isArray(s.evidenceRefs) ? s.evidenceRefs.join(', ') : '';
            return [
                `씬 ${String(s.sceneNumber ?? '?')}`,
                `claimType=${String(s.claimType ?? 'unknown')}`,
                `sourceRefs=${sourceRefs || 'none'}`,
                `evidenceRefs=${evidenceRefs || 'none'}`,
                `narration=${String(s.narration ?? '')}`,
            ].join(' | ');
        })
        .join('\n');

    let response;
    try {
        response = await openaiAdapter.chatJson({
            systemPrompt: `${ANALYSIS_SYSTEM_PROMPT}\n\n${analysisPrompt}`,
            userMessage: [
                '다음 씬 나레이션을 검토해주세요.',
                'claimType=fact이고 sourceRefs/evidenceRefs가 모두 none이면 출처 누락으로 봅니다.',
                'sourceRefs 또는 evidenceRefs가 있으면 해당 씬은 출처 연결이 있는 것으로 간주하고, 출처 누락이라고 단정하지 마세요.',
                '',
                narrationSummary,
            ].join('\n'),
            maxTokens: 512,
        });
    } catch (err) {
        log.warn('[analysis-block] AI review failed (non-fatal), using rule-based only', {
            error: err instanceof Error ? err.message : String(err),
        });
        return ruleIssues;
    }

    let aiResult: {
        flaggedScenes?: unknown[];
        suggestedIssues?: Array<{ severity?: string; message?: string; sceneNumber?: number }>;
    };

    try {
        aiResult = JSON.parse(response.content);
    } catch {
        log.warn('[analysis-block] AI review returned non-JSON, ignoring AI enhancement');
        return ruleIssues;
    }

    const aiIssues: Issue[] = [];
    if (Array.isArray(aiResult.suggestedIssues)) {
        for (const issue of aiResult.suggestedIssues) {
            const severities = ['low', 'medium', 'high', 'critical'] as const;
            const sev = severities.includes(issue.severity as (typeof severities)[number])
                ? (issue.severity as Issue['severity'])
                : 'low';

            aiIssues.push({
                severity: sev,
                message: String(issue.message ?? ''),
                sceneNumber: typeof issue.sceneNumber === 'number' ? issue.sceneNumber : undefined,
            });
        }
    }

    // Deduplicate: skip AI issues that overlap with rule-based issues
    const combined = [...ruleIssues];
    for (const ai of aiIssues) {
        const duplicate = combined.some(r => r.sceneNumber === ai.sceneNumber && r.message === ai.message);
        if (!duplicate) combined.push(ai);
    }

    return combined;
}

// ── Executor ──────────────────────────────────────────────────────────────────

export const analysisBlock: BlockExecutor = {
    blockType: 'analysis',

    async execute(input: unknown, config?: Record<string, unknown>): Promise<BlockExecutorResult> {
        const mode = env.orchestratorMode;
        if (mode === 'mock') return dummyAnalysis();

        const start = Date.now();
        if (isLongformGateAInput(input, config)) {
            return reviewLongformGateA(input, start);
        }

        // Extract normalizedScenes from data-block output
        let scenes: NormalizedScene[] = [];
        let metadata: Record<string, unknown> | undefined;
        if (input != null && typeof input === 'object' && !Array.isArray(input)) {
            const obj = input as Record<string, unknown>;
            if (Array.isArray(obj['normalizedScenes'])) {
                scenes = obj['normalizedScenes'] as NormalizedScene[];
            }
            if (obj['metadata'] && typeof obj['metadata'] === 'object' && !Array.isArray(obj['metadata'])) {
                metadata = obj['metadata'] as Record<string, unknown>;
            }
        }
        const rulepack = selectShortsRulepack({
            presetId: metadata?.['presetId'],
            contentProfileId: metadata?.['contentProfileId'],
            imageStyleId: metadata?.['imageStyleId'],
            narrativeMode: metadata?.['narrativeMode'],
            style: metadata?.['style'],
            title: metadata?.['title'],
            keywords: scenes.flatMap(scene => (Array.isArray(scene.keywords) ? scene.keywords : [])),
        });

        if (scenes.length === 0) {
            log.warn('[analysis-block] No normalizedScenes found in input, running checks on empty set');
        }

        // Rule-based checks (always run)
        const analysisContract = buildAnalysisContract(metadata);
        const countryballMode = rulepack.id === 'countryball-shorts' || isCountryballContract(analysisContract);
        let {
            safetyScore,
            qualityScore,
            issues: ruleIssues,
        } = runRuleChecks(
            scenes,
            rulepack.id,
            typeof metadata?.['requestTopic'] === 'string' ? metadata['requestTopic'] : undefined,
            analysisContract
        );

        // AI enhancement in real provider mode; non-fatal if it fails.
        const reviewedIssues = await runAIReview(scenes, ruleIssues, rulepack.analysisPrompt);
        const allIssues = countryballMode
            ? reviewedIssues.filter(issue => !isCountryballAttributionOnlyIssue(issue))
            : reviewedIssues;
        let remediated = countryballMode
            ? { scenes, issues: allIssues, autoRemediations: [] as AutoRemediation[] }
            : autoRemediateSourceBackedFactualCautions(scenes, allIssues);
        const creativeRepair = await maybeRepairCreativeSimulationScenes({
            analysisContract,
            scenes: remediated.scenes,
            issues: remediated.issues,
            requestTopic: typeof metadata?.['requestTopic'] === 'string' ? metadata['requestTopic'] : undefined,
            rulepackId: rulepack.id,
        });
        if (creativeRepair) {
            const rerun = runRuleChecks(
                creativeRepair.scenes,
                rulepack.id,
                typeof metadata?.['requestTopic'] === 'string' ? metadata['requestTopic'] : undefined,
                analysisContract
            );
            safetyScore = rerun.safetyScore;
            qualityScore = rerun.qualityScore;
            ruleIssues = rerun.issues;
            remediated = {
                scenes: creativeRepair.scenes,
                issues: mergeIssues(
                    ruleIssues,
                    remediated.issues.filter(issue => !isRepairableCreativeSimulationIssue(issue))
                ),
                autoRemediations: [...remediated.autoRemediations, creativeRepair.autoRemediation],
            };
        }

        const blockingIssues = remediated.issues.filter(
            issue => issue.severity === 'high' || issue.severity === 'critical'
        );
        const approved = safetyScore >= SAFETY_THRESHOLD && blockingIssues.length === 0;

        const output = {
            safetyScore,
            qualityScore,
            issues: remediated.issues,
            approved,
            ...(remediated.autoRemediations.length > 0 ? { autoRemediations: remediated.autoRemediations } : {}),
        };

        const validated = AnalysisOutputSchema.safeParse(output);
        if (!validated.success) {
            throw new Error(`[analysis-block] Output schema validation failed: ${validated.error.message}`);
        }

        log.info('[analysis-block] Analysis complete', {
            safetyScore,
            qualityScore,
            issueCount: allIssues.length,
            blockingIssueCount: blockingIssues.length,
            approved,
        });

        return {
            output: {
                ...(validated.data as Record<string, unknown>),
                normalizedScenes: remediated.scenes,
                ...(metadata ? { metadata } : {}),
                presetId: rulepack.id,
            },
            durationMs: Date.now() - start,
        };
    },
};

async function maybeRepairCreativeSimulationScenes(params: {
    analysisContract: Record<string, unknown> | undefined;
    scenes: NormalizedScene[];
    issues: Issue[];
    requestTopic?: string;
    rulepackId: string;
}): Promise<{ scenes: NormalizedScene[]; autoRemediation: AutoRemediation } | undefined> {
    if (!isCreativeSimulationContract(params.analysisContract)) return undefined;
    if (!shouldAttemptCreativeSimulationRepair(params.issues)) return undefined;

    const requestSpec = isRecord(params.analysisContract?.['requestSpec'])
        ? params.analysisContract?.['requestSpec']
        : undefined;
    const requestText =
        (typeof params.analysisContract?.['requestTopic'] === 'string'
            ? params.analysisContract['requestTopic']
            : undefined) ??
        (typeof requestSpec?.['userRequest'] === 'string' ? requestSpec['userRequest'] : undefined) ??
        params.requestTopic ??
        '';

    let response;
    try {
        response = await openaiAdapter.chatJson({
            systemPrompt: [
                'You rewrite Korean creative-simulation Shorts scenes after a quality review.',
                'Return JSON only with { "scenes": [...] }.',
                'Keep the same number of scenes and preserve sceneNumber order.',
                'Preserve the user named participants, starting condition, and matchup premise.',
                'Each scene must change the simulated fight state: initiative, distance, constraint, counter, escalation, damage, or verdict tension.',
                'Do not write generic explanations or repeated attack/block loops.',
                'Avoid absolute winner wording. Use interpretation-safe phrasing for verdict scenes.',
                'Use claimType "hypothetical" or "opinion" unless the scene cites a real source.',
                'sourceRefs may be [] for pure fictional simulation scenes.',
                'imagePrompt must be a drawable current-scene action beat, not a summary paragraph.',
            ].join('\n'),
            userMessage: [
                `User request: ${requestText}`,
                `Rulepack: ${params.rulepackId}`,
                'Review issues to fix:',
                JSON.stringify(params.issues.filter(isRepairableCreativeSimulationIssue), null, 2),
                'Current scenes:',
                JSON.stringify(params.scenes, null, 2),
            ].join('\n\n'),
            maxTokens: 3200,
        });
    } catch (err) {
        log.warn('[analysis-block] creative simulation repair failed (non-fatal)', {
            error: err instanceof Error ? err.message : String(err),
        });
        return undefined;
    }

    const repairedScenes = parseCreativeSimulationRepair(response.content, params.scenes);
    if (!repairedScenes) return undefined;

    return {
        scenes: repairedScenes,
        autoRemediation: {
            sceneNumber: 0,
            action: 'rewrite-creative-simulation-scenes',
            before: summarizeScenesForRemediation(params.scenes),
            after: summarizeScenesForRemediation(repairedScenes),
            reason: params.issues
                .filter(isRepairableCreativeSimulationIssue)
                .map(issue => issue.message)
                .join(' / '),
        },
    };
}

function shouldAttemptCreativeSimulationRepair(issues: Issue[]): boolean {
    const blockingIssues = issues.filter(issue => issue.severity === 'high' || issue.severity === 'critical');
    if (blockingIssues.length === 0) return false;
    return blockingIssues.every(isRepairableCreativeSimulationIssue);
}

function isRepairableCreativeSimulationIssue(issue: Issue): boolean {
    if (issue.severity !== 'high' && issue.severity !== 'critical') return false;
    const message = issue.message;
    if (/sourceRefs?|출처|금지\s*키워드|혐오|불법|마약|음란|도박|성인|사기|보장\/과장/.test(message)) {
        return false;
    }
    return /핵심\s*주제|유사한\s*문장|반복|템포|단정|완곡|대결|해석형|시뮬레이션|흐름|상성|설명/.test(message);
}

function parseCreativeSimulationRepair(
    content: string,
    originalScenes: NormalizedScene[]
): NormalizedScene[] | undefined {
    let parsed: unknown;
    try {
        parsed = JSON.parse(content);
    } catch {
        log.warn('[analysis-block] creative simulation repair returned non-JSON');
        return undefined;
    }

    const rawScenes = isRecord(parsed) && Array.isArray(parsed['scenes']) ? parsed['scenes'] : undefined;
    if (!rawScenes || rawScenes.length !== originalScenes.length) {
        log.warn('[analysis-block] creative simulation repair scene count mismatch', {
            expected: originalScenes.length,
            actual: rawScenes?.length,
        });
        return undefined;
    }

    return rawScenes.map((raw, index) => normalizeCreativeRepairScene(raw, originalScenes[index], index));
}

function normalizeCreativeRepairScene(
    raw: unknown,
    original: NormalizedScene | undefined,
    index: number
): NormalizedScene {
    const record = isRecord(raw) ? raw : {};
    const originalVisual = isRecord(original?.visual) ? original?.visual : {};
    const visual = isRecord(record['visual']) ? record['visual'] : {};
    const caption =
        typeof record['caption'] === 'string'
            ? record['caption']
            : typeof visual['mainCaption'] === 'string'
              ? visual['mainCaption']
              : typeof original?.caption === 'string'
                ? original.caption
                : `전황 ${index + 1}`;
    const topTitle =
        typeof record['topTitle'] === 'string'
            ? record['topTitle']
            : typeof visual['topTitle'] === 'string'
              ? visual['topTitle']
              : typeof original?.topTitle === 'string'
                ? original.topTitle
                : typeof originalVisual['topTitle'] === 'string'
                  ? originalVisual['topTitle']
                  : '';
    const mainCaption =
        typeof visual['mainCaption'] === 'string'
            ? visual['mainCaption']
            : typeof record['visualText'] === 'string'
              ? record['visualText']
              : caption;

    return {
        ...original,
        ...record,
        sceneNumber: typeof record['sceneNumber'] === 'number' ? record['sceneNumber'] : index + 1,
        caption,
        narration:
            typeof record['narration'] === 'string'
                ? record['narration']
                : typeof original?.narration === 'string'
                  ? original.narration
                  : '',
        imagePrompt:
            typeof record['imagePrompt'] === 'string'
                ? record['imagePrompt']
                : typeof original?.imagePrompt === 'string'
                  ? original.imagePrompt
                  : 'A cinematic fictional matchup simulation beat.',
        visualText:
            typeof record['visualText'] === 'string'
                ? record['visualText']
                : typeof original?.visualText === 'string'
                  ? original.visualText
                  : mainCaption,
        visual: {
            ...originalVisual,
            ...visual,
            ...(topTitle ? { topTitle } : {}),
            mainCaption,
        },
        claimType:
            record['claimType'] === 'fact' ||
            record['claimType'] === 'hypothetical' ||
            record['claimType'] === 'opinion' ||
            record['claimType'] === 'joke'
                ? record['claimType']
                : original?.claimType === 'fact' ||
                    original?.claimType === 'hypothetical' ||
                    original?.claimType === 'opinion' ||
                    original?.claimType === 'joke'
                  ? original.claimType
                  : 'hypothetical',
        sourceRefs: Array.isArray(record['sourceRefs'])
            ? record['sourceRefs']
            : Array.isArray(original?.sourceRefs)
              ? original.sourceRefs
              : [],
        durationSec:
            typeof record['durationSec'] === 'number'
                ? record['durationSec']
                : typeof original?.durationSec === 'number'
                  ? original.durationSec
                  : 5,
    };
}

function summarizeScenesForRemediation(scenes: NormalizedScene[]): string {
    return scenes
        .slice(0, 4)
        .map(scene => `${String(scene.sceneNumber ?? '?')}: ${String(scene.narration ?? '')}`)
        .join(' / ');
}

function mergeIssues(first: Issue[], second: Issue[]): Issue[] {
    const merged: Issue[] = [...first];
    for (const issue of second) {
        const duplicate = merged.some(
            existing =>
                existing.severity === issue.severity &&
                existing.sceneNumber === issue.sceneNumber &&
                existing.message === issue.message
        );
        if (!duplicate) merged.push(issue);
    }
    return merged;
}

function autoRemediateSourceBackedFactualCautions(
    scenes: NormalizedScene[],
    issues: Issue[]
): {
    scenes: NormalizedScene[];
    issues: Issue[];
    autoRemediations: AutoRemediation[];
} {
    const sceneCopies = scenes.map(scene => ({ ...scene }));
    const autoRemediations: AutoRemediation[] = [];
    const remediatedIssueIndexes = new Set<number>();

    issues.forEach((issue, issueIndex) => {
        if (!isRemediableSourceBackedFactualCaution(issue)) return;
        if (typeof issue.sceneNumber !== 'number') return;

        const sceneIndex = sceneCopies.findIndex(scene => scene.sceneNumber === issue.sceneNumber);
        if (sceneIndex < 0) return;

        const scene = sceneCopies[sceneIndex];
        if (scene.claimType !== 'fact') return;
        if (!Array.isArray(scene.sourceRefs) || scene.sourceRefs.length === 0) return;
        if (typeof scene.narration !== 'string' || scene.narration.trim().length === 0) return;

        const before = scene.narration.trim();
        const after = softenFactualNarration(before);
        if (after === before) return;

        sceneCopies[sceneIndex] = { ...scene, narration: after };
        autoRemediations.push({
            sceneNumber: issue.sceneNumber,
            action: 'soften-factual-wording',
            before,
            after,
            reason: issue.message,
        });
        remediatedIssueIndexes.add(issueIndex);
    });

    const downgradedIssues = issues.map((issue, issueIndex) => {
        if (!remediatedIssueIndexes.has(issueIndex)) return issue;
        return {
            ...issue,
            severity: 'medium' as const,
            message: `자동 완화: ${issue.message}`,
        };
    });

    return { scenes: sceneCopies, issues: downgradedIssues, autoRemediations };
}

function isRemediableSourceBackedFactualCaution(issue: Issue): boolean {
    if (issue.severity !== 'high' && issue.severity !== 'critical') return false;
    const message = issue.message;
    if (/sourceRefs?\s*가\s*없|출처.*없|출처\s*누락|금지\s*키워드|보장\/과장|보장|혐오|불법|마약|음란/.test(message)) {
        return false;
    }
    return /공식\s*발표|보도|시점|최신|재확인|단정형|단정|확인일|사실관계|기준|표현/.test(message);
}

function isCountryballAttributionOnlyIssue(issue: Issue): boolean {
    if (issue.severity !== 'high' && issue.severity !== 'critical') return false;
    const message = issue.message;
    if (/혐오|비하|슬러|열등|inferior|dehuman|sourceRefs?\s*가\s*없|출처\s*누락/.test(message)) return false;
    return /공식\s*지표|공식\s*발표|보도에\s*따르면|출처를\s*드러내|근거|단정|사실\s*진술|표현으로\s*완화/.test(
        message
    );
}

function softenFactualNarration(narration: string): string {
    if (/^(공식 발표 기준으로|공식 발표에 따르면|보도에 따르면|출처 기준으로)/.test(narration)) {
        return narration;
    }
    return `공식 발표 기준으로, ${narration}`;
}

function isLongformGateAInput(input: unknown, config?: Record<string, unknown>): boolean {
    const values: unknown[] = [config?.['mode'], config?.['gate']];
    if (input && typeof input === 'object' && !Array.isArray(input)) {
        const obj = input as Record<string, unknown>;
        values.push(obj['mode'], obj['gate'], obj['contentProfileId']);
    }
    const text = values
        .filter((value): value is string => typeof value === 'string')
        .join(' ')
        .toLowerCase();
    return text.includes('longform-gate-a') || text.includes('longform.');
}

function reviewLongformGateA(input: unknown, start: number): BlockExecutorResult {
    const obj = isRecord(input) ? input : {};
    const issues: Issue[] = [];

    if (!Array.isArray(obj['outline']) || obj['outline'].length === 0) {
        issues.push({ severity: 'high', message: '롱폼 outline이 없습니다.' });
    }
    if (typeof obj['fullScriptDraft'] !== 'string' || obj['fullScriptDraft'].trim().length < 20) {
        issues.push({ severity: 'high', message: '롱폼 fullScriptDraft가 없거나 너무 짧습니다.' });
    }
    if (!Array.isArray(obj['scenePlan']) || obj['scenePlan'].length === 0) {
        issues.push({ severity: 'high', message: '롱폼 scenePlan이 없습니다.' });
    }
    if (!readPositiveNumber(obj['estimatedDurationSec'])) {
        issues.push({ severity: 'medium', message: '롱폼 estimatedDurationSec가 없습니다.' });
    }
    if (!isRecord(obj['estimatedCost'])) {
        issues.push({ severity: 'medium', message: '롱폼 estimatedCost가 없습니다.' });
    }
    if (typeof obj['rendererRoute'] !== 'string' || obj['rendererRoute'].trim().length === 0) {
        issues.push({ severity: 'medium', message: '롱폼 rendererRoute가 없습니다.' });
    }
    if (obj['mediaExecutionAllowed'] !== false) {
        issues.push({ severity: 'critical', message: '검수 단계에서는 유료 media execution이 차단되어야 합니다.' });
    }

    const blockingIssues = issues.filter(issue => issue.severity === 'high' || issue.severity === 'critical');
    const approved = blockingIssues.length === 0;

    return {
        output: {
            ...obj,
            gate: 'A',
            mode: 'longform-gate-a',
            safetyScore: issues.some(issue => issue.severity === 'critical') ? 0 : 100,
            qualityScore: Math.max(0, 100 - issues.length * 10),
            issues,
            approved,
            mediaExecutionAllowed: false,
        },
        durationMs: Date.now() - start,
    };
}

function readPositiveNumber(input: unknown): number | undefined {
    const value = Number(input);
    return Number.isFinite(value) && value > 0 ? value : undefined;
}
