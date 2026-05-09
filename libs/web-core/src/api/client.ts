import axios from 'axios';
import i18n from 'i18next';
import { toast } from 'sonner';

import { API_URL } from '../core';
import { useWebCoreStore } from '../stores/useWebCoreStore';
import { getApiEndpointPath } from '../utils/apiEndpoint';
import { classifyError } from '../utils/error';

import type { AxiosError, AxiosInstance, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

/** Clear flow-related localStorage on auth error */
const clearFlowStorage = (): void => {
    try {
        localStorage.removeItem('flows-current-flow-id');
    } catch {
        // Silently ignore - non-critical operation
    }
};

/** Handle auth error: clear credentials and show toast */
const handleAuthError = (): void => {
    useWebCoreStore.getState().clearApiKey();
    clearFlowStorage();
    // Delay toast to show after dialog appears
    setTimeout(() => toast.error(i18n.t('errors.authExpired', { ns: 'common' })), 100);
};

/**
 * Centralized Axios instance for all API calls
 */
const apiClient: AxiosInstance = axios.create({
    baseURL: API_URL,
    timeout: 30000,
    headers: {
        'Content-Type': 'application/json',
    },
});

/**
 * Request interceptor: Add x-api-key header and set dynamic baseURL
 */
apiClient.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
        const apiKey = useWebCoreStore.getState().apiKey;
        config.baseURL = `${API_URL}${getApiEndpointPath(apiKey)}`;

        if (apiKey) {
            config.headers['x-api-key'] = apiKey;
        }
        return config;
    },
    (error: unknown) => Promise.reject(error)
);

/** Check if response data contains permission error (403 forbidden) */
const hasPermissionError = (data: unknown): boolean => {
    if (!data) return false;
    const str = typeof data === 'string' ? data : JSON.stringify(data);
    return str.toUpperCase().includes('403') && str.toUpperCase().includes('FORBIDDEN');
};

/**
 * Response interceptor: Handle errors globally
 *
 * Auth Error Scenarios:
 * 1. HTTP 403 → Clear API key (invalid/expired key)
 * 2. shouldLogout from classifyError → Clear API key
 *
 * NOTE: ERR_NETWORK/ERR_FAILED are intentionally NOT treated as auth errors.
 * These codes appear for any network failure (server down, connectivity issues),
 * not just CORS-blocked 403s. Clearing auth on network errors causes false
 * "auth expired" popups when the backend is simply unreachable.
 */
apiClient.interceptors.response.use(
    (response: AxiosResponse) => {
        // Check 200 response for permission error (403 forbidden in body)
        if (hasPermissionError(response.data)) {
            toast.error(i18n.t('errors.forbidden', { ns: 'common' }));
        }
        return response;
    },
    (error: AxiosError) => {
        const status = error.response?.status;

        // Handle auth errors: only on actual HTTP 403 or explicit shouldLogout signal
        if (status === 403 || classifyError(error).shouldLogout) {
            handleAuthError();
        }

        return Promise.reject(error);
    }
);

/**
 * Type-safe API helper functions
 */
export const api = {
    get: <T>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> => apiClient.get<T>(url, config),

    post: <T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> =>
        apiClient.post<T>(url, data, config),

    put: <T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> =>
        apiClient.put<T>(url, data, config),

    patch: <T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> =>
        apiClient.patch<T>(url, data, config),

    delete: <T>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> =>
        apiClient.delete<T>(url, config),
};

export { apiClient };
