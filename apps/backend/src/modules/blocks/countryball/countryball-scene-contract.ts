export const COUNTRYBALL_NARRATIVE_MODE = 'countryball-dialogue-skit' as const;
export const COUNTRYBALL_PRESET_ID = 'countryball-shorts' as const;

export type CountryballVoiceRole =
    | 'narrator_short'
    | 'main_tired'
    | 'main_confident'
    | 'rival_smug'
    | 'rival_angry'
    | 'neutral_serious'
    | 'panic_high'
    | 'deep_serious'
    | 'old_teacher';

export type CountryballCaptionOverlay = {
    type: 'dialogue' | 'action' | 'reaction' | 'title' | 'ending';
    text: string;
    speakerCountry?: string;
    anchorTarget: 'speaker' | 'sceneCenter' | 'topBand' | 'bottomBand';
    preferredPosition:
        | 'upper-left'
        | 'upper-center'
        | 'upper-right'
        | 'middle-left'
        | 'center'
        | 'middle-right'
        | 'lower-left'
        | 'lower-center'
        | 'lower-right';
    style: 'whiteBlack' | 'yellowBlack' | 'redBlack' | 'smallWhite' | 'titleBand';
    emphasisWords?: string[];
    avoidZones?: string[];
};

export type CountryballDialogueLine = {
    country: string;
    line: string;
    tone?: string;
    voiceRole: CountryballVoiceRole;
    captionEmphasis?: string[];
    pauseAfterMs?: number;
};

export type CountryballCastMember = {
    country: string;
    role?: string;
    defaultEmotion?: string;
    voiceRole?: CountryballVoiceRole;
};

export type CountryballScene = {
    sceneId: string;
    sceneNumber?: number;
    timeRange?: string;
    scenePurpose: string;
    location: string;
    visualTone: string;
    screenAction: string;
    dialogueLines: CountryballDialogueLine[];
    expressionChanges: string[];
    sfx: string[];
    editBeat: string;
    narratorLine?: string | { text: string; voiceRole?: string } | null;
    captionOverlay: CountryballCaptionOverlay[];
    props?: string[];
    imagePrompt?: string;
    durationSec?: number;
};

export const COUNTRYBALL_ROLE_VOICE_FALLBACKS: CountryballVoiceRole[] = [
    'main_confident',
    'rival_smug',
    'panic_high',
    'neutral_serious',
    'deep_serious',
    'main_tired',
];

export function normalizeCountryballVoiceRole(input: unknown, fallback: CountryballVoiceRole): CountryballVoiceRole {
    if (typeof input !== 'string') return fallback;
    const normalized = input.trim().toLowerCase().replace(/-/g, '_');
    if (isCountryballVoiceRole(normalized)) return normalized;
    if (normalized === 'narrator' || normalized === 'narrator_short') return 'narrator_short';
    if (normalized === 'main') return 'main_confident';
    if (normalized === 'rival') return 'rival_smug';
    if (normalized === 'panic') return 'panic_high';
    return fallback;
}

export function isCountryballVoiceRole(value: string): value is CountryballVoiceRole {
    return (
        value === 'narrator_short' ||
        value === 'main_tired' ||
        value === 'main_confident' ||
        value === 'rival_smug' ||
        value === 'rival_angry' ||
        value === 'neutral_serious' ||
        value === 'panic_high' ||
        value === 'deep_serious' ||
        value === 'old_teacher'
    );
}

export function compactCountryballText(value: unknown, fallback = ''): string {
    if (typeof value !== 'string') return fallback;
    return value.replace(/\s+/g, ' ').trim() || fallback;
}
