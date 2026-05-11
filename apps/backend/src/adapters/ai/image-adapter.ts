import { ensurePaidOpenAIAllowed } from './paid-openai-guard';
import { env } from '../../config/env';
import { GPT_IMAGE_MODEL, normalizeImageQuality } from '../../modules/image-generation/image-style';
import { settingsService } from '../../services/settings-service';
import { log } from '../../utils/logger';

export interface ImageGenerationRequest {
    prompt: string;
    width?: number;
    height?: number;
    style?: string;
    quality?: string;
    signal?: AbortSignal;
}

export interface ImageGenerationResult {
    imageBuffer?: Buffer;
    imageUrl?: string;
    contentType: string;
    width: number;
    height: number;
    model?: string;
}

const openAIImageSizeFor = (width: number, height: number): { size: string; width: number; height: number } => {
    if (width > height) return { size: '1536x1024', width: 1536, height: 1024 };
    if (height > width) return { size: '1024x1536', width: 1024, height: 1536 };
    return { size: '1024x1024', width: 1024, height: 1024 };
};

const IMAGE_TIMEOUT_MS = env.openaiImageTimeoutMs;
const IMAGE_MAX_ATTEMPTS = env.openaiImageMaxAttempts;

type OpenAIImageResponse = { data?: Array<{ b64_json?: string; url?: string }> };

export const imageAdapter = {
    async generate(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
        ensurePaidOpenAIAllowed('image generation');
        const apiKey = await settingsService.getKeyForProviderAsync('openai');
        if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

        const width = request.width || 1080;
        const height = request.height || 1920;
        const size = openAIImageSizeFor(width, height);
        const model = GPT_IMAGE_MODEL;
        const quality = normalizeImageQuality(request.quality ?? env.openaiImageQuality);

        return generateWithModel(apiKey, model, request.prompt, size, quality, request.signal);
    },
};

async function generateWithModel(
    apiKey: string,
    model: string,
    prompt: string,
    size: { size: string; width: number; height: number },
    quality: string,
    signal?: AbortSignal
): Promise<ImageGenerationResult> {
    log.info('OpenAI image generation', {
        model,
        promptLength: prompt.length,
        size: size.size,
        quality,
        timeoutMs: IMAGE_TIMEOUT_MS,
        maxAttempts: IMAGE_MAX_ATTEMPTS,
    });

    const startedAt = Date.now();
    const data = await requestOpenAIImage(apiKey, model, prompt, size, quality, signal);
    const first = data.data?.[0];
    if (!first?.b64_json && !first?.url) throw new Error('OpenAI returned no image data');

    const imageBuffer = first.b64_json ? Buffer.from(first.b64_json, 'base64') : undefined;

    log.info('OpenAI image generation complete', {
        model,
        latencyMs: Date.now() - startedAt,
        hasBuffer: Boolean(imageBuffer),
        hasUrl: Boolean(first.url),
    });

    return {
        imageBuffer,
        imageUrl: first.url,
        contentType: 'image/png',
        width: size.width,
        height: size.height,
        model,
    };
}

async function requestOpenAIImage(
    apiKey: string,
    model: string,
    prompt: string,
    size: { size: string; width: number; height: number },
    quality: string,
    signal?: AbortSignal
): Promise<{ data?: Array<{ b64_json?: string; url?: string }> }> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= IMAGE_MAX_ATTEMPTS; attempt += 1) {
        let shouldRetry = false;
        throwIfAborted(signal);

        try {
            log.info('OpenAI image API attempt', { model, attempt, maxAttempts: IMAGE_MAX_ATTEMPTS });
            return await fetchOpenAIImageData(apiKey, model, prompt, size, quality, signal);
        } catch (err) {
            if (isAbortError(err)) throw err;

            if (err instanceof Error && err.message.includes('requires OpenAI organization verification')) {
                throw err;
            }
            if (err instanceof Error && err.message.startsWith('OpenAI image API error ')) {
                const status = Number(err.message.match(/^OpenAI image API error (\d+):/)?.[1] ?? 0);
                if (!isRetryableImageStatus(status) || attempt === IMAGE_MAX_ATTEMPTS) {
                    throw err;
                }

                shouldRetry = true;
                lastError = err;
                log.warn('OpenAI image API transient error, retrying', {
                    model,
                    status,
                    attempt,
                    maxAttempts: IMAGE_MAX_ATTEMPTS,
                });
            } else {
                lastError =
                    err instanceof Error && err.name === 'AbortError'
                        ? new Error(`OpenAI image API timed out after ${Math.round(IMAGE_TIMEOUT_MS / 1000)} seconds`)
                        : err;

                if (attempt === IMAGE_MAX_ATTEMPTS) break;

                shouldRetry = true;
                log.warn('OpenAI image API request failed, retrying', {
                    model,
                    attempt,
                    maxAttempts: IMAGE_MAX_ATTEMPTS,
                    error: lastError instanceof Error ? lastError.message : String(lastError),
                });
            }
        }

        if (shouldRetry) {
            await sleep(imageRetryDelayMs(attempt), signal);
        }
    }

    if (lastError instanceof Error) throw lastError;
    throw new Error('OpenAI image API request failed');
}

