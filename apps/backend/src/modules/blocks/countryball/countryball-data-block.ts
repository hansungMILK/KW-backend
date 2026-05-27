import { CountryballDataOutputSchema } from '../types';
import { COUNTRYBALL_PRESET_ID } from './countryball-scene-contract';

import type { BlockExecutor, BlockExecutorResult } from '../types';
import type { CountryballCastMember, CountryballScene } from './countryball-scene-contract';

export const countryballDataBlock: BlockExecutor = {
    blockType: 'countryball-data',

    async execute(input: unknown): Promise<BlockExecutorResult> {
        const start = Date.now();
        const root = isRecord(input) ? input : {};
        const scenes = Array.isArray(root['scenes'])
            ? root['scenes'].filter(isRecord).map((scene, index) => normalizeScene(scene, index))
            : [];
        if (scenes.length === 0) {
            throw new Error('countryball-data requires countryball script scenes');
        }

        const output = {
            mode: 'countryball-data',
            presetId: COUNTRYBALL_PRESET_ID,
            normalizedScenes: scenes,
            cast: normalizeCast(root['cast']),
            metadata: {
                ...(isRecord(root['metadata']) ? root['metadata'] : {}),
                title: typeof root['title'] === 'string' ? root['title'] : undefined,
                presetId: COUNTRYBALL_PRESET_ID,
                contentProfileId: 'shorts.countryball.v1',
                narrativeMode: 'countryball-dialogue-skit',
                imageStyleId: 'countryball-comic',
            },
        };
        const validated = CountryballDataOutputSchema.safeParse(output);
        if (!validated.success) {
            throw new Error(`[countryball-data] Output schema validation failed: ${validated.error.message}`);
        }
        return { output: validated.data as Record<string, unknown>, durationMs: Date.now() - start };
    },
};

function normalizeScene(scene: Record<string, unknown>, index: number): CountryballScene {
    const sceneNumber = typeof scene['sceneNumber'] === 'number' ? scene['sceneNumber'] : index + 1;
    return {
        sceneId: text(scene['sceneId'], `scene-${String(sceneNumber).padStart(2, '0')}`),
        sceneNumber,
        timeRange: text(scene['timeRange']),
        scenePurpose: text(scene['scenePurpose'], `컨트리볼 상황극 장면 ${sceneNumber}`),
        location: text(scene['location'], '컨트리볼 상황극 무대'),
        visualTone: text(scene['visualTone'], 'comedy'),
        screenAction: text(scene['screenAction'], '국가볼들이 서로 행동하고 반응한다'),
        dialogueLines: Array.isArray(scene['dialogueLines'])
            ? scene['dialogueLines'].filter(isRecord).map(line => ({
                  country: text(line['country'], '국가볼'),
                  line: text(line['line'] ?? line['text'], '뭐야?'),
                  tone: text(line['tone'], '빠르게'),
                  voiceRole: normalizeVoiceRole(line['voiceRole']),
                  captionEmphasis: stringArray(line['captionEmphasis']),
                  pauseAfterMs: typeof line['pauseAfterMs'] === 'number' ? line['pauseAfterMs'] : undefined,
              }))
            : [],
        expressionChanges: stringArray(scene['expressionChanges']),
        sfx: stringArray(scene['sfx']),
        editBeat: text(scene['editBeat'], '빠른 컷'),
        narratorLine: normalizeNarratorLine(scene['narratorLine']),
        captionOverlay: Array.isArray(scene['captionOverlay'])
            ? scene['captionOverlay'].filter(isRecord).map(item => ({
                  type: normalizeCaptionType(item['type']),
                  text: text(item['text'], '...'),
                  speakerCountry: text(item['speakerCountry']),
                  anchorTarget: normalizeAnchor(item['anchorTarget']),
                  preferredPosition: normalizePosition(item['preferredPosition']),
                  style: normalizeStyle(item['style']),
                  emphasisWords: stringArray(item['emphasisWords']),
                  avoidZones: stringArray(item['avoidZones']),
              }))
            : [],
        props: stringArray(scene['props']),
        imagePrompt: text(scene['imagePrompt']),
        durationSec: typeof scene['durationSec'] === 'number' && scene['durationSec'] > 0 ? scene['durationSec'] : 4,
    };
}

function normalizeCast(input: unknown): CountryballCastMember[] {
    if (!Array.isArray(input)) return [];
    return input.filter(isRecord).map(item => ({
        country: text(item['country'], '국가볼'),
        role: text(item['role']),
        defaultEmotion: text(item['defaultEmotion']),
        voiceRole: normalizeVoiceRole(item['voiceRole']),
    }));
}

function normalizeNarratorLine(input: unknown): CountryballScene['narratorLine'] {
    if (typeof input === 'string') return input.trim().length <= 32 ? input.trim() : null;
    if (isRecord(input) && typeof input['text'] === 'string') {
        const value = input['text'].trim();
        return value.length <= 32 ? { text: value, voiceRole: text(input['voiceRole'], 'narrator_short') } : null;
    }
    return null;
}

function normalizeVoiceRole(input: unknown): CountryballScene['dialogueLines'][number]['voiceRole'] {
    const value = typeof input === 'string' ? input.trim() : '';
    if (
        value === 'narrator_short' ||
        value === 'main_tired' ||
        value === 'main_confident' ||
        value === 'rival_smug' ||
        value === 'rival_angry' ||
        value === 'neutral_serious' ||
        value === 'panic_high' ||
        value === 'deep_serious' ||
        value === 'old_teacher'
    ) {
        return value;
    }
    return 'main_confident';
}

function normalizeCaptionType(input: unknown): CountryballScene['captionOverlay'][number]['type'] {
    if (input === 'dialogue' || input === 'action' || input === 'reaction' || input === 'title' || input === 'ending') {
        return input;
    }
    return 'dialogue';
}

function normalizeAnchor(input: unknown): CountryballScene['captionOverlay'][number]['anchorTarget'] {
    if (input === 'speaker' || input === 'sceneCenter' || input === 'topBand' || input === 'bottomBand') return input;
    return 'speaker';
}

function normalizePosition(input: unknown): CountryballScene['captionOverlay'][number]['preferredPosition'] {
    const allowed: CountryballScene['captionOverlay'][number]['preferredPosition'][] = [
        'upper-left',
        'upper-center',
        'upper-right',
        'middle-left',
        'center',
        'middle-right',
        'lower-left',
        'lower-center',
        'lower-right',
    ];
    return allowed.includes(input as CountryballScene['captionOverlay'][number]['preferredPosition'])
        ? (input as CountryballScene['captionOverlay'][number]['preferredPosition'])
        : 'middle-right';
}

function normalizeStyle(input: unknown): CountryballScene['captionOverlay'][number]['style'] {
    if (
        input === 'whiteBlack' ||
        input === 'yellowBlack' ||
        input === 'redBlack' ||
        input === 'smallWhite' ||
        input === 'titleBand'
    ) {
        return input;
    }
    return 'yellowBlack';
}

function text(input: unknown, fallback = ''): string {
    return typeof input === 'string' && input.trim() ? input.replace(/\s+/g, ' ').trim() : fallback;
}

function stringArray(input: unknown): string[] {
    if (!Array.isArray(input)) return [];
    return input.map(item => String(item).replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function isRecord(input: unknown): input is Record<string, unknown> {
    return input != null && typeof input === 'object' && !Array.isArray(input);
}
