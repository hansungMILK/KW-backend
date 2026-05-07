import { existsSync } from 'fs';
import { isAbsolute, join, resolve } from 'path';

import { env } from '../../../config/env';

export type ShortsBgmMood =
    | 'cinematic-tension'
    | 'fast-explainer'
    | 'warm-storytelling'
    | 'quirky-office'
    | 'futuristic-tech'
    | 'neutral-documentary';

export interface ShortsBgmTrack {
    id: string;
    title: string;
    filename: string;
    mood: ShortsBgmMood;
    tags: string[];
    source: string;
    license: string;
    attribution?: string;
}

export interface ResolvedShortsBgmTrack extends ShortsBgmTrack {
    filePath: string;
}

const ASSET_DIR = env.shortsBgmAssetsDir;

export const SHORTS_BGM_CATALOG: ShortsBgmTrack[] = [
    {
        id: 'warm-storytelling-01',
        title: 'Warm Storytelling Loop',
        filename: 'warm-storytelling-loop.mp3',
        mood: 'warm-storytelling',
        tags: ['education', 'admission', 'school', 'information', 'storytelling'],
        source: 'user-provided licensed asset',
        license: 'Must be royalty-free or directly licensed before use',
    },
    {
        id: 'cinematic-tension-01',
        title: 'Cinematic Tension Loop',
        filename: 'cinematic-tension-loop.mp3',
        mood: 'cinematic-tension',
        tags: ['news', 'history', 'war', 'incident', 'mystery', 'documentary'],
        source: 'user-provided licensed asset',
        license: 'Must be royalty-free or directly licensed before use',
    },
    {
        id: 'fast-explainer-01',
        title: 'Fast Explainer Loop',
        filename: 'fast-explainer-loop.mp3',
        mood: 'fast-explainer',
        tags: ['tips', 'how-to', 'product', 'shorts', 'explainer'],
        source: 'user-provided licensed asset',
        license: 'Must be royalty-free or directly licensed before use',
    },
    {
        id: 'quirky-office-01',
        title: 'Quirky Office Loop',
        filename: 'quirky-office-loop.mp3',
        mood: 'quirky-office',
        tags: ['office', 'psychology', 'relationship', 'work', 'humor'],
        source: 'user-provided licensed asset',
        license: 'Must be royalty-free or directly licensed before use',
    },
    {
        id: 'futuristic-tech-01',
        title: 'Futuristic Tech Loop',
        filename: 'futuristic-tech-loop.mp3',
        mood: 'futuristic-tech',
        tags: ['ai', 'developer', 'automation', 'tool', 'tech'],
        source: 'user-provided licensed asset',
        license: 'Must be royalty-free or directly licensed before use',
    },
    {
        id: 'neutral-documentary-01',
        title: 'Neutral Documentary Loop',
        filename: 'neutral-documentary-loop.mp3',
        mood: 'neutral-documentary',
        tags: ['default', 'documentary', 'information'],
        source: 'user-provided licensed asset',
        license: 'Must be royalty-free or directly licensed before use',
    },
];

export function resolveShortsBgmTrack(track: ShortsBgmTrack): ResolvedShortsBgmTrack | undefined {
    const filePath = isAbsolute(track.filename) ? track.filename : resolve(join(ASSET_DIR, track.filename));
    if (!existsSync(filePath)) return undefined;
    return { ...track, filePath };
}

export function listAvailableShortsBgmTracks(): ResolvedShortsBgmTrack[] {
    return SHORTS_BGM_CATALOG.map(resolveShortsBgmTrack).filter((track): track is ResolvedShortsBgmTrack =>
        Boolean(track)
    );
}
