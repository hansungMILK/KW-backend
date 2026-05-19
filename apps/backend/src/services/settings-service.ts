import { API_KEY_PROVIDERS } from '@flows/contracts';

import { getProviderApiKey } from './credential-resolver';
import { PAID_OPENAI_DISABLED, isPaidOpenAIAllowed } from '../adapters/ai/paid-openai-guard';
import { env } from '../config/env';
import { settingsRepo } from '../repositories/settings-repository';
import { log } from '../utils/logger';

import type { ApiKeyInfo, ApiKeyProvider, ApiKeyVerifyResponse } from '@flows/contracts';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Mask an API key for safe display.
 * - Keys >= 10 chars: show first 4 + mask middle + last 4 (e.g. sk-a****7f3a)
 * - Keys < 10 chars:  show first 2 + ****
 */
export const maskKey = (raw: string): string => {
    if (raw.length >= 10) {
        const first = raw.slice(0, 4);
        const last = raw.slice(-4);
        return `${first}****${last}`;
    }
    const first = raw.slice(0, 2);
    return `${first}****`;
};

const getRawKey = (provider: ApiKeyProvider): string | null => {
    if (!settingsRepo.isSyncReadAvailable) return null;

    // Sync reads are local-only. User execution must never fall back to env provider keys.
    const decrypted = settingsRepo.getDecryptedKey(provider);
    return decrypted || null;
};

const getRawKeyAsync = async (provider: ApiKeyProvider): Promise<string | null> => {
    return await getProviderApiKey(provider);
};

// ============================================================================
// Verify helpers (real HTTP calls, 5s timeout)
// ============================================================================

const withTimeout = (ms: number): AbortSignal => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
};

