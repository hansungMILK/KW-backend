import { api } from '@flows/web-core';

import type {
    ApiKeyInfo,
    ApiKeyListResponse,
    ApiKeyProvider,
    ApiKeyPutResponse,
    ApiKeyVerifyResponse,
} from '@flows/contracts';

export const listProviderApiKeys = async (): Promise<ApiKeyInfo[]> => {
    const response = await api.get<ApiKeyListResponse>('/settings/api-keys');
    return response.data.items;
};

export const saveProviderApiKey = async (provider: ApiKeyProvider, apiKey: string): Promise<ApiKeyPutResponse> => {
    const response = await api.put<ApiKeyPutResponse>('/settings/api-keys', { provider, apiKey });
    return response.data;
};

export const verifyProviderApiKey = async (provider: ApiKeyProvider): Promise<ApiKeyVerifyResponse> => {
    const response = await api.post<ApiKeyVerifyResponse>(`/settings/api-keys/${provider}/verify`);
    return response.data;
};

export const deleteProviderApiKey = async (provider: ApiKeyProvider): Promise<void> => {
    await api.delete(`/settings/api-keys/${provider}`);
};
