import { SearchOutputSchema } from './types';
import { openaiAdapter } from '../../adapters/ai/openai-adapter';
import { env } from '../../config/env';
import { log } from '../../utils/logger';

import type { BlockExecutor, BlockExecutorResult } from './types';

// ── Prompts ──────────────────────────────────────────────────────────────────

const SEARCH_SYSTEM_PROMPT = `You are a Korean source researcher for a general workflow automation engine.
Given a user topic, identify:
1. Top 5 relevant Korean keywords (단어/구문)
2. 3 recent web/news source summaries with real URLs, source names, source dates when available, and confidence
3. A trend score from 0 to 100 reflecting how trending the topic is right now

Use web search results. Do not invent articles, source names, statistics, or URLs.
Prefer primary or official sources when relevant, then reputable news, then specialist blogs or community posts with lower confidence.

Respond with JSON only — no markdown fences, no extra text:
{
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "articles": [
    { "title": "...", "url": "https://example.com/...", "source": "...", "publishedAt": "YYYY-MM-DD or null", "sourceType": "official|news|blog|other", "confidence": 0.9, "summary": "..." },
    { "title": "...", "url": "https://example.com/...", "source": "...", "publishedAt": "YYYY-MM-DD or null", "sourceType": "official|news|blog|other", "confidence": 0.8, "summary": "..." },
    { "title": "...", "url": "https://example.com/...", "source": "...", "publishedAt": "YYYY-MM-DD or null", "sourceType": "official|news|blog|other", "confidence": 0.7, "summary": "..." }
  ],
  "trendScore": 80
}`;

// ── Helper ────────────────────────────────────────────────────────────────────

/**
 * Safely extract a topic string from an unknown block input payload.
 * - null/undefined  → default "사용자 요청"
 * - string          → use directly
 * - object with keywords array → join first 3 keywords
 * - object with content/text string → use as topic
 * - anything else   → JSON stringify (truncated)
 */
export function extractTopic(input: unknown): string {
    if (input == null) return '사용자 요청';
    if (typeof input === 'string') return input.slice(0, 200);

    if (typeof input === 'object' && !Array.isArray(input)) {
        const obj = input as Record<string, unknown>;

        if (Array.isArray(obj['keywords']) && (obj['keywords'] as unknown[]).length > 0) {
            return (obj['keywords'] as unknown[])
                .slice(0, 3)
                .map(k => String(k))
                .join(', ');
        }

        if (typeof obj['content'] === 'string') return obj['content'].slice(0, 200);
        if (typeof obj['text'] === 'string') return obj['text'].slice(0, 200);
        if (typeof obj['topic'] === 'string') return obj['topic'].slice(0, 200);
        if (typeof obj['query'] === 'string') return obj['query'].slice(0, 200);

        const out = obj['out'];
        if (out && typeof out === 'object' && !Array.isArray(out)) {
            const value = (out as Record<string, unknown>)['value'];
            if (typeof value === 'string') return value.slice(0, 200);
        }
    }

    return String(JSON.stringify(input)).slice(0, 200);
}

// ── Dummy (mock mode) ─────────────────────────────────────────────────────────

function dummySearch(): BlockExecutorResult {
    const start = Date.now();
    const output = {
        keywords: ['주제', '최신', '검색', '출처', '요약'],
        articles: [
            {
                id: 'source-1',
                title: '[dummy] 최신 이슈 배경 정리',
                url: 'fake://news.example.com/article/001',
                source: '[dummy] Example News',
                publishedAt: null,
                sourceType: 'other',
                confidence: 0.5,
                summary: '사용자 요청과 관련된 최신 배경 정보를 정리했다.',
            },
            {
                id: 'source-2',
                title: '[dummy] 관련 공식 자료 확인 필요',
                url: 'fake://news.example.com/article/002',
                source: '[dummy] Official Source',
                publishedAt: null,
                sourceType: 'other',
                confidence: 0.5,
                summary: '정확한 사실 확인을 위해 공식 자료 확인이 필요하다.',
            },
            {
                id: 'source-3',
                title: '[dummy] 사용자 관심 포인트 요약',
                url: 'fake://news.example.com/article/003',
                source: '[dummy] Community Signal',
                publishedAt: null,
                sourceType: 'other',
                confidence: 0.5,
                summary: '온라인 반응에서 확인되는 관심 포인트를 요약했다.',
            },
        ],
        trendScore: 85,
        retrievedAt: new Date().toISOString(),
        presetId: 'general-shorts',
    };
    return { output, durationMs: Date.now() - start };
}

// ── Executor ──────────────────────────────────────────────────────────────────

