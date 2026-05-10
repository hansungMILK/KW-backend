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
    fallbackFilename?: string;
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
const YOUTUBE_AUDIO_LIBRARY_SOURCE = 'YouTube Studio Audio Library';
const YOUTUBE_AUDIO_LIBRARY_LICENSE =
    'YouTube Audio Library standard license candidate; verify in YouTube Studio before committing the MP3';
const SUNO_TEMPLATE_SOURCE = 'project-supplied Suno-generated instrumental template';
const SUNO_TEMPLATE_LICENSE =
    'Project-owned Suno-generated asset; use only if generated under a plan that grants commercial rights';

export const SHORTS_BGM_CATALOG: ShortsBgmTrack[] = [
    {
        id: 'ytal-warm-education-01',
        title: 'Lovely Afternoon Breeze',
        filename: 'ytal-warm-education-lovely-afternoon-breeze.mp3',
        mood: 'warm-storytelling',
        tags: ['education', 'admission', 'school', 'information', 'storytelling'],
        source: YOUTUBE_AUDIO_LIBRARY_SOURCE,
        license: YOUTUBE_AUDIO_LIBRARY_LICENSE,
        attribution: 'The 126ers',
    },
    {
        id: 'ytal-cinematic-tension-01',
        title: 'Dark Toys',
        filename: 'ytal-cinematic-tension-dark-toys.mp3',
        mood: 'cinematic-tension',
        tags: ['news', 'history', 'war', 'incident', 'mystery', 'documentary'],
        source: YOUTUBE_AUDIO_LIBRARY_SOURCE,
        license: YOUTUBE_AUDIO_LIBRARY_LICENSE,
        attribution: 'SYBS',
    },
    {
        id: 'ytal-fast-explainer-01',
        title: 'ROUSE',
        filename: 'ytal-fast-explainer-rouse.mp3',
        mood: 'fast-explainer',
        tags: ['tips', 'how-to', 'product', 'shorts', 'explainer'],
        source: YOUTUBE_AUDIO_LIBRARY_SOURCE,
        license: YOUTUBE_AUDIO_LIBRARY_LICENSE,
        attribution: 'Density & Time',
    },
    {
        id: 'ytal-quirky-office-01',
        title: 'Funhouse',
        filename: 'ytal-quirky-office-funhouse.mp3',
        mood: 'quirky-office',
        tags: ['office', 'psychology', 'relationship', 'work', 'humor'],
        source: YOUTUBE_AUDIO_LIBRARY_SOURCE,
        license: YOUTUBE_AUDIO_LIBRARY_LICENSE,
        attribution: 'Bad Snacks',
    },
    {
        id: 'ytal-futuristic-tech-01',
        title: 'After All',
        filename: 'ytal-futuristic-tech-after-all.mp3',
        mood: 'futuristic-tech',
        tags: ['ai', 'developer', 'automation', 'tool', 'tech'],
        source: YOUTUBE_AUDIO_LIBRARY_SOURCE,
        license: YOUTUBE_AUDIO_LIBRARY_LICENSE,
        attribution: 'Geographer',
    },
    {
        id: 'warm-education-suno-01',
        title: 'Warm Education Suno Template',
        filename: 'warm-education-suno.mp3',
        fallbackFilename: 'warm-storytelling-loop.mp3',
        mood: 'warm-storytelling',
        tags: ['education', 'admission', 'school', 'information', 'storytelling'],
        source: SUNO_TEMPLATE_SOURCE,
        license: SUNO_TEMPLATE_LICENSE,
    },
    {
        id: 'cinematic-tension-suno-01',
        title: 'Cinematic Tension Suno Template',
        filename: 'cinematic-tension-suno.mp3',
        fallbackFilename: 'cinematic-tension-loop.mp3',
        mood: 'cinematic-tension',
        tags: ['news', 'history', 'war', 'incident', 'mystery', 'documentary'],
        source: SUNO_TEMPLATE_SOURCE,
        license: SUNO_TEMPLATE_LICENSE,
    },
    {
        id: 'fast-explainer-suno-01',
        title: 'Fast Explainer Suno Template',
        filename: 'fast-explainer-suno.mp3',
        fallbackFilename: 'fast-explainer-loop.mp3',
        mood: 'fast-explainer',
        tags: ['tips', 'how-to', 'product', 'shorts', 'explainer'],
        source: SUNO_TEMPLATE_SOURCE,
        license: SUNO_TEMPLATE_LICENSE,
    },
    {
        id: 'quirky-office-suno-01',
        title: 'Quirky Office Suno Template',
        filename: 'quirky-office-suno.mp3',
        fallbackFilename: 'quirky-office-loop.mp3',
        mood: 'quirky-office',
        tags: ['office', 'psychology', 'relationship', 'work', 'humor'],
        source: SUNO_TEMPLATE_SOURCE,
        license: SUNO_TEMPLATE_LICENSE,
    },
    {
        id: 'futuristic-tech-suno-01',
        title: 'Futuristic Tech Suno Template',
        filename: 'futuristic-tech-suno.mp3',
        fallbackFilename: 'futuristic-tech-loop.mp3',
        mood: 'futuristic-tech',
        tags: ['ai', 'developer', 'automation', 'tool', 'tech'],
        source: SUNO_TEMPLATE_SOURCE,
        license: SUNO_TEMPLATE_LICENSE,
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
    const primaryPath = resolveTrackPath(track.filename);
    if (existsSync(primaryPath)) return { ...track, filePath: primaryPath };

    if (track.fallbackFilename) {
        const fallbackPath = resolveTrackPath(track.fallbackFilename);
        if (existsSync(fallbackPath)) {
            return {
                ...track,
                title: `${track.title} (Fallback Loop)`,
                filename: track.fallbackFilename,
                source: GENERATED_SOURCE,
                license: GENERATED_LICENSE,
                filePath: fallbackPath,
            };
        }
    }

    return undefined;
}

function resolveTrackPath(filename: string): string {
    return isAbsolute(filename) ? filename : resolve(join(ASSET_DIR, filename));
}

export function listAvailableShortsBgmTracks(): ResolvedShortsBgmTrack[] {
    return SHORTS_BGM_CATALOG.map(resolveShortsBgmTrack).filter((track): track is ResolvedShortsBgmTrack =>
        Boolean(track)
    );
}
