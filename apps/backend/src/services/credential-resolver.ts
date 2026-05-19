import { settingsRepo } from '../repositories/settings-repository';

import type { ApiKeyProvider } from '@flows/contracts';

type CredentialUsage = 'user-run' | 'internal-smoke';
type CredentialSource = 'stored' | 'system';

type ResolveCredentialOptions = {
    usage?: CredentialUsage;
};

type ResolvedProviderCredential = {
    apiKey: string;
    source: CredentialSource;
};

const SYSTEM_ENV_MAP: Record<ApiKeyProvider, string> = {
    anthropic: 'SYSTEM_ANTHROPIC_API_KEY',
    nanobanana: 'SYSTEM_NANOBANANA_API_KEY',
    openai: 'SYSTEM_OPENAI_API_KEY',
    elevenlabs: 'SYSTEM_ELEVENLABS_API_KEY',
};

const isSystemProviderKeyAllowed = (): boolean => {
    const value = process.env.ALLOW_SYSTEM_PROVIDER_KEYS?.trim().toLowerCase();
    return value === '1' || value === 'true' || value === 'yes' || value === 'on';
};

export const resolveProviderCredential = async (
    provider: ApiKeyProvider,
    options: ResolveCredentialOptions = {}
): Promise<ResolvedProviderCredential | null> => {
    const stored = await settingsRepo.getDecryptedKeyAsync(provider);
    if (stored) return { apiKey: stored, source: 'stored' };

    if (options.usage !== 'internal-smoke' || !isSystemProviderKeyAllowed()) return null;

    const systemKey = process.env[SYSTEM_ENV_MAP[provider]];
    if (!systemKey) return null;
    return { apiKey: systemKey, source: 'system' };
};

export const getProviderApiKey = async (
    provider: ApiKeyProvider,
    options: ResolveCredentialOptions = {}
): Promise<string | null> => {
    const credential = await resolveProviderCredential(provider, options);
    return credential?.apiKey ?? null;
};

export const credentialResolver = {
    getProviderApiKey,
    resolveProviderCredential,
};