async function fetchOpenAIImageData(
    apiKey: string,
    model: string,
    prompt: string,
    size: { size: string; width: number; height: number },
    quality: string,
    signal?: AbortSignal
): Promise<OpenAIImageResponse> {
    throwIfAborted(signal);

    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let abortListener: (() => void) | undefined;

    try {
        abortListener = () => controller.abort(signal?.reason);
        signal?.addEventListener('abort', abortListener, { once: true });

        const timeoutPromise = new Promise<never>((_, reject) => {
            timeout = setTimeout(() => {
                const timeoutError = new Error(
                    `OpenAI image API timed out after ${Math.round(IMAGE_TIMEOUT_MS / 1000)} seconds`
                );
                timeoutError.name = 'TimeoutError';
                controller.abort(timeoutError);
                reject(timeoutError);
            }, IMAGE_TIMEOUT_MS);
        });

        const requestPromise = (async () => {
            const response = await fetch(`${env.openaiBaseUrl}/images/generations`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model,
                    prompt,
                    n: 1,
                    size: size.size,
                    quality,
                    output_format: 'png',
                }),
                signal: controller.signal,
            });
            const text = await response.text();

            return { response, text };
        })();
        void requestPromise.catch(() => {
            /* timeout/cancel path already reports the primary error */
        });

        const { response, text } = await Promise.race([requestPromise, timeoutPromise]);

        if (!response.ok) {
            if (response.status === 403 && /verified|verification|organization/i.test(text)) {
                throw new Error(
                    `OpenAI image API error 403: ${model} requires OpenAI organization verification. Verify the organization at https://platform.openai.com/settings/organization/general, then rerun. Raw: ${text.slice(0, 180)}`
                );
            }

            throw new Error(`OpenAI image API error ${response.status}: ${text.slice(0, 260)}`);
        }

        try {
            return JSON.parse(text) as OpenAIImageResponse;
        } catch (err) {
            throw new Error(
                `OpenAI image API returned invalid JSON: ${err instanceof Error ? err.message : String(err)}`
            );
        }
    } catch (err) {
        if (signal?.aborted) throw createAbortError(abortMessageFromSignal(signal));
        if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
            throw new Error(`OpenAI image API timed out after ${Math.round(IMAGE_TIMEOUT_MS / 1000)} seconds`);
        }
        throw err;
    } finally {
        if (timeout) clearTimeout(timeout);
        if (abortListener) signal?.removeEventListener('abort', abortListener);
    }
}

function isRetryableImageStatus(status: number): boolean {
    return status === 408 || status === 409 || status === 429 || status >= 500;
}

function imageRetryDelayMs(attempt: number): number {
    return attempt === 1 ? 1000 : 3000;
}

function isAbortError(err: unknown): boolean {
    return err instanceof Error && err.name === 'AbortError';
}

function createAbortError(message: string): Error {
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw createAbortError(abortMessageFromSignal(signal));
}

function abortMessageFromSignal(signal?: AbortSignal): string {
    const reason = signal?.reason;
    if (reason instanceof Error) return reason.message;
    if (typeof reason === 'string' && reason) return reason;
    return 'OpenAI image API request aborted';
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(createAbortError(abortMessageFromSignal(signal)));
            return;
        }

        const timeout = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);

        const onAbort = () => {
            clearTimeout(timeout);
            reject(createAbortError(abortMessageFromSignal(signal)));
        };

        signal?.addEventListener('abort', onAbort, { once: true });
    });
}
