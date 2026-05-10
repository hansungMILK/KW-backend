import { ensurePaidOpenAIAllowed } from './paid-openai-guard';
import { env } from '../../config/env';
import { settingsService } from '../../services/settings-service';
import { log } from '../../utils/logger';

export interface OpenAIJsonRequest {
    systemPrompt: string;
    userMessage: string;
    model?: string;
    maxTokens?: number;
    maxAttempts?: number;
    signal?: AbortSignal;
    timeoutMs?: number;
}

export interface OpenAIJsonResponse {
    content: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
}

export interface OpenAIVisionJsonRequest extends OpenAIJsonRequest {
    imageUrl: string;
}

interface ChatCompletionResponse {
    model?: string;
    choices?: Array<{ message?: { content?: string } }>;
    usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
    };
    error?: { message?: string };
}

interface ResponsesApiResponse {
    model?: string;
    output_text?: string;
    output?: Array<{
        type?: string;
        content?: Array<{ type?: string; text?: string }>;
    }>;
    usage?: {
        input_tokens?: number;
        output_tokens?: number;
    };
    error?: { message?: string };
}

export const openaiAdapter = {
    async chatText(request: OpenAIJsonRequest): Promise<OpenAIJsonResponse> {
        ensurePaidOpenAIAllowed('text chat');
        const apiKey = await settingsService.getKeyForProviderAsync('openai');
        if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

        const model = request.model ?? env.openaiModel;
        const start = Date.now();

        log.info('OpenAI text chat API call', {
            model,
            maxTokens: request.maxTokens,
            systemPromptLength: request.systemPrompt.length,
            userMessageLength: request.userMessage.length,
        });

        const body = await fetchOpenAIJson<ChatCompletionResponse>(
            'OpenAI API',
            `${env.openaiBaseUrl}/chat/completions`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model,
                    messages: [
                        { role: 'system', content: request.systemPrompt },
                        { role: 'user', content: request.userMessage },
                    ],
                    max_completion_tokens: request.maxTokens ?? 512,
                }),
            },
            request.maxAttempts ?? 3,
            request.signal,
            request.timeoutMs
        );

        const content = body.choices?.[0]?.message?.content?.trim();
        if (!content) throw new Error('OpenAI returned no message content');

        const latencyMs = Date.now() - start;
        log.info('OpenAI text chat API response', {
            model: body.model ?? model,
            inputTokens: body.usage?.prompt_tokens ?? 0,
            outputTokens: body.usage?.completion_tokens ?? 0,
            latencyMs,
            contentLength: content.length,
        });

        return {
            content,
            model: body.model ?? model,
            inputTokens: body.usage?.prompt_tokens ?? 0,
            outputTokens: body.usage?.completion_tokens ?? 0,
            latencyMs,
        };
    },

    async chatJson(request: OpenAIJsonRequest): Promise<OpenAIJsonResponse> {
        ensurePaidOpenAIAllowed('JSON chat');
        const apiKey = await settingsService.getKeyForProviderAsync('openai');
        if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

        const model = request.model ?? env.openaiModel;
        const start = Date.now();

        log.info('OpenAI API call', {
            model,
            maxTokens: request.maxTokens,
            systemPromptLength: request.systemPrompt.length,
            userMessageLength: request.userMessage.length,
        });

        const body = await fetchOpenAIJson<ChatCompletionResponse>(
            'OpenAI API',
            `${env.openaiBaseUrl}/chat/completions`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model,
                    messages: [
                        { role: 'system', content: request.systemPrompt },
                        { role: 'user', content: request.userMessage },
                    ],
                    response_format: { type: 'json_object' },
                    max_completion_tokens: request.maxTokens ?? 1024,
                }),
            },
            request.maxAttempts ?? 3,
            request.signal,
            request.timeoutMs
        );

        const content = body.choices?.[0]?.message?.content;
        if (!content) throw new Error('OpenAI returned no message content');

        const latencyMs = Date.now() - start;
        log.info('OpenAI API response', {
            model: body.model ?? model,
            inputTokens: body.usage?.prompt_tokens ?? 0,
            outputTokens: body.usage?.completion_tokens ?? 0,
            latencyMs,
            contentLength: content.length,
        });

        return {
            content,
            model: body.model ?? model,
            inputTokens: body.usage?.prompt_tokens ?? 0,
            outputTokens: body.usage?.completion_tokens ?? 0,
            latencyMs,
        };
    },

    async webSearchJson(request: OpenAIJsonRequest): Promise<OpenAIJsonResponse> {
        ensurePaidOpenAIAllowed('web search');
        const apiKey = await settingsService.getKeyForProviderAsync('openai');
        if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

        const model = request.model ?? env.openaiSearchModel;
        const start = Date.now();

        log.info('OpenAI web search API call', {
            model,
            maxTokens: request.maxTokens,
            systemPromptLength: request.systemPrompt.length,
            userMessageLength: request.userMessage.length,
        });

        const body = await fetchOpenAIJson<ResponsesApiResponse>(
            'OpenAI web search API',
            `${env.openaiBaseUrl}/responses`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model,
                    tools: [{ type: 'web_search' }],
                    tool_choice: 'required',
                    input: [
                        { role: 'system', content: request.systemPrompt },
                        { role: 'user', content: request.userMessage },
                    ],
                    max_output_tokens: request.maxTokens ?? 2048,
                }),
            },
            request.maxAttempts ?? 3,
            request.signal,
            request.timeoutMs
        );

        const content = extractResponseText(body);
        if (!content) throw new Error('OpenAI web search returned no text content');

        return {
            content,
            model: body.model ?? model,
            inputTokens: body.usage?.input_tokens ?? 0,
            outputTokens: body.usage?.output_tokens ?? 0,
            latencyMs: Date.now() - start,
        };
    },

    async visionJson(request: OpenAIVisionJsonRequest): Promise<OpenAIJsonResponse> {
        ensurePaidOpenAIAllowed('vision');
        const apiKey = await settingsService.getKeyForProviderAsync('openai');
        if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

        const model = request.model ?? env.openaiVisionModel;
        const start = Date.now();

        log.info('OpenAI vision API call', {
            model,
            maxTokens: request.maxTokens,
            systemPromptLength: request.systemPrompt.length,
            userMessageLength: request.userMessage.length,
        });

        const body = await fetchOpenAIJson<ChatCompletionResponse>(
            'OpenAI vision API',
            `${env.openaiBaseUrl}/chat/completions`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model,
                    messages: [
                        { role: 'system', content: request.systemPrompt },
                        {
                            role: 'user',
                            content: [
                                { type: 'text', text: request.userMessage },
                                { type: 'image_url', image_url: { url: request.imageUrl } },
                            ],
                        },
                    ],
                    response_format: { type: 'json_object' },
                    max_completion_tokens: request.maxTokens ?? 1024,
                }),
            },
            request.maxAttempts ?? 3,
            request.signal,
            request.timeoutMs
        );

        const content = body.choices?.[0]?.message?.content;
        if (!content) throw new Error('OpenAI vision returned no message content');

        return {
            content,
            model: body.model ?? model,
            inputTokens: body.usage?.prompt_tokens ?? 0,
            outputTokens: body.usage?.completion_tokens ?? 0,
            latencyMs: Date.now() - start,
        };
    },
};

