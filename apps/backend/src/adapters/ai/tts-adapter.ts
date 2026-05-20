import { spawnSync } from 'child_process';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { env } from '../../config/env';
import { getProviderApiKey } from '../../services/credential-resolver';
import { log } from '../../utils/logger';

export interface TtsRequest {
    text: string;
    voiceId?: string;
    modelId?: string;
    signal?: AbortSignal;
}

export interface TtsResult {
    audioBuffer: Buffer;
    contentType: string;
    estimatedDurationSec: number;
    provider: 'elevenlabs' | 'openai';
    model: string;
    voiceId: string;
}

const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1';
const OPENAI_TTS_PATH = '/audio/speech';
const FFPROBE_PATH =
    process.env.FFPROBE_PATH ||
    (process.env.FFMPEG_PATH && process.env.FFMPEG_PATH.endsWith('ffmpeg')
        ? process.env.FFMPEG_PATH.replace(/ffmpeg$/, 'ffprobe')
        : 'ffprobe');

export const ttsAdapter = {
    async synthesize(request: TtsRequest): Promise<TtsResult> {
        const elevenLabsKey = await getProviderApiKey('elevenlabs');
        if (elevenLabsKey) return synthesizeWithElevenLabs(elevenLabsKey, request);

        const openAiKey = await getProviderApiKey('openai');
        if (openAiKey) return synthesizeWithOpenAi(openAiKey, request);

        throw new Error('Provider credential not configured: elevenlabs or openai');
    },
};

async function synthesizeWithElevenLabs(apiKey: string, request: TtsRequest): Promise<TtsResult> {
    const model = request.modelId || env.elevenLabsTtsModel;
    const voice = request.voiceId || env.elevenLabsTtsVoiceId;
    const input = request.text.slice(0, 4096);
    const startedAt = Date.now();

    log.info('ElevenLabs TTS generation', {
        model,
        voice,
        textLength: input.length,
        timeoutMs: env.elevenLabsTtsTimeoutMs,
        maxAttempts: env.elevenLabsTtsMaxAttempts,
    });

    const buffer = await requestElevenLabsTts(apiKey, model, voice, input, request.signal);
    const measuredDurationSec = await probeAudioDurationSec(buffer);
    // Fallback estimate: Korean narration is roughly 7.5 chars/sec with the current default voice.
    const estimatedDurationSec = measuredDurationSec ?? Math.ceil(input.length / 7.5);

    log.info('ElevenLabs TTS generation complete', {
        model,
        voice,
        latencyMs: Date.now() - startedAt,
        bytes: buffer.byteLength,
        measuredDurationSec,
        durationSec: estimatedDurationSec,
    });

    return {
        audioBuffer: buffer,
        contentType: 'audio/mpeg',
        estimatedDurationSec,
        provider: 'elevenlabs',
        model,
        voiceId: voice,
    };
}

async function synthesizeWithOpenAi(apiKey: string, request: TtsRequest): Promise<TtsResult> {
    const model = request.modelId || env.openaiTtsModel;
    const voice = request.voiceId || env.openaiTtsVoice;
    const input = request.text.slice(0, 4096);
    const startedAt = Date.now();

    log.info('OpenAI TTS generation', {
        model,
        voice,
        textLength: input.length,
        timeoutMs: env.openaiTtsTimeoutMs,
        maxAttempts: env.openaiTtsMaxAttempts,
    });

    const buffer = await requestOpenAiTts(apiKey, model, voice, input, request.signal);
    const measuredDurationSec = await probeAudioDurationSec(buffer);
    const estimatedDurationSec = measuredDurationSec ?? Math.ceil(input.length / 7.5);

    log.info('OpenAI TTS generation complete', {
        model,
        voice,
        latencyMs: Date.now() - startedAt,
        bytes: buffer.byteLength,
        measuredDurationSec,
        durationSec: estimatedDurationSec,
    });

    return {
        audioBuffer: buffer,
        contentType: 'audio/mpeg',
        estimatedDurationSec,
        provider: 'openai',
        model,
        voiceId: voice,
    };
}

