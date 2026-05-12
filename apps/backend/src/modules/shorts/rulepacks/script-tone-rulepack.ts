import {
    normalizeReviewMode,
    normalizeScriptToneId,
    normalizeScriptToneIntensity,
} from '../../content-profile/content-profile';

import type { ReviewMode, ScriptToneId, ScriptToneIntensity } from '../../content-profile/content-profile';

export type ScriptToneRulepack = {
    id: ScriptToneId;
    label: string;
    rules: string[];
};

const TONE_RULEPACKS: Record<ScriptToneId, ScriptToneRulepack> = {
    'informative-reframe': {
        id: 'informative-reframe',
        label: '정보전달형',
        rules: [
            '단순 나열이 아니라 겉보기 원인과 진짜 원인을 나눠서 설명한다.',
            '핵심은 가능하면 세 가지로 정리한다.',
            '문장은 짧게 끊고, 마지막은 관점 전환으로 끝낸다.',
        ],
    },
    'mz-viral': {
        id: 'mz-viral',
        label: 'MZ 바이럴형',
        rules: [
            '가벼운 놀람과 빠른 리듬을 쓰되, 사실을 과장하지 않는다.',
            '유행어는 자연스럽게 1-2회만 사용하고 정보 전달을 방해하지 않는다.',
            '훅은 친구에게 알려주는 말투처럼 시작한다.',
        ],
    },
    'news-anchor': {
        id: 'news-anchor',
        label: '뉴스앵커형',
        rules: [
            '뉴스 앵커처럼 사실 관계를 먼저 밝히고, 확인된 내용과 미확인 내용을 분리한다.',
            '단정적인 감탄사보다 누가, 언제, 무엇을 했는지 차분하게 전달한다.',
            '논란형 주제는 양쪽 주장과 공식 입장 여부를 구분한다.',
        ],
    },
    'story-dialogue': {
        id: 'story-dialogue',
        label: '이야기 진행형',
        rules: [
            '질문과 답이 이어지는 흐름으로 쓴다.',
            '처음에는 시청자가 할 법한 오해를 제시하고, 뒤에서 반전처럼 풀어낸다.',
            '각 장면은 앞 장면의 궁금증을 받아 다음 장면으로 넘긴다.',
        ],
    },
    'calm-explainer': {
        id: 'calm-explainer',
        label: '차분한 해설형',
        rules: [
            '감탄보다 맥락과 정의를 우선한다.',
            '어려운 개념은 쉬운 비유로 바로 바꾼다.',
            '롱폼으로 확장해도 어색하지 않은 안정적인 설명 톤을 유지한다.',
        ],
    },
};

export function buildScriptTonePrompt(config?: Record<string, unknown>): string {
    const toneId = normalizeScriptToneId(config?.['scriptToneId']);
    const intensity = normalizeScriptToneIntensity(config?.['scriptToneIntensity']);
    const reviewMode = normalizeReviewMode(config?.['reviewMode']);
    const contentProfileId = typeof config?.['contentProfileId'] === 'string' ? config['contentProfileId'] : 'unknown';
    const tone = TONE_RULEPACKS[toneId];

    return [
        `Script Tone Rulepack: ${tone.id}`,
        `Tone label: ${tone.label}`,
        `Tone intensity: ${intensity}`,
        `Review mode: ${reviewMode}`,
        `Content profile: ${contentProfileId}`,
        'Rules:',
        ...tone.rules.map(rule => `- ${rule}`),
        intensityInstruction(intensity),
        reviewModeInstruction(reviewMode),
    ].join('\n');
}

export function buildContentPreferencePrompt(config?: Record<string, unknown>): string {
    const toneId = normalizeScriptToneId(config?.['scriptToneId']);
    const intensity = normalizeScriptToneIntensity(config?.['scriptToneIntensity']);
    const contentProfileId = typeof config?.['contentProfileId'] === 'string' ? config['contentProfileId'] : 'unknown';
    const tone = TONE_RULEPACKS[toneId];

    return [
        `Content Preference: ${contentProfileId}`,
        `Tone preference: ${tone.id}`,
        `Tone label: ${tone.label}`,
        `Tone intensity: ${intensity}`,
        'Preference rules:',
        ...tone.rules.map(rule => `- ${rule}`),
    ].join('\n');
}

function intensityInstruction(intensity: ScriptToneIntensity): string {
    if (intensity === 'high') return '- Apply the selected tone strongly, but do not break source accuracy.';
    if (intensity === 'low') return '- Apply the selected tone lightly and keep wording restrained.';
    return '- Apply the selected tone naturally without exaggeration.';
}

function reviewModeInstruction(reviewMode: ReviewMode): string {
    if (reviewMode === 'script-first') {
        return '- This script may be reviewed by the user before paid media generation, so make the scenes easy to inspect and edit.';
    }
    return '- This script may proceed directly into paid media generation, so avoid ambiguous placeholders.';
}