async function fetchOpenAIJson<T extends { error?: { message?: string } }>(
    label: string,
    url: string,
    init: RequestInit,
    maxAttempts = 3,
    signal?: AbortSignal,
    timeoutMs = env.openaiTextTimeoutMs
): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        throwIfAborted(signal, label);
        try {
            const response = await fetchWithTimeout(label, url, init, timeoutMs, signal);
            const body = (await response.json().catch(() => ({}))) as T;
            if (response.ok) return body;

            const message = body.error?.message ?? 'request failed';
            if (!isTransientStatus(response.status) || attempt === maxAttempts) {
                throw new Error(`${label} error ${response.status}: ${message}`);
            }

            log.warn(`${label} transient error, retrying`, { status: response.status, attempt, message });
            await sleep(retryDelayMs(attempt), signal);
        } catch (err) {
            lastError = err;
            if (err instanceof Error && err.message.startsWith(`${label} error `)) {
                throw err;
            }
            if (signal?.aborted) throw createAbortError(`${label} aborted`);
            if (attempt === maxAttempts) break;
            log.warn(`${label} request failed, retrying`, {
                attempt,
                message: err instanceof Error ? err.message : String(err),
            });
            await sleep(retryDelayMs(attempt), signal);
        }
    }

    if (lastError instanceof Error) throw lastError;
    throw new Error(`${label} request failed`);
}

async function fetchWithTimeout(
    label: string,
    url: string,
    init: RequestInit,
    timeoutMs: number,
    signal?: AbortSignal
): Promise<Response> {
    const controller = new AbortController();
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let abortListener: (() => void) | undefined;

    try {
        abortListener = () => controller.abort(signal?.reason);
        signal?.addEventListener('abort', abortListener, { once: true });
        timeout = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, timeoutMs);

        return await fetch(url, {
            ...init,
            signal: controller.signal,
        });
    } catch (err) {
        if (timedOut) {
            throw new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)} seconds`);
        }
        if (signal?.aborted) throw createAbortError(`${label} aborted`);
        throw err;
    } finally {
        if (timeout) clearTimeout(timeout);
        if (abortListener) signal?.removeEventListener('abort', abortListener);
    }
}

function isTransientStatus(status: number): boolean {
    return status === 429 || status >= 500;
}

function retryDelayMs(attempt: number): number {
    return attempt === 1 ? 750 : 2000;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(createAbortError('OpenAI request aborted'));
            return;
        }

        const onAbort = () => {
            clearTimeout(timeout);
            reject(createAbortError('OpenAI request aborted'));
        };
        const timeout = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

function throwIfAborted(signal: AbortSignal | undefined, label: string): void {
    if (signal?.aborted) throw createAbortError(`${label} aborted`);
}

function createAbortError(message: string): Error {
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
}

function extractResponseText(body: ResponsesApiResponse): string {
    if (body.output_text) return body.output_text;

    const parts: string[] = [];
    for (const item of body.output ?? []) {
        for (const content of item.content ?? []) {
            if (content.type === 'output_text' && content.text) parts.push(content.text);
        }
    }
    return parts.join('\n').trim();
}