export const searchBlock: BlockExecutor = {
    blockType: 'search',

    async execute(input: unknown, _config?: Record<string, unknown>): Promise<BlockExecutorResult> {
        const mode = env.orchestratorMode;
        if (mode === 'mock') return dummySearch();

        const start = Date.now();
        const topic = extractTopic(input);
        const primaryUrls = extractUrls(topic);

        if (primaryUrls.length > 0) {
            try {
                log.info('[search-block] Starting primary URL fetch', { urls: primaryUrls });
                const directOutput = await collectPrimaryUrls(primaryUrls, topic);
                const validated = SearchOutputSchema.safeParse(directOutput);
                if (!validated.success) {
                    throw new Error(`[search-block] URL output schema validation failed: ${validated.error.message}`);
                }
                log.info('[search-block] Primary URL fetch complete', {
                    urls: primaryUrls,
                    articles: validated.data.articles.length,
                    textLength: validated.data.articles.reduce(
                        (sum, article) => sum + String(article.fullText ?? '').length,
                        0
                    ),
                });
                return { output: validated.data as Record<string, unknown>, durationMs: Date.now() - start };
            } catch (err) {
                log.warn('[search-block] Primary URL fetch failed, falling back to web search', {
                    urls: primaryUrls,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }

        log.info('[search-block] Starting AI search', { topicLength: topic.length });

        const response = await openaiAdapter.webSearchJson({
            model: env.openaiSearchModel,
            systemPrompt: SEARCH_SYSTEM_PROMPT,
            userMessage: `오늘 날짜 기준으로 다음 주제와 관련된 근거를 찾아주세요. 주제: ${topic}`,
            maxTokens: 2048,
        });

        let parsed: unknown;
        try {
            parsed = JSON.parse(extractJson(response.content));
        } catch {
            throw new Error(`[search-block] OpenAI returned non-JSON response (length=${response.content.length})`);
        }

        const normalized = normalizeSearchOutput(parsed);
        const validated = SearchOutputSchema.safeParse(normalized);
        if (!validated.success) {
            throw new Error(`[search-block] Output schema validation failed: ${validated.error.message}`);
        }

        log.info('[search-block] AI search complete', {
            keywords: validated.data.keywords.length,
            articles: validated.data.articles.length,
            trendScore: validated.data.trendScore,
            latencyMs: response.latencyMs,
        });

        return { output: validated.data as Record<string, unknown>, durationMs: Date.now() - start };
    },
};

async function collectPrimaryUrls(urls: string[], topic: string): Promise<Record<string, unknown>> {
    const articles = [];
    for (const [index, url] of urls.slice(0, 5).entries()) {
        articles.push(await collectPrimaryUrl(url, topic, index));
    }

    const joinedText = articles
        .flatMap(article => [article.title, ...(Array.isArray(article.keyClaims) ? article.keyClaims : [])])
        .join(' ');

    return {
        collectionMode: 'url',
        primaryUrl: urls[0],
        keywords: deriveKeywords(`${topic} ${joinedText}`),
        articles,
        trendScore: undefined,
        retrievedAt: new Date().toISOString(),
    };
}

async function collectPrimaryUrl(url: string, topic: string, index: number): Promise<Record<string, unknown>> {
    const response = await fetch(url, {
        headers: {
            accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
            'user-agent': 'Mozilla/5.0 (compatible; EurekaFlowBot/1.0; +https://github.com/hansungMILK/KW-backend)',
        },
    });

    if (!response.ok) throw new Error(`URL fetch failed: ${response.status}`);

    const contentType = response.headers.get('content-type') ?? '';
    const raw = await readResponseText(response, contentType);
    const text = contentType.includes('html') ? extractReadableText(raw) : normalizeWhitespace(raw);
    if (!text) throw new Error('URL fetch returned no readable text');

    const title = extractHtmlMeta(raw, 'og:title') || extractTagText(raw, 'title') || sourceFromUrl(url);
    const publishedAt = extractHtmlMeta(raw, 'article:published_time') || extractHtmlMeta(raw, 'og:regDate') || null;
    const source = extractHtmlMeta(raw, 'og:site_name') || sourceFromUrl(url);
    const keyClaims = extractKeyClaims(text);

    return {
        id: `source-${index + 1}`,
        title,
        url,
        source,
        publishedAt,
        sourceType: normalizeSourceType(undefined, url),
        confidence: 0.98,
        summary: summarizeText(text),
        fullText: text.slice(0, 8000),
        keyClaims,
        primarySource: true,
        sourcePriority: index + 1,
    };
}

function normalizeSearchOutput(input: unknown): unknown {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
    const obj = input as Record<string, unknown>;
    const articles = Array.isArray(obj['articles']) ? obj['articles'] : [];
    return {
        ...obj,
        collectionMode:
            obj['collectionMode'] === 'url' ||
            obj['collectionMode'] === 'web_search' ||
            obj['collectionMode'] === 'url_fallback_web_search'
                ? obj['collectionMode']
                : 'web_search',
        articles: articles.map((article, index) => normalizeArticle(article, index)),
        retrievedAt: typeof obj['retrievedAt'] === 'string' ? obj['retrievedAt'] : new Date().toISOString(),
    };
}

function normalizeArticle(article: unknown, index: number): Record<string, unknown> {
    const obj =
        article && typeof article === 'object' && !Array.isArray(article) ? (article as Record<string, unknown>) : {};
    const url = typeof obj['url'] === 'string' ? obj['url'] : '';
    const sourceType = normalizeSourceType(obj['sourceType'], url);
    const confidence = typeof obj['confidence'] === 'number' ? Math.max(0, Math.min(1, obj['confidence'])) : undefined;
    return {
        ...obj,
        id: typeof obj['id'] === 'string' ? obj['id'] : `source-${index + 1}`,
        title: typeof obj['title'] === 'string' ? obj['title'] : '',
        url,
        source: typeof obj['source'] === 'string' ? obj['source'] : sourceFromUrl(url),
        publishedAt: typeof obj['publishedAt'] === 'string' || obj['publishedAt'] === null ? obj['publishedAt'] : null,
        sourceType,
        confidence: confidence ?? (sourceType === 'official' ? 0.9 : 0.65),
        fullText: typeof obj['fullText'] === 'string' ? obj['fullText'] : undefined,
        keyClaims: Array.isArray(obj['keyClaims']) ? obj['keyClaims'].map(String) : undefined,
        primarySource: typeof obj['primarySource'] === 'boolean' ? obj['primarySource'] : undefined,
        sourcePriority: typeof obj['sourcePriority'] === 'number' ? obj['sourcePriority'] : undefined,
    };
}

function normalizeSourceType(value: unknown, url: string): 'official' | 'news' | 'blog' | 'other' {
    if (value === 'official' || value === 'news' || value === 'blog' || value === 'other') return value;
    const officialDomains = ['moe.go.kr', 'adiga.kr', 'kice.re.kr', 'kcue.or.kr', 'ac.kr'];
    if (officialDomains.some(domain => url.includes(domain))) return 'official';
    if (url.includes('blog.') || url.includes('tistory.com') || url.includes('brunch.co.kr')) return 'blog';
    return 'other';
}

function sourceFromUrl(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch {
        return 'unknown';
    }
}

function extractJson(content: string): string {
    const trimmed = content.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;

    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) return trimmed.slice(start, end + 1);

    return trimmed;
}

function extractUrls(text: string): string[] {
    const matches = text.match(/https?:\/\/[^\s<>"'`]+/gi) ?? [];
    const urls: string[] = [];
    for (const match of matches) {
        const url = match.replace(/[),.;!?]+$/, '');
        if (!urls.includes(url)) urls.push(url);
    }
    return urls;
}

async function readResponseText(response: Response, contentType: string): Promise<string> {
    const bytes = await response.arrayBuffer();
    const charset = contentType.match(/charset=([^;\s]+)/i)?.[1]?.toLowerCase();
    const encodings = [charset, 'utf-8', 'euc-kr'].filter((encoding): encoding is string => Boolean(encoding));

    for (const encoding of encodings) {
        try {
            return new TextDecoder(encoding).decode(bytes);
        } catch {
            // Try the next supported encoding.
        }
    }

    return new TextDecoder().decode(bytes);
}

function extractReadableText(input: string): string {
    const article = input.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1];
    const body = article || input.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || input;
    return normalizeWhitespace(
        decodeHtmlEntities(
            body
                .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
                .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
                .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<\/(p|li|h1|h2|h3|div|section|article)>/gi, '\n')
                .replace(/<[^>]+>/g, ' ')
        )
    );
}

function extractHtmlMeta(html: string, property: string): string | null {
    const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
        new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
        new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escaped}["'][^>]*>`, 'i'),
        new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
        new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${escaped}["'][^>]*>`, 'i'),
    ];
    for (const pattern of patterns) {
        const match = html.match(pattern)?.[1];
        if (match) return decodeHtmlEntities(match).trim();
    }
    return null;
}

function extractTagText(html: string, tag: string): string | null {
    const match = html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1];
    if (!match) return null;
    return normalizeWhitespace(decodeHtmlEntities(match.replace(/<[^>]+>/g, ' ')));
}

