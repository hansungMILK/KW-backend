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

/**
 * Detect an explicit subject marker ("주제는 X", "topic: X", ...) and return the stated
 * subject X with surrounding command/format words and punctuation stripped. Returns null
 * when no marker is present or the extracted subject is empty. Deterministic (no time/randomness).
 *
 * Why: the nano decision LLM sometimes puts the OUTPUT FORMAT word ("블로그 글 생성") into
 * surfaceTerms instead of the real subject. When the user explicitly marks the subject, this
 * deterministic extractor wins over the LLM-derived surfaceTerms.
 */
export function extractStatedSubject(message: string): string | null {
    if (typeof message !== 'string') return null;
    // Markers (case-insensitive). Longest/most-specific first so e.g. "주제 :" wins over "주제".
    const marker = message.match(/(?:주제\s*[는가로]|주제\s*[:：]|주제\s*[-－]|topic\s*:|about\s*:|subject\s*:)/i);
    if (!marker || marker.index === undefined) return null;

    let subject = message.slice(marker.index + marker[0].length);

    // If the marker sits at the start of the message, a leading command may precede the subject
    // (e.g. "주제는 손흥민 ..." has none, but "블로그 써줘. 주제는 X" is handled by the slice above).
    // Strip a leading command word if it is the first token after the marker.
    subject = subject.replace(
        /^\s*(?:블로그|글|쇼츠|영상|이미지|사진)?\s*(?:써줘|써|작성해줘|작성|만들어줘|만들어|생성해줘|생성|해줘)\s+/i,
        ''
    );

    // Trim wrapping whitespace/quotes/punctuation BEFORE the trailing-command strip so a trailing
    // period does not block the end-anchored command regex.
    subject = trimWrap(subject);

    // Strip a trailing imperative command: optional format word ("블로그"/"글"/"쇼츠"/"영상"/"이미지"/"사진"),
    // optional "글", then a REQUIRED command verb (longest alternatives first). Anchored to end so a
    // subject that simply ends in "분석" (no command) is left intact.
    subject = subject.replace(
        /\s*(?:블로그|쇼츠|영상|이미지|사진)?\s*글?\s*(?:써줘|써|작성해줘|작성|만들어줘|만들어|생성해줘|생성|해줘)\s*$/i,
        ''
    );

    subject = trimWrap(subject);
    if (subject.length === 0) return null;
    return subject.slice(0, 200);
}

/** Trim surrounding whitespace, quotes, and trailing/leading punctuation. */
function trimWrap(input: string): string {
    return input
        .replace(/^[\s"'“”‘’`.,!?:：\-－]+/u, '')
        .replace(/[\s"'“”‘’`.,!?:：]+$/u, '')
        .trim();
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
