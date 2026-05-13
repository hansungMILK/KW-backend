import { listAvailableShortsBgmTracks } from './bgm-catalog';
import { env } from '../../../config/env';

import type { ResolvedShortsBgmTrack } from './bgm-catalog';

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
    void input;

    const available = listAvailableShortsBgmTracks();
    if (available.length === 0) return undefined;

    const track = available.find(item => item.id === 'default-bgm') ?? available[0];

    return {
        track,
        volume: env.shortsBgmVolume,
        reason: 'default BGM',
    };
}
