/**
 * Shared deterministic helpers for blog v2 blocks.
 * No randomness, no current-time reads (durationMs in the executor is the only Date.now use).
 */

export function isRecord(input: unknown): input is Record<string, unknown> {
    return input != null && typeof input === 'object' && !Array.isArray(input);
}

export function text(input: unknown, fallback = ''): string {
    return typeof input === 'string' ? input.replace(/\s+/g, ' ').trim() || fallback : fallback;
}

export function stringArray(input: unknown): string[] {
    if (!Array.isArray(input)) return [];
    return input.map(item => (typeof item === 'string' ? item.trim() : '')).filter(item => item.length > 0);
}

/** Extract the user's blog topic from upstream input or config. */
export function extractTopic(input: unknown, config?: Record<string, unknown>): string {
    const fromConfig = config ? text(config['topic'], text(config['requestTopic'], text(config['userRequest']))) : '';
    if (fromConfig) return fromConfig.slice(0, 500);
    if (typeof input === 'string') return input.slice(0, 500);
    if (!isRecord(input)) return '블로그 글';
    return text(input['requestTopic'], text(input['topic'], text(input['userRequest'], '블로그 글'))).slice(0, 500);
}

/** Tolerant JSON parse: raw, fenced, then first balanced object. */
export function parseJsonLike(content: string): unknown | null {
    const trimmed = content.trim();
    try {
        return JSON.parse(trimmed);
    } catch {
        const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
        if (fenced) {
            try {
                return JSON.parse(fenced.trim());
            } catch {
                /* fall through */
            }
        }
        const candidate = extractFirstJsonObjectText(trimmed);
        if (candidate) {
            try {
                return JSON.parse(candidate);
            } catch {
                return null;
            }
        }
        return null;
    }
}

function extractFirstJsonObjectText(content: string): string | null {
    let start = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = 0; index < content.length; index += 1) {
        const char = content[index];
        if (start < 0) {
            if (char === '{') {
                start = index;
                depth = 1;
            }
            continue;
        }
        if (escaped) {
            escaped = false;
            continue;
        }
        if (char === '\\') {
            escaped = inString;
            continue;
        }
        if (char === '"') {
            inString = !inString;
            continue;
        }
        if (inString) continue;
        if (char === '{') depth += 1;
        if (char === '}') {
            depth -= 1;
            if (depth === 0) return content.slice(start, index + 1);
        }
    }
    return null;
}

/** Stable slug for section ids (deterministic; falls back to index when empty). */
export function slugify(input: string, index: number): string {
    const base = input
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
    return base.length > 0 ? `h2-${index + 1}-${base}` : `h2-${index + 1}`;
}
