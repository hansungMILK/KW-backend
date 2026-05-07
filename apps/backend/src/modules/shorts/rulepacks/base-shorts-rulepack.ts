export interface ShortsRulepack {
    id: 'education-admission' | 'general-shorts';
    label: string;
    triggerKeywords: string[];
    sourcePolicy: string;
    searchPrompt: string;
    contentPrompt: string;
    imagePrompt: string;
    analysisPrompt: string;
}

export const BASE_SHORTS_DEFAULTS = {
    aspectRatio: '9:16',
    durationSec: 60,
    defaultSceneCount: 12,
    minScenes: 10,
    maxScenes: 15,
    imageModel: 'gpt-image-2',
} as const;

export const BASE_SHORTS_RULES = `Base Shorts Engine Rules:
- Produce a vertical ${BASE_SHORTS_DEFAULTS.aspectRatio} short-form video plan.
- Default to ${BASE_SHORTS_DEFAULTS.defaultSceneCount} scenes and about ${BASE_SHORTS_DEFAULTS.durationSec} seconds unless the user asks otherwise.
- Keep each scene visually simple: one strong idea, one short caption, one clear image prompt.
- Keep one persistent topTitle across all scenes.
- Use the same visual grammar across topics: black top title band, bold yellow/white Korean title, comic/meme main scene, and one short central caption.
- Use [Image #1] through [Image #12] or [Image #15] slots in order.
- Use a fast opening hook, dense but accurate narration, and a short CTA.
- Preserve source references from search through content, image, analysis, and final integration output.
- Do not invent URLs, source names, publication dates, statistics, or official claims.
- When certainty is unclear, label the claim as uncertain instead of making it sound final.`;

export const GPT_IMAGE_2_KOREAN_TEXT_RULES = `GPT-image-2 Korean text rules:
- Korean text inside images is allowed.
- Keep text short and bold: one persistent top title, one central caption, and optionally one tiny source/date label.
- Avoid long sentences, dense tables, small numbers, many dates, or exact claims inside the image.
- Put exact claims, URLs, and detailed source notes in structured metadata and narration.
- Use high contrast, black stroke/shadow, and mobile-safe margins.`;

export function buildCombinedPrompt(rulepack: ShortsRulepack, section: keyof ShortsRulepack): string {
    const value = rulepack[section];
    return [BASE_SHORTS_RULES, typeof value === 'string' ? value : ''].filter(Boolean).join('\n\n');
}

export function sourceRefsToLabel(sourceRefs: unknown, sources?: unknown): string {
    if (!Array.isArray(sourceRefs) || sourceRefs.length === 0) return '';
    const first = sourceRefs[0];
    if (typeof first === 'string') {
        const source = findSource(first, sources);
        if (source) {
            const sourceName = typeof source['source'] === 'string' ? source['source'] : source['title'];
            const date = typeof source['publishedAt'] === 'string' ? source['publishedAt'] : undefined;
            return `기준: ${[sourceName, date].filter(Boolean).join(' ') || first}`.slice(0, 36);
        }
        return `기준: ${first.slice(0, 28)}`;
    }
    if (first && typeof first === 'object') {
        const obj = first as Record<string, unknown>;
        const source = typeof obj['source'] === 'string' ? obj['source'] : undefined;
        const date = typeof obj['publishedAt'] === 'string' ? obj['publishedAt'] : undefined;
        const label = [source, date].filter(Boolean).join(' ');
        return label ? `기준: ${label}`.slice(0, 36) : '';
    }
    return '';
}

function findSource(id: string, sources: unknown): Record<string, unknown> | undefined {
    if (!Array.isArray(sources)) return undefined;
    return (sources as unknown[]).find((source): source is Record<string, unknown> => {
        if (!source || typeof source !== 'object' || Array.isArray(source)) return false;
        const obj = source as Record<string, unknown>;
        return obj['id'] === id || obj['source'] === id || obj['title'] === id;
    });
}
