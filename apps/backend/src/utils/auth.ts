import { timingSafeEqual } from 'crypto';

import type { APIGatewayProxyEvent } from 'aws-lambda';

type AuthResult =
    | { ok: true; required: boolean }
    | {
          ok: false;
          statusCode: 401 | 403 | 500;
          error: 'UNAUTHORIZED' | 'FORBIDDEN' | 'AUTH_NOT_CONFIGURED';
          message: string;
      };

const getConfiguredApiKeys = (): string[] =>
    (process.env.APP_API_KEY ?? '')
        .split(',')
        .map(key => key.trim())
        .filter(Boolean);

const isAuthRequired = (configuredKeys: string[]): boolean =>
    process.env.STAGE !== 'local' || configuredKeys.length > 0;

const safeEquals = (actual: string, expected: string): boolean => {
    const actualBuffer = Buffer.from(actual);
    const expectedBuffer = Buffer.from(expected);
    if (actualBuffer.length !== expectedBuffer.length) return false;
    return timingSafeEqual(actualBuffer, expectedBuffer);
};

const getHeader = (headers: APIGatewayProxyEvent['headers'] | undefined, name: string): string | undefined => {
    const loweredName = name.toLowerCase();
    return Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === loweredName)?.[1];
};

export const authorizeApiKeyValue = (apiKey?: string | null): AuthResult => {
    const configuredKeys = getConfiguredApiKeys();
    const required = isAuthRequired(configuredKeys);
    if (!required) return { ok: true, required: false };

    if (configuredKeys.length === 0) {
        return {
            ok: false,
            statusCode: 500,
            error: 'AUTH_NOT_CONFIGURED',
            message: 'API authentication is required but APP_API_KEY is not configured.',
        };
    }

    if (!apiKey) {
        return {
            ok: false,
            statusCode: 401,
            error: 'UNAUTHORIZED',
            message: 'Missing x-api-key header.',
        };
    }

    if (!configuredKeys.some(configuredKey => safeEquals(apiKey, configuredKey))) {
        return {
            ok: false,
            statusCode: 403,
            error: 'FORBIDDEN',
            message: 'Invalid API key.',
        };
    }

    return { ok: true, required: true };
};

export const authorizeHttpRequest = (event: APIGatewayProxyEvent): AuthResult => {
    const apiKey = getHeader(event.headers, 'x-api-key') ?? event.queryStringParameters?.['x-api-key'];
    return authorizeApiKeyValue(apiKey);
};
