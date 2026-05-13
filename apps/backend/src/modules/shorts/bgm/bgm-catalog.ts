import { existsSync } from 'fs';
import { isAbsolute, join, resolve } from 'path';

import { env } from '../../../config/env';

export type ShortsBgmMood = 'default';

export interface ShortsBgmTrack {
    id: string;
    title: string;
    artist?: string;
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
        id: 'default-bgm',
        title: 'Glass Horizon',
        artist: 'loudsquaredance310',
        filename: 'default-bgm.mp3',
        mood: 'default',
        tags: ['default', 'shorts', 'longform', 'explainer', 'korean-video'],
        source: 'user-supplied default BGM template',
        license: 'User-supplied asset; verify project usage rights before public/commercial deployment',
        attribution: 'Glass Horizon - loudsquaredance310',
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