const verifyAnthropic = async (key: string): Promise<{ valid: boolean; message?: string }> => {
    try {
        const signal = withTimeout(5000);
        const res = await fetch('https://api.anthropic.com/v1/models', {
            headers: {
                'x-api-key': key,
                'anthropic-version': '2023-06-01',
            },
            signal,
        });
        if (res.ok) return { valid: true };
        const body = await res.json().catch(() => ({}));
        return {
            valid: false,
            message: (body as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`,
        };
    } catch (err) {
        return { valid: false, message: err instanceof Error ? err.message : 'Request failed' };
    }
};

const verifyNanobanana = async (key: string): Promise<{ valid: boolean; message?: string }> => {
    try {
        const signal = withTimeout(5000);
        const res = await fetch(`${env.nanobananaBaseUrl}/credits`, {
            headers: { Authorization: `Bearer ${key}` },
            signal,
        });
        if (res.ok) return { valid: true };
        const body = await res.json().catch(() => ({}));
        return {
            valid: false,
            message:
                (body as { message?: string; error?: string }).message ??
                (body as { error?: string }).error ??
                `HTTP ${res.status}`,
        };
    } catch (err) {
        return { valid: false, message: err instanceof Error ? err.message : 'Request failed' };
    }
};

const verifyOpenAI = async (key: string): Promise<{ valid: boolean; message?: string }> => {
    if (!isPaidOpenAIAllowed()) {
        return {
            valid: false,
            message: `${PAID_OPENAI_DISABLED}: set ALLOW_PAID_OPENAI=1 only when you intentionally want to call OpenAI.`,
        };
    }

    try {
        const signal = withTimeout(5000);
        const res = await fetch('https://api.openai.com/v1/models', {
            headers: { Authorization: `Bearer ${key}` },
            signal,
        });
        if (res.ok) return { valid: true };
        const body = await res.json().catch(() => ({}));
        return {
            valid: false,
            message: (body as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`,
        };
    } catch (err) {
        return { valid: false, message: err instanceof Error ? err.message : 'Request failed' };
    }
};

const verifyElevenLabs = async (key: string): Promise<{ valid: boolean; message?: string }> => {
    try {
        const signal = withTimeout(5000);
        const res = await fetch('https://api.elevenlabs.io/v1/user', {
            headers: { 'xi-api-key': key },
            signal,
        });
        if (res.ok) return { valid: true };
        const body = await res.json().catch(() => ({}));
        return {
            valid: false,
            message: (body as { detail?: { message?: string } | string }).detail
                ? typeof (body as { detail?: string }).detail === 'string'
                    ? (body as { detail: string }).detail
                    : ((body as { detail: { message?: string } }).detail?.message ?? `HTTP ${res.status}`)
                : `HTTP ${res.status}`,
        };
    } catch (err) {
        return { valid: false, message: err instanceof Error ? err.message : 'Request failed' };
    }
};

const VERIFY_FN: Record<ApiKeyProvider, (key: string) => Promise<{ valid: boolean; message?: string }>> = {
    anthropic: verifyAnthropic,
    nanobanana: verifyNanobanana,
    openai: verifyOpenAI,
    elevenlabs: verifyElevenLabs,
};

// ============================================================================
// Service
// ============================================================================

export const settingsService = {
    /** Return masked info for all known providers */
    async getAll(): Promise<ApiKeyInfo[]> {
        const results: ApiKeyInfo[] = [];
        for (const provider of API_KEY_PROVIDERS) {
            const record = await settingsRepo.getKeyAsync(provider);
            if (record) {
                results.push({
                    provider,
                    configured: true,
                    maskedKey: record.maskedKey,
                    status: record.status,
                    lastVerifiedAt: record.lastVerifiedAt,
                });
                continue;
            }
            results.push({
                provider,
                configured: false,
                maskedKey: null,
                status: 'missing' as const,
                lastVerifiedAt: null,
            });
        }
        return results;
    },

    /** Store a new API key. Never log the raw key. */
    async putKey(provider: ApiKeyProvider, apiKey: string): Promise<void> {
        const masked = maskKey(apiKey);
        log.info(`settings: storing key for provider`, { provider, maskedKey: masked });
        await settingsRepo.putKey(provider, apiKey, masked);
    },

    /** Remove a stored key */
    async deleteKey(provider: ApiKeyProvider): Promise<void> {
        log.info(`settings: deleting key for provider`, { provider });
        await settingsRepo.deleteKey(provider);
    },

    /** Verify a key by making a real lightweight HTTP call to the provider */
    async verifyKey(provider: ApiKeyProvider): Promise<ApiKeyVerifyResponse> {
        const now = new Date().toISOString();
        const rawKey = await getRawKeyAsync(provider);

        if (!rawKey) {
            return { provider, valid: false, status: 'missing', checkedAt: now, message: 'No API key configured' };
        }

        log.info(`settings: verifying key for provider`, { provider });

        let result: { valid: boolean; message?: string };
        try {
            result = await VERIFY_FN[provider](rawKey);
        } catch (err) {
            result = {
                valid: false,
                message: err instanceof Error ? err.message : 'Unexpected error during verification',
            };
        }

        const newStatus = result.valid ? 'active' : 'invalid';

        // Only update stored record if one exists (don't store env-only keys)
        const stored = await settingsRepo.getKeyAsync(provider);
        if (stored) {
            await settingsRepo.updateStatus(provider, newStatus, now);
        }

        log.info(`settings: verify result`, { provider, valid: result.valid, status: newStatus });

        return {
            provider,
            valid: result.valid,
            status: newStatus,
            checkedAt: now,
            ...(result.message ? { message: result.message } : {}),
        };
    },

    /** Get raw key for internal adapter use (sync, local only). */
    getKeyForProvider(provider: ApiKeyProvider): string | null {
        return getRawKey(provider);
    },

    /** Get raw key — async version that reads from DynamoDB in prod. */
    async getKeyForProviderAsync(provider: ApiKeyProvider): Promise<string | null> {
        return getRawKeyAsync(provider);
    },
};
