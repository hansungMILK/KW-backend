import { Suspense, useCallback, useEffect, useState } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { HelmetProvider } from 'react-helmet-async';
import { I18nextProvider } from 'react-i18next';

import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';

import { flowStorage } from '@flows/flows';
import {
    ApiKeyDialog,
    ErrorFallback,
    GlobalLoader,
    LoadingFallback,
    VersionUpdateBanner,
    useVersionCheck,
} from '@flows/shared';
import { ThemeProvider } from '@flows/theme';
import { reportError, useWebCoreStore, validateApiKey } from '@flows/web-core';

import i18n from '../i18n';

import type { ErrorInfo, ReactNode } from 'react';

const mutationCache = new MutationCache({
    onError: (error: Error): void => {
        reportError(error, {}, 'web');
    },
});

const queryClient = new QueryClient({
    mutationCache,
    defaultOptions: {
        queries: {
            staleTime: Infinity,
            retry: 1,
        },
    },
});

interface ProvidersProps {
    children: ReactNode;
}

/**
 * Check if current path is a demo route that doesn't require authentication
 */
const isDemoRoute = (): boolean => {
    return window.location.pathname.startsWith('/flow/examples');
};

/**
 * API Key gate component
 * Blocks app content until a valid app access key is provided.
 * Provider keys such as OpenAI or ElevenLabs are configured inside the app.
 * Bypasses authentication for demo routes
 */
const ApiKeyGate = ({ children }: { children: ReactNode }) => {
    const { apiKey, setApiKey, initializeApiKey } = useWebCoreStore();
    const [error, setError] = useState<string | null>(null);

    const [isInitialized, setIsInitialized] = useState(false);

    useEffect(() => {
        initializeApiKey();
        setIsInitialized(true);
    }, [initializeApiKey]);

    // Clear flow ID and redirect to root when no API key on flow pages (only after initialization)
    useEffect(() => {
        if (isInitialized && !apiKey && window.location.pathname.startsWith('/flows/')) {
            flowStorage.clearFlowId();
            window.location.href = '/';
        }
    }, [isInitialized, apiKey]);

    const handleApiKeySubmit = async (key: string): Promise<boolean> => {
        setError(null);
        const isValid = await validateApiKey(key);
        if (isValid) {
            setApiKey(key);
            return true;
        }
        setError('앱 접근 키가 올바르지 않습니다. OpenAI/ElevenLabs Provider 키가 아니라 앱 접근 키를 입력해주세요.');
        return false;
    };

    // Bypass authentication for demo routes
    if (isDemoRoute()) {
        return children;
    }

    if (!apiKey) {
        const codesUrl = import.meta.env.VITE_CODES_URL;
        return (
            <ApiKeyDialog
                open={true}
                onSubmit={handleApiKeySubmit}
                error={error}
                codesUrl={codesUrl}
                title="앱 접근 키"
                description="관리자가 발급한 앱 접근 키를 입력하세요. OpenAI, ElevenLabs 같은 Provider API 키는 로그인 후 메뉴에서 별도로 저장합니다."
                placeholder="앱 접근 키"
                submitLabel="입장"
                loadingLabel="검증 중..."
            />
        );
    }

    return children;
};

/**
 * App content with version check banner
 */
const AppContent = ({ children }: { children: ReactNode }) => {
    const { hasUpdate, currentVersion, latestVersion, dismissUpdate } = useVersionCheck();

    return (
        <>
            <VersionUpdateBanner
                isVisible={hasUpdate}
                currentVersion={currentVersion}
                latestVersion={latestVersion}
                onDismiss={dismissUpdate}
            />
            {children}
            <GlobalLoader />
        </>
    );
};

/**
 * Root providers for the application
 * Wraps children with necessary context providers
 */
export const Providers = ({ children }: ProvidersProps) => {
    const handleError = useCallback((error: Error, info: ErrorInfo): void => {
        console.error('Application Error:', error, info);
        reportError(error, { componentStack: info.componentStack ?? undefined }, 'web');
    }, []);

    return (
        <Suspense fallback={<LoadingFallback />}>
            <ErrorBoundary FallbackComponent={ErrorFallback} onError={handleError}>
                <I18nextProvider i18n={i18n}>
                    <HelmetProvider>
                        <QueryClientProvider client={queryClient}>
                            <ThemeProvider defaultTheme="system" storageKey="flows-theme">
                                <ApiKeyGate>
                                    <AppContent>{children}</AppContent>
                                </ApiKeyGate>
                                <Toaster />
                            </ThemeProvider>
                        </QueryClientProvider>
                    </HelmetProvider>
                </I18nextProvider>
            </ErrorBoundary>
        </Suspense>
    );
};