async function requestElevenLabsTts(
    apiKey: string,
    model: string,
    voice: string,
    input: string,
    signal?: AbortSignal
): Promise<Buffer> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= env.elevenLabsTtsMaxAttempts; attempt += 1) {
        let shouldRetry = false;
        throwIfAborted(signal);

        try {
            return await fetchElevenLabsTtsBuffer(apiKey, model, voice, input, signal);
        } catch (err) {
            if (isAbortError(err)) throw err;

            if (err instanceof Error && err.message.startsWith('ElevenLabs TTS error ')) {
                const status = Number(err.message.match(/^ElevenLabs TTS error (\d+):/)?.[1] ?? 0);
                if (!isRetryableStatus(status) || attempt === env.elevenLabsTtsMaxAttempts) throw err;

                shouldRetry = true;
                lastError = err;
                log.warn('ElevenLabs TTS transient error, retrying', {
                    status,
                    attempt,
                    maxAttempts: env.elevenLabsTtsMaxAttempts,
                });
            } else {
                lastError =
                    err instanceof Error && err.name === 'AbortError'
                        ? new Error(
                              `ElevenLabs TTS timed out after ${Math.round(env.elevenLabsTtsTimeoutMs / 1000)} seconds`
                          )
                        : err;

                if (attempt === env.elevenLabsTtsMaxAttempts) break;

                shouldRetry = true;
                log.warn('ElevenLabs TTS request failed, retrying', {
                    attempt,
                    maxAttempts: env.elevenLabsTtsMaxAttempts,
                    error: lastError instanceof Error ? lastError.message : String(lastError),
                });
            }
        }

        if (shouldRetry) await sleep(retryDelayMs(attempt), signal);
    }

    if (lastError instanceof Error) throw lastError;
    throw new Error('ElevenLabs TTS request failed');
}

async function probeAudioDurationSec(buffer: Buffer): Promise<number | undefined> {
    const workDir = await mkdtemp(join(tmpdir(), 'eureka-tts-probe-'));
    const audioPath = join(workDir, 'speech.mp3');

    try {
        await writeFile(audioPath, buffer);
        const result = spawnSync(
            FFPROBE_PATH,
            ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', audioPath],
            { encoding: 'utf8', timeout: 5000 }
        );
        if (result.error || result.status !== 0) return undefined;

        const durationSec = Number.parseFloat(result.stdout.trim());
        return Number.isFinite(durationSec) && durationSec > 0 ? roundToMillis(durationSec) : undefined;
    } catch {
        return undefined;
    } finally {
        await rm(workDir, { recursive: true, force: true });
    }
}

function roundToMillis(value: number): number {
    return Math.round(value * 1000) / 1000;
}

async function fetchElevenLabsTtsBuffer(
    apiKey: string,
    model: string,
    voice: string,
    input: string,
    signal?: AbortSignal
): Promise<Buffer> {
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
                    `ElevenLabs TTS timed out after ${Math.round(env.elevenLabsTtsTimeoutMs / 1000)} seconds`
                );
                timeoutError.name = 'TimeoutError';
                controller.abort(timeoutError);
                reject(timeoutError);
            }, env.elevenLabsTtsTimeoutMs);
        });

        const requestPromise = fetch(
            `${ELEVENLABS_BASE_URL}/text-to-speech/${encodeURIComponent(voice)}?output_format=${encodeURIComponent(
                env.elevenLabsTtsOutputFormat
            )}`,
            {
                method: 'POST',
                headers: {
                    'xi-api-key': apiKey,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    text: input,
                    model_id: model,
                    language_code: 'ko',
                    voice_settings: {
                        stability: 0.55,
                        similarity_boost: 0.75,
                        style: 0.15,
                        use_speaker_boost: true,
                    },
                }),
                signal: controller.signal,
            }
        );
        void requestPromise.catch(() => {
            /* timeout/cancel path already reports the primary error */
        });

        const response = await Promise.race([requestPromise, timeoutPromise]);
        const audioPromise = response.arrayBuffer();
        void audioPromise.catch(() => {
            /* timeout/cancel path already reports the primary error */
        });
        const buffer = Buffer.from(await Promise.race([audioPromise, timeoutPromise]));

        if (!response.ok) {
            throw new Error(`ElevenLabs TTS error ${response.status}: ${buffer.toString('utf8').slice(0, 200)}`);
        }

        return buffer;
    } catch (err) {
        if (signal?.aborted) throw createAbortError(abortMessageFromSignal(signal));
        if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
            throw new Error(`ElevenLabs TTS timed out after ${Math.round(env.elevenLabsTtsTimeoutMs / 1000)} seconds`);
        }
        throw err;
    } finally {
        if (timeout) clearTimeout(timeout);
        if (abortListener) signal?.removeEventListener('abort', abortListener);
    }
}

