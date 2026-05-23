import { isCountryballShortsRequest } from '../content-profile/content-profile';
import { COUNTRYBALL_SHORTS_RULEPACK } from './rulepacks/countryball-shorts-rulepack';
import { EDUCATION_ADMISSION_RULEPACK } from './rulepacks/education-admission-rulepack';
import { GENERAL_SHORTS_RULEPACK } from './rulepacks/general-shorts-rulepack';

import type { ShortsRulepack } from './rulepacks/base-shorts-rulepack';

export function selectShortsRulepack(input: unknown): ShortsRulepack {
    const text = extractRoutingText(input);
    if (text.includes(COUNTRYBALL_SHORTS_RULEPACK.id) || isCountryballShortsRequest(text)) {
        return COUNTRYBALL_SHORTS_RULEPACK;
    }
    if (text.includes(EDUCATION_ADMISSION_RULEPACK.id)) return EDUCATION_ADMISSION_RULEPACK;
    if (EDUCATION_ADMISSION_RULEPACK.triggerKeywords.some(keyword => text.includes(keyword))) {
        return EDUCATION_ADMISSION_RULEPACK;
    }
    return GENERAL_SHORTS_RULEPACK;
}

function extractRoutingText(input: unknown): string {
    if (typeof input === 'string') return input.toLowerCase();
    if (input == null) return '';
    if (typeof input === 'object') {
        const obj = input as Record<string, unknown>;
        const values = [
            obj['topic'],
            obj['query'],
            obj['content'],
            obj['text'],
            obj['title'],
            obj['presetId'],
            obj['contentProfileId'],
            obj['imageStyleId'],
            obj['narrativeMode'],
            obj['scenario'],
            isRecord(obj['style']) ? obj['style']['visualStyle'] : undefined,
            Array.isArray(obj['keywords']) ? obj['keywords'].join(' ') : undefined,
        ];
        return values
            .filter((value): value is string => typeof value === 'string')
            .join(' ')
            .toLowerCase();
    }
    return String(input).toLowerCase();
}

function isRecord(input: unknown): input is Record<string, unknown> {
    return input != null && typeof input === 'object' && !Array.isArray(input);
}
