import { existsSync } from 'fs';
import { isAbsolute, join, resolve } from 'path';

import { env } from '../../../config/env';

export type ShortsBgmMood = 'default-comic';

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

export const SHORTS_BGM_CATALOG: ShortsBgmTrack[] = [
    {
        id: 'default-comic-mi-steak-loop',
        title: 'I My Mi-steak Looping',
        filename: 'default-comic-mi-steak-loop.mp3',
        mood: 'default-comic',
        tags: ['default', 'comic', 'shorts', 'explainer', 'meme', 'korean-shorts'],
        source: 'user-supplied Shorts BGM template',
        license: 'User-supplied asset; verify project usage rights before public/commercial deployment',
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
