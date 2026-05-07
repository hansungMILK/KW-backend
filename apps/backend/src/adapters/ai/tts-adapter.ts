import { ensurePaidOpenAIAllowed } from './paid-openai-guard';
import { env } from '../../config/env';
import { settingsService } from '../../services/settings-service';
import { log } from '../../utils/logger';

export interface TtsRequest {
    text: string;
    voiceId?: string; // OpenAI voice name
    modelId?: string;
}

export interface TtsResult {
    audioBuffer: Buffer;
    contentType: string;
    estimatedDurationSec: number;
}

const TTS_TIMEOUT_MS = Number(process.env.OPENAI_TTS_TIMEOUT_MS || 120000);
const TTS_MAX_ATTEMPTS = Math.max(1, Number(process.env.OPENAI_TTS_MAX_ATTEMPTS || 1));

export const ttsAdapter = {
    async synthesize(request: TtsRequest): Promise<TtsResult> {
        ensurePaidOpenAIAllowed('text-to-speech');
        const apiKey = await settingsService.getKeyForProviderAsync('openai');
        if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

        const model = request.modelId || env.openaiTtsModel;
        const voice = request.voiceId || env.openaiTtsVoice;
        const input = request.text.slice(0, 4096);
        const startedAt = Date.now();

        log.info('OpenAI TTS generation', {
            model,
            voice,
            textLength: input.length,
            timeoutMs: TTS_TIMEOUT_MS,
            maxAttempts: TTS_MAX_ATTEMPTS,
        });

        const buffer = await requestOpenAITts(apiKey, model, voice, input);
        // Estimate: OpenAI Korean narration is roughly 7.5 chars/sec with the current default voice.
        const estimatedDurationSec = Math.ceil(input.length / 7.5);

        log.info('OpenAI TTS generation complete', {
            model,
            voice,
            latencyMs: Date.now() - startedAt,
            bytes: buffer.byteLength,
        });

        return { audioBuffer: buffer, contentType: 'audio/mpeg', estimatedDurationSec };
    },
};

async function requestOpenAITts(apiKey: string, model: string, voice: string, input: string): Promise<Buffer> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= TTS_MAX_ATTEMPTS; attempt += 1) {
        let shouldRetry = false;

        try {
            return await fetchOpenAITtsBuffer(apiKey, model, voice, input);
        } catch (err) {
            if (err instanceof Error && err.message.startsWith('OpenAI TTS error ')) {
                const status = Number(err.message.match(/^OpenAI TTS error (\d+):/)?.[1] ?? 0);
                if (!isRetryableStatus(status) || attempt === TTS_MAX_ATTEMPTS) throw err;

                shouldRetry = true;
                lastError = err;
                log.warn('OpenAI TTS transient error, retrying', { status, attempt, maxAttempts: TTS_MAX_ATTEMPTS });
            } else {
                lastError =
                    err instanceof Error && err.name === 'AbortError'
                        ? new Error(`OpenAI TTS timed out after ${Math.round(TTS_TIMEOUT_MS / 1000)} seconds`)
                        : err;

                if (attempt === TTS_MAX_ATTEMPTS) break;

                shouldRetry = true;
                log.warn('OpenAI TTS request failed, retrying', {
                    attempt,
                    maxAttempts: TTS_MAX_ATTEMPTS,
                    error: lastError instanceof Error ? lastError.message : String(lastError),
                });
            }
        }

        if (shouldRetry) await sleep(retryDelayMs(attempt));
    }

    if (lastError instanceof Error) throw lastError;
    throw new Error('OpenAI TTS request failed');
}

async function fetchOpenAITtsBuffer(apiKey: string, model: string, voice: string, input: string): Promise<Buffer> {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
        const timeoutPromise = new Promise<never>((_, reject) => {
            timeout = setTimeout(() => {
                controller.abort();
                reject(new Error(`OpenAI TTS timed out after ${Math.round(TTS_TIMEOUT_MS / 1000)} seconds`));
            }, TTS_TIMEOUT_MS);
        });
        const response = await Promise.race([
            fetch(`${env.openaiBaseUrl}/audio/speech`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ model, voice, input, response_format: 'mp3' }),
                signal: controller.signal,
            }),
            timeoutPromise,
        ]);
        const buffer = Buffer.from(await Promise.race([response.arrayBuffer(), timeoutPromise]));

        if (!response.ok) {
            throw new Error(`OpenAI TTS error ${response.status}: ${buffer.toString('utf8').slice(0, 200)}`);
        }

        return buffer;
    } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
            throw new Error(`OpenAI TTS timed out after ${Math.round(TTS_TIMEOUT_MS / 1000)} seconds`);
        }
        throw err;
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

function isRetryableStatus(status: number): boolean {
    return status === 408 || status === 409 || status === 429 || status >= 500;
}

function retryDelayMs(attempt: number): number {
    return attempt === 1 ? 1000 : 3000;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
