import { listAvailableShortsBgmTracks } from './bgm-catalog';
import { env } from '../../../config/env';

import type { ResolvedShortsBgmTrack, ShortsBgmMood } from './bgm-catalog';

export interface ShortsBgmSelection {
    track: ResolvedShortsBgmTrack;
    volume: number;
    reason: string;
}

export function selectBgmForShorts(input: {
    metadata?: Record<string, unknown>;
    scenes?: Array<Record<string, unknown>>;
    requestText?: string;
}): ShortsBgmSelection | undefined {
    if (env.shortsBgmMode === 'off') return undefined;

    const available = listAvailableShortsBgmTracks();
    if (available.length === 0) return undefined;

    const mood = classifyBgmMood(input);
    const direct = available.find(track => track.mood === mood);
    const fallback = available.find(track => track.mood === 'neutral-documentary') ?? available[0];
    const track = direct ?? fallback;

    return {
        track,
        volume: env.shortsBgmVolume,
        reason: direct ? `matched mood ${mood}` : `no ${mood} track available; selected ${track.mood}`,
    };
}

function classifyBgmMood(input: {
    metadata?: Record<string, unknown>;
    scenes?: Array<Record<string, unknown>>;
    requestText?: string;
}): ShortsBgmMood {
    const metadataText = Object.values(input.metadata ?? {})
        .filter(value => typeof value === 'string')
        .join(' ');
    const sceneText = (input.scenes ?? [])
        .flatMap(scene => Object.values(scene))
        .filter(value => typeof value === 'string')
        .join(' ');
    const haystack = `${input.requestText ?? ''} ${metadataText} ${sceneText}`.toLowerCase();

    if (/(입시|수능|정시|수시|학생부|대학|고3|학부모|원서|내신|교육)/.test(haystack)) {
        return 'warm-storytelling';
    }
    if (/(공포|무서|귀신|괴담|호러|오싹|소름|저주|악몽|심령|괴물|좀비)/.test(haystack)) {
        return 'horror-dark';
    }
    if (/(전쟁|역사|국제|사건|충격|미스터리|군사|정치|범죄|폭로)/.test(haystack)) {
        return 'cinematic-tension';
    }
    if (/(직장|상사|심리|인간관계|연애|가스라이팅|퇴사|회사)/.test(haystack)) {
        return 'quirky-office';
    }
    if (/(ai|인공지능|개발|코딩|자동화|툴|도구|오픈소스|agent|workflow)/.test(haystack)) {
        return 'futuristic-tech';
    }
    if (/(꿀팁|방법|리뷰|제품|추천|비교|사용법|설명)/.test(haystack)) {
        return 'fast-explainer';
    }
    return 'neutral-documentary';
}
