import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ApiKeyProvider } from '@flows/contracts';

const loadResolver = async (storedKey: string | null) => {
    const getDecryptedKeyAsync = vi.fn(async (_provider: ApiKeyProvider) => storedKey);

    vi.doMock('../repositories/settings-repository', () => ({
        settingsRepo: {
            getDecryptedKeyAsync,
        },
    }));

    const module = await import('./credential-resolver');
    return { ...module, getDecryptedKeyAsync };
};

afterEach(() => {
    vi.doUnmock('../repositories/settings-repository');
    vi.unstubAllEnvs();
    vi.resetModules();
});

describe('credentialResolver', () => {
    it('uses stored provider credentials for user runs', async () => {
        vi.stubEnv('OPENAI_API_KEY', 'legacy-env-key');
        const { resolveProviderCredential } = await loadResolver('stored-openai-key');

        const credential = await resolveProviderCredential('openai');

        expect(credential).toEqual({ apiKey: 'stored-openai-key', source: 'stored' });
    });

    it('ignores legacy provider env vars for user runs', async () => {
        vi.stubEnv('OPENAI_API_KEY', 'legacy-env-key');
        const { resolveProviderCredential } = await loadResolver(null);

        const credential = await resolveProviderCredential('openai');

        expect(credential).toBeNull();
    });

    it('uses system provider env vars only for explicit internal smoke', async () => {
        vi.stubEnv('ALLOW_SYSTEM_PROVIDER_KEYS', 'true');
        vi.stubEnv('SYSTEM_OPENAI_API_KEY', 'system-openai-key');
        const { resolveProviderCredential } = await loadResolver(null);

        await expect(resolveProviderCredential('openai')).resolves.toBeNull();
        await expect(resolveProviderCredential('openai', { usage: 'internal-smoke' })).resolves.toEqual({
            apiKey: 'system-openai-key',
            source: 'system',
        });
    });

    it('does not use system provider env vars when the smoke flag is disabled', async () => {
        vi.stubEnv('SYSTEM_OPENAI_API_KEY', 'system-openai-key');
        const { resolveProviderCredential } = await loadResolver(null);

        const credential = await resolveProviderCredential('openai', { usage: 'internal-smoke' });

        expect(credential).toBeNull();
    });
});
