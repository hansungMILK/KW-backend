import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SettingsRecord } from '../repositories/settings-repository';
import type { ApiKeyProvider } from '@flows/contracts';

const loadSettingsService = async (records: Partial<Record<ApiKeyProvider, SettingsRecord>>) => {
    vi.doMock('../repositories/settings-repository', () => ({
        settingsRepo: {
            getKeyAsync: vi.fn(async (provider: ApiKeyProvider) => records[provider] ?? null),
            getDecryptedKey: vi.fn(),
            getDecryptedKeyAsync: vi.fn(),
            isSyncReadAvailable: true,
        },
    }));

    return await import('./settings-service');
};

afterEach(() => {
    vi.doUnmock('../repositories/settings-repository');
    vi.unstubAllEnvs();
    vi.resetModules();
});

describe('settingsService', () => {
    it('does not expose env provider keys as user-configured settings', async () => {
        vi.stubEnv('OPENAI_API_KEY', 'legacy-env-key');
        vi.stubEnv('SYSTEM_OPENAI_API_KEY', 'system-openai-key');
        const { settingsService } = await loadSettingsService({});

        const items = await settingsService.getAll();

        expect(items.find(item => item.provider === 'openai')).toEqual({
            provider: 'openai',
            configured: false,
            maskedKey: null,
            status: 'missing',
            lastVerifiedAt: null,
        });
    });

    it('returns only masked stored credential metadata', async () => {
        const { settingsService } = await loadSettingsService({
            openai: {
                provider: 'openai',
                encryptedKey: 'encrypted',
                maskedKey: 'sk-t****abcd',
                status: 'active',
                lastVerifiedAt: '2026-05-19T00:00:00.000Z',
                updatedAt: '2026-05-19T00:00:00.000Z',
            },
        });

        const items = await settingsService.getAll();

        expect(items.find(item => item.provider === 'openai')).toEqual({
            provider: 'openai',
            configured: true,
            maskedKey: 'sk-t****abcd',
            status: 'active',
            lastVerifiedAt: '2026-05-19T00:00:00.000Z',
        });
    });
});
