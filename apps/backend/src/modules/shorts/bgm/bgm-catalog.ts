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
const GENERATED_SOURCE = 'project-generated procedural instrumental loop';
const GENERATED_LICENSE = 'Project-owned generated asset; safe to replace with a licensed commercial track';

export const SHORTS_BGM_CATALOG: ShortsBgmTrack[] = [
    {
        id: 'warm-storytelling-01',
        title: 'Warm Storytelling Loop',
        filename: 'warm-storytelling-loop.mp3',
        mood: 'warm-storytelling',
        tags: ['education', 'admission', 'school', 'information', 'storytelling'],
        source: GENERATED_SOURCE,
        license: GENERATED_LICENSE,
    },
    {
        id: 'cinematic-tension-01',
        title: 'Cinematic Tension Loop',
        filename: 'cinematic-tension-loop.mp3',
        mood: 'cinematic-tension',
        tags: ['news', 'history', 'war', 'incident', 'mystery', 'documentary'],
        source: GENERATED_SOURCE,
        license: GENERATED_LICENSE,
    },
    {
        id: 'fast-explainer-01',
        title: 'Fast Explainer Loop',
        filename: 'fast-explainer-loop.mp3',
        mood: 'fast-explainer',
        tags: ['tips', 'how-to', 'product', 'shorts', 'explainer'],
        source: GENERATED_SOURCE,
        license: GENERATED_LICENSE,
    },
    {
        id: 'quirky-office-01',
        title: 'Quirky Office Loop',
        filename: 'quirky-office-loop.mp3',
        mood: 'quirky-office',
        tags: ['office', 'psychology', 'relationship', 'work', 'humor'],
        source: GENERATED_SOURCE,
        license: GENERATED_LICENSE,
    },
    {
        id: 'futuristic-tech-01',
        title: 'Futuristic Tech Loop',
        filename: 'futuristic-tech-loop.mp3',
        mood: 'futuristic-tech',
        tags: ['ai', 'developer', 'automation', 'tool', 'tech'],
        source: GENERATED_SOURCE,
        license: GENERATED_LICENSE,
    },
    {
        id: 'neutral-documentary-01',
        title: 'Neutral Documentary Loop',
        filename: 'neutral-documentary-loop.mp3',
        mood: 'neutral-documentary',
        tags: ['default', 'documentary', 'information'],
        source: GENERATED_SOURCE,
        license: GENERATED_LICENSE,
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
