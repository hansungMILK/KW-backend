import type { ClaudeProposalOutput } from './response-parser';
import type { ContentProfilePreferences } from '../content-profile/content-profile';

const LONGFORM_GATE_A_ESTIMATED_COST_USD = 0.16;

export function isLongformContentProfile(contentProfileId: unknown): boolean {
    return typeof contentProfileId === 'string' && contentProfileId.startsWith('longform.');
}

export function enforceLongformGateAProfile(contentProfile: ContentProfilePreferences): ContentProfilePreferences {
    if (!isLongformContentProfile(contentProfile.contentProfileId)) return contentProfile;
    return {
        ...contentProfile,
        reviewMode: 'script-first',
    };
}

export function buildLongformGateAWorkflow(
    userMessage: string,
    contentProfile: Pick<ContentProfilePreferences, 'contentProfileId' | 'scriptToneId' | 'scriptToneIntensity'>
): ClaudeProposalOutput {
    const topic = userMessage.trim() || '롱폼 영상 주제';
    const rendererRoute = 'hyperframes';
    const targetDurationSec = resolveLongformTargetDurationSec(userMessage);

    return {
        plan: {
            goal: '롱폼 제작 기획안을 먼저 만들고 사용자가 검수한 뒤 영상 제작으로 진행한다',
            outputType: 'data',
            planType: 'interactive',
            requiredCapabilities: ['source.collect', 'text.generate', 'data.structure', 'quality.review'],
            selectedBlocks: [
                { blockType: 'search', reason: '원문과 보조 자료를 수집해 source digest를 만든다' },
                { blockType: 'content', reason: '롱폼 outline, full script draft, scene plan을 작성한다' },
                { blockType: 'data', reason: '제작 기획안을 검수/승인 가능한 구조로 정규화한다' },
                { blockType: 'analysis', reason: '유료 제작 전 필수 산출물과 비용/렌더 경로를 검수한다' },
            ],
            rejectedBlocks: [
                { blockType: 'media-image', reason: '사용자 확인 전에는 이미지 생성 비용을 발생시키지 않는다' },
                { blockType: 'media-tts', reason: '사용자 확인 전에는 TTS 비용을 발생시키지 않는다' },
                { blockType: 'media-video', reason: '사용자 확인 전에는 HyperFrames/MP4 렌더를 실행하지 않는다' },
                { blockType: 'integration', reason: '최종 배포 메타데이터는 영상 제작 완료 후 생성한다' },
            ],
            assumptions: ['롱폼은 대본/씬 검수 후 유료 제작을 시작한다'],
        },
        blocks: [
            {
                type: 'search',
                label: '롱폼 자료 수집',
                config: {
                    mode: 'longform-gate-a',
                    query: topic,
                },
            },
            {
                type: 'content',
                label: '롱폼 기획안 작성',
                config: {
                    mode: 'longform-gate-a',
                    topic,
                    contentProfileId: contentProfile.contentProfileId,
                    scriptToneId: contentProfile.scriptToneId,
                    scriptToneIntensity: contentProfile.scriptToneIntensity,
                    reviewMode: 'script-first',
                    rendererRoute,
                    targetDurationSec,
                    maxDurationSec: targetDurationSec,
                    mediaExecutionAllowed: false,
                },
            },
            {
                type: 'data',
                label: '롱폼 기획안 정리',
                config: {
                    mode: 'longform-gate-a',
                    rendererRoute,
                    mediaExecutionAllowed: false,
                },
            },
            {
                type: 'analysis',
                label: '롱폼 제작 검수',
                config: {
                    mode: 'longform-gate-a',
                    rendererRoute,
                    mediaExecutionAllowed: false,
                },
            },
        ],
        edges: [
            { from: 0, to: 1 },
            { from: 1, to: 2 },
            { from: 2, to: 3 },
        ],
        estimatedCostUsd: LONGFORM_GATE_A_ESTIMATED_COST_USD,
        summary:
            '롱폼 제작 기획안을 먼저 준비합니다. 자료 수집, outline, full script draft, scene plan, 예상 길이/비용/렌더 경로를 만든 뒤 사용자가 확인하면 영상 제작으로 이어집니다.',
    };
}

function resolveLongformTargetDurationSec(userMessage: string): number {
    const minuteMatch = userMessage.match(/(\d{1,2})\s*(?:분|minutes?|mins?)/i);
    if (minuteMatch) {
        const minutes = Number(minuteMatch[1]);
        if (Number.isFinite(minutes) && minutes > 0) return Math.min(60, minutes) * 60;
    }

    const secondMatch = userMessage.match(/(\d{2,4})\s*(?:초|seconds?|secs?)/i);
    if (secondMatch) {
        const seconds = Number(secondMatch[1]);
        if (Number.isFinite(seconds) && seconds > 0) return Math.min(3600, seconds);
    }

    return 300;
}
