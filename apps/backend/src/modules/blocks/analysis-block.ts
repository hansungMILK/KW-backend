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
const QUALITY_THRESHOLD = 60;
const ADMISSION_SAFE_VIOLENCE_TERMS = ['학교폭력', '학폭', '폭력 조치사항'];

// ── Prompts ───────────────────────────────────────────────────────────────────

const ANALYSIS_SYSTEM_PROMPT = `You are a Korean YouTube Shorts content safety and quality reviewer.
Review the provided scene narrations and return a brief assessment.

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

interface NormalizedScene {
    sceneNumber?: unknown;
    caption?: unknown;
    narration?: unknown;
    imagePrompt?: unknown;
    visualText?: unknown;
    sourceRefs?: unknown;
    keywords?: unknown;
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
    presetId: string
): {
    safetyScore: number;
    qualityScore: number;
    issues: Issue[];
} {
    const issues: Issue[] = [];
    let safetyDeductions = 0;
    let qualityDeductions = 0;

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
    for (const scene of scenes) {
        const sceneNum = typeof scene.sceneNumber === 'number' ? scene.sceneNumber : undefined;
        const narration = typeof scene.narration === 'string' ? scene.narration : '';
        const caption = typeof scene.caption === 'string' ? scene.caption : '';
        const visualText = typeof scene.visualText === 'string' ? scene.visualText : caption;
        const sourceRefs = Array.isArray(scene.sourceRefs) ? scene.sourceRefs : [];

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
        const combinedText = [narration, typeof scene.imagePrompt === 'string' ? scene.imagePrompt : '']
            .join(' ')
            .toLowerCase();

        for (const banned of BANNED_KEYWORDS) {
            if (hasBannedKeyword(combinedText, banned, presetId)) {
                issues.push({
                    severity: 'high',
                    message: `금지 키워드 "${banned}" 감지됨.`,
                    sceneNumber: sceneNum,
                });
                safetyDeductions += 20;
                break; // one deduction per scene
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

        if (visualText.length > 24) {
            issues.push({
                severity: 'medium',
                message: `이미지 안 텍스트가 너무 깁니다 (${visualText.length}자). GPT-image-2용 문구는 24자 이하 권장.`,
                sceneNumber: sceneNum,
            });
            qualityDeductions += 4;
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

    const safetyScore = Math.max(0, Math.min(100, 100 - safetyDeductions));
    const qualityScore = Math.max(0, Math.min(100, 100 - qualityDeductions));

    return { safetyScore, qualityScore, issues };
}

function hasBannedKeyword(text: string, banned: string, presetId: string): boolean {
    if (banned === '폭력' && presetId === 'education-admission') {
        const normalized = ADMISSION_SAFE_VIOLENCE_TERMS.reduce(
            (current, safeTerm) => current.replaceAll(safeTerm, ''),
            text
        );
        return normalized.includes(banned);
    }
    return text.includes(banned);
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

// ── AI enhancement ────────────────────────────────────────────────────────────

async function runAIReview(scenes: NormalizedScene[], ruleIssues: Issue[], analysisPrompt: string): Promise<Issue[]> {
    const narrationSummary = scenes
        .map(s => `씬 ${String(s.sceneNumber ?? '?')}: ${String(s.narration ?? '')}`)
        .join('\n');

    let response;
    try {
        response = await openaiAdapter.chatJson({
            systemPrompt: `${ANALYSIS_SYSTEM_PROMPT}\n\n${analysisPrompt}`,
            userMessage: `다음 씬 나레이션을 검토해주세요:\n\n${narrationSummary}`,
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

    async execute(input: unknown, _config?: Record<string, unknown>): Promise<BlockExecutorResult> {
        const mode = env.orchestratorMode;
        if (mode === 'mock') return dummyAnalysis();

        const start = Date.now();

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
            title: metadata?.['title'],
            keywords: scenes.flatMap(scene => (Array.isArray(scene.keywords) ? scene.keywords : [])),
        });

        if (scenes.length === 0) {
            log.warn('[analysis-block] No normalizedScenes found in input, running checks on empty set');
        }

        // Rule-based checks (always run)
        const { safetyScore, qualityScore, issues: ruleIssues } = runRuleChecks(scenes, rulepack.id);

        // AI enhancement in real provider mode; non-fatal if it fails.
        const allIssues = await runAIReview(scenes, ruleIssues, rulepack.analysisPrompt);

        const approved = safetyScore >= SAFETY_THRESHOLD && qualityScore >= QUALITY_THRESHOLD;

        const output = {
            safetyScore,
            qualityScore,
            issues: allIssues,
            approved,
        };

        const validated = AnalysisOutputSchema.safeParse(output);
        if (!validated.success) {
            throw new Error(`[analysis-block] Output schema validation failed: ${validated.error.message}`);
        }

        log.info('[analysis-block] Analysis complete', {
            safetyScore,
            qualityScore,
            issueCount: allIssues.length,
            approved,
        });

        return {
            output: {
                ...(validated.data as Record<string, unknown>),
                normalizedScenes: scenes,
                ...(metadata ? { metadata } : {}),
                presetId: rulepack.id,
            },
            durationMs: Date.now() - start,
        };
    },
};
