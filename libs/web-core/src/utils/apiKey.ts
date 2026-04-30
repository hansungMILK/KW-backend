import { API_URL } from '../core';
import { getApiEndpointPath } from './apiEndpoint';

const STORAGE_KEY = 'x-api-key';

export const getStoredApiKey = (): string | null => {
    return localStorage.getItem(STORAGE_KEY);
};

export const setStoredApiKey = (key: string): void => {
    localStorage.setItem(STORAGE_KEY, key);
};

export const clearStoredApiKey = (): void => {
    localStorage.removeItem(STORAGE_KEY);
};

/** Validate API key against a protected backend endpoint. */
export const validateApiKey = async (key: string): Promise<boolean> => {
    const normalizedKey = key.trim();
    if (!normalizedKey) return false;

    try {
        const response = await fetch(`${API_URL}${getApiEndpointPath(normalizedKey)}/blocks`, {
            method: 'GET',
            headers: {
                'x-api-key': normalizedKey,
            },
        });
        return response.ok;
    } catch {
        return false;
    }
};