function extractKeyClaims(text: string): string[] {
    const sentences = text
        .split(/(?<=[.!?。！？]|다\.|요\.|죠\.)\s+|\n+/)
        .map(sentence => normalizeWhitespace(sentence))
        .filter(Boolean);
    const claimLike = sentences.filter(sentence =>
        /(\d|%|원|달러|가격|요금|할인|공식|주의|조건|가능|불가|자동|예약|실행|제공)/.test(sentence)
    );
    return [...new Set(claimLike)].slice(0, 8);
}

function summarizeText(text: string): string {
    return text.slice(0, 360);
}

function deriveKeywords(text: string): string[] {
    const matches = text.match(/[A-Za-z가-힣0-9%]{2,}/g) ?? [];
    const stopwords = new Set(['https', 'http', 'www', 'com', '으로', '에서', '입니다', '합니다', '그리고']);
    const keywords: string[] = [];
    for (const match of matches) {
        const cleaned = match.trim();
        if (stopwords.has(cleaned.toLowerCase())) continue;
        if (!keywords.includes(cleaned)) keywords.push(cleaned);
        if (keywords.length >= 5) break;
    }
    return keywords.length > 0 ? keywords : ['URL', '원문', '요약'];
}

function normalizeWhitespace(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(text: string): string {
    return text
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}