async function requestOpenAiTts(
    apiKey: string,
    model: string,
    voice: string,
    input: string,
    signal?: AbortSignal
): Promise<Buffer> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= env.openaiTtsMaxAttempts; attempt += 1) {
        throwIfAborted(signal);

        try {
            return await fetchOpenAiTtsBuffer(apiKey, model, voice, input, signal);
        } catch (err) {
            if (isAbortError(err)) throw err;

            if (err instanceof Error && err.message.startsWith('OpenAI TTS error ')) {
                const status = Number(err.message.match(/^OpenAI TTS error (\d+):/)?.[1] ?? 0);
                if (!isRetryableStatus(status) || attempt === env.openaiTtsMaxAttempts) throw err;

                lastError = err;
                log.warn('OpenAI TTS transient error, retrying', {
                    status,
                    attempt,
                    maxAttempts: env.openaiTtsMaxAttempts,
                });
            } else {
                lastError =
                    err instanceof Error && err.name === 'AbortError'
                        ? new Error(`OpenAI TTS timed out after ${Math.round(env.openaiTtsTimeoutMs / 1000)} seconds`)
                        : err;

                if (attempt === env.openaiTtsMaxAttempts) break;

                log.warn('OpenAI TTS request failed, retrying', {
                    attempt,
                    maxAttempts: env.openaiTtsMaxAttempts,
                    error: lastError instanceof Error ? lastError.message : String(lastError),
                });
            }

            await sleep(retryDelayMs(attempt), signal);
        }
    }

    if (lastError instanceof Error) throw lastError;
    throw new Error('OpenAI TTS request failed');
}

async function fetchOpenAiTtsBuffer(
    apiKey: string,
    model: string,
    voice: string,
    input: string,
    signal?: AbortSignal
): Promise<Buffer> {
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
                    `OpenAI TTS timed out after ${Math.round(env.openaiTtsTimeoutMs / 1000)} seconds`
                );
                timeoutError.name = 'TimeoutError';
                controller.abort(timeoutError);
                reject(timeoutError);
            }, env.openaiTtsTimeoutMs);
        });

        const requestPromise = fetch(`${env.openaiBaseUrl}${OPENAI_TTS_PATH}`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model,
                voice,
                input,
                response_format: 'mp3',
            }),
            signal: controller.signal,
        });
        void requestPromise.catch(() => {
            /* timeout/cancel path already reports the primary error */
        });

        const response = await Promise.race([requestPromise, timeoutPromise]);
        const audioPromise = response.arrayBuffer();
        void audioPromise.catch(() => {
            /* timeout/cancel path already reports the primary error */
        });
        const buffer = Buffer.from(await Promise.race([audioPromise, timeoutPromise]));

        if (!response.ok) {
            throw new Error(`OpenAI TTS error ${response.status}: ${buffer.toString('utf8').slice(0, 200)}`);
        }

        return buffer;
    } catch (err) {
        if (signal?.aborted) throw createAbortError(abortMessageFromSignal(signal));
        if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
            throw new Error(`OpenAI TTS timed out after ${Math.round(env.openaiTtsTimeoutMs / 1000)} seconds`);
        }
        throw err;
    } finally {
        if (timeout) clearTimeout(timeout);
        if (abortListener) signal?.removeEventListener('abort', abortListener);
    }
}

function isRetryableStatus(status: number): boolean {
    return status === 408 || status === 409 || status === 429 || status >= 500;
}

function retryDelayMs(attempt: number): number {
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
    return 'TTS request aborted';
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
