import type { ClaudeProposalOutput } from './response-parser';
import type { ContentProfilePreferences } from '../content-profile/content-profile';

const LONGFORM_FULL_FACTORY_ESTIMATED_COST_USD = 0.82;

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
            goal: '롱폼 제작 기획안을 먼저 만들고 사용자가 검수한 뒤 같은 워크플로우에서 영상 제작으로 진행한다',
            outputType: 'video',
            planType: 'interactive',
            requiredCapabilities: [
                'longform.source',
                'longform.brief',
                'longform.script',
                'longform.storyboard',
                'longform.scene-json',
                'longform.review',
                'longform.tts',
                'longform.srt-align',
                'longform.motion-compose',
                'longform.render',
                'longform.qa',
                'longform.package',
            ],
            selectedBlocks: [
                { blockType: 'longform-source', reason: '원문과 보조 자료를 롱폼 source digest로 정리한다' },
                { blockType: 'longform-brief', reason: '시청자 약속, 관점, 논리 구조를 잡는다' },
                { blockType: 'longform-script', reason: '검수 가능한 전체 내레이션 초안을 작성한다' },
                { blockType: 'longform-storyboard', reason: '대본을 장면 의도와 화면 리듬으로 나눈다' },
                { blockType: 'longform-scene-json', reason: 'HyperFrames 2K 장면 계약으로 변환한다' },
                { blockType: 'longform-review', reason: '사용자 검수 전에는 유료 제작을 멈춘다' },
                { blockType: 'longform-tts', reason: '승인된 대본으로 내레이션 TTS를 만든다' },
                { blockType: 'longform-srt-align', reason: 'TTS timing을 기준으로 자막 cue를 정렬한다' },
                { blockType: 'longform-motion-compose', reason: '장면 계약과 자막으로 모션 composition을 만든다' },
                { blockType: 'longform-render', reason: 'HyperFrames 경로로 2K MP4를 렌더한다' },
                { blockType: 'longform-qa', reason: 'MP4, 오디오, 해상도, 자막, 모션 품질을 검수한다' },
                { blockType: 'longform-package', reason: '미리보기와 다운로드 가능한 최종 패키지를 만든다' },
            ],
            rejectedBlocks: [
                { blockType: 'search', reason: '롱폼 전용 source digest 노드로 대체한다' },
                { blockType: 'content', reason: '롱폼 전용 brief/script 노드로 분리한다' },
                { blockType: 'data', reason: '롱폼 전용 storyboard/scene-json 노드로 분리한다' },
                { blockType: 'analysis', reason: '롱폼 전용 review 노드로 대체한다' },
                { blockType: 'media-image', reason: '사용자 확인 전에는 이미지 생성 비용을 발생시키지 않는다' },
                { blockType: 'media-tts', reason: '롱폼 전용 TTS 노드로 대체한다' },
                { blockType: 'media-video', reason: '롱폼 전용 HyperFrames/MP4 렌더 노드로 대체한다' },
                { blockType: 'integration', reason: '최종 배포 메타데이터는 영상 제작 완료 후 생성한다' },
            ],
            assumptions: ['롱폼은 하나의 캔버스에 전체 제작 공장을 보여주되 대본/씬 검수 후 유료 제작을 시작한다'],
        },
        blocks: [
            {
                type: 'longform-source',
                label: '롱폼 자료 수집',
                config: {
                    mode: 'longform-gate-a',
                    query: topic,
                    userRequest: topic,
                },
            },
            {
                type: 'longform-brief',
                label: '롱폼 관점 설계',
                config: {
                    mode: 'longform-gate-a',
                    topic,
                    contentProfileId: contentProfile.contentProfileId,
                    rendererRoute,
                    targetDurationSec,
                    maxDurationSec: targetDurationSec,
                    mediaExecutionAllowed: false,
                },
            },
            {
                type: 'longform-script',
                label: '롱폼 대본 작성',
                config: {
                    mode: 'longform-gate-a',
                    topic,
                    contentProfileId: contentProfile.contentProfileId,
                    scriptToneId: contentProfile.scriptToneId,
                    scriptToneIntensity: contentProfile.scriptToneIntensity,
                    reviewMode: 'script-first',
                    targetDurationSec,
                    maxDurationSec: targetDurationSec,
                    mediaExecutionAllowed: false,
                },
            },
            {
                type: 'longform-storyboard',
                label: '롱폼 스토리보드',
                config: {
                    mode: 'longform-gate-a',
                    rendererRoute,
                    mediaExecutionAllowed: false,
                },
            },
            {
                type: 'longform-scene-json',
                label: '롱폼 장면 계약',
                config: {
                    mode: 'longform-gate-a',
                    renderer: 'hyperframes',
                    rendererRoute,
                    resolution: '2560x1440',
                    mediaExecutionAllowed: false,
                },
            },
            {
                type: 'longform-review',
                label: '롱폼 사용자 검수',
                config: {
                    mode: 'longform-gate-a',
                    rendererRoute,
                    reviewMode: 'script-first',
                    mediaExecutionAllowed: false,
                },
            },
            {
                type: 'longform-tts',
                label: '롱폼 음성 생성',
                config: {
                    mode: 'longform-gate-b',
                    provider: 'auto',
                    contentProfileId: contentProfile.contentProfileId,
                    reviewMode: 'script-first',
                    mediaExecutionAllowed: false,
                    approvalRequired: true,
                },
            },
            {
                type: 'longform-srt-align',
                label: '롱폼 자막 정렬',
                config: {
                    mode: 'longform-gate-b',
                    alignmentMethod: 'tts-duration-aligned',
                    contentProfileId: contentProfile.contentProfileId,
                    mediaExecutionAllowed: false,
                    approvalRequired: true,
                },
            },
            {
                type: 'longform-motion-compose',
                label: '롱폼 모션 설계',
                config: {
                    mode: 'longform-gate-b',
                    rendererRoute,
                    resolution: '2560x1440',
                    contentProfileId: contentProfile.contentProfileId,
                    mediaExecutionAllowed: false,
                    approvalRequired: true,
                },
            },
            {
                type: 'longform-render',
                label: '롱폼 2K 렌더',
                config: {
                    mode: 'longform-gate-b',
                    rendererRoute,
                    renderer: 'hyperframes',
                    resolution: '2560x1440',
                    backgroundMusicPath: 'assets/bgm/default-bgm.mp3',
                    longformHtmlRenderEstimatedCostUsd: 0.75,
                    contentProfileId: contentProfile.contentProfileId,
                    mediaExecutionAllowed: false,
                    approvalRequired: true,
                },
            },
            {
                type: 'longform-qa',
                label: '롱폼 QA',
                config: {
                    mode: 'longform-gate-b',
                    requiredResolution: '2560x1440',
                    requireAudioStream: true,
                    requireVideoStream: true,
                    contentProfileId: contentProfile.contentProfileId,
                    mediaExecutionAllowed: false,
                    approvalRequired: true,
                },
            },
            {
                type: 'longform-package',
                label: '롱폼 패키지',
                config: {
                    mode: 'longform-gate-b',
                    contentProfileId: contentProfile.contentProfileId,
                    mediaExecutionAllowed: false,
                    approvalRequired: true,
                },
            },
        ],
        edges: [
            { from: 0, to: 1 },
            { from: 1, to: 2 },
            { from: 2, to: 3 },
            { from: 3, to: 4 },
            { from: 4, to: 5 },
            { from: 5, to: 6 },
            { from: 6, to: 7 },
            { from: 7, to: 8 },
            { from: 8, to: 9 },
            { from: 9, to: 10 },
            { from: 10, to: 11 },
        ],
        estimatedCostUsd: LONGFORM_FULL_FACTORY_ESTIMATED_COST_USD,
        summary:
            '롱폼 제작 기획안을 먼저 준비하고, 같은 캔버스에서 검수 후 TTS, 자막 정렬, 모션 구성, 2K 렌더, QA, 패키징까지 이어지는 워크플로우입니다.',
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
