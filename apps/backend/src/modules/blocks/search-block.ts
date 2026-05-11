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
        presetId: 'education-admission',
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

function normalizeSearchOutput(input: unknown): unknown {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
    const obj = input as Record<string, unknown>;
    const articles = Array.isArray(obj['articles']) ? obj['articles'] : [];
    return {
        ...obj,
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
