import { authorizeHttpRequest } from './auth';
import { log } from './logger';
import {
    badRequest,
    forbidden,
    getRequestOrigin,
    preflight,
    serverError,
    unauthorized,
    withCorsHeaders,
} from './response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

type Handler = (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>;

/**
 * Wraps a handler with common middleware:
 * - JSON body parsing (event.body → event.parsedBody)
 * - Error catching → 500 response
 * - Request logging
 */
export const withMiddleware = (handler: Handler): Handler => {
    return async event => {
        // Support both API Gateway REST v1 (httpMethod/path) and HTTP v2
        // (requestContext.http.method / rawPath). Narrow via a loose cast
        // because aws-lambda's APIGatewayProxyEvent types only cover v1.
        const v2 = event as unknown as {
            requestContext?: { http?: { method?: string } };
            rawPath?: string;
        };
        const method = event.httpMethod || v2.requestContext?.http?.method || '?';
        const path = event.path || v2.rawPath || '?';
        const origin = getRequestOrigin(event);
        log.info(`${method} ${path}`);

        try {
            if (method === 'OPTIONS') {
                return preflight(origin);
            }

            const auth = authorizeHttpRequest(event);
            if (!auth.ok) {
                if (auth.statusCode === 401) return withCorsHeaders(unauthorized(auth.message), origin);
                if (auth.statusCode === 403) return withCorsHeaders(forbidden(auth.message), origin);
                return withCorsHeaders(serverError(auth.message), origin);
            }

            // Parse JSON body if present
            if (event.body) {
                try {
                    (event as APIGatewayProxyEvent & { parsedBody: unknown }).parsedBody = JSON.parse(event.body);
                } catch {
                    return withCorsHeaders(badRequest('Invalid JSON body'), origin);
                }
            }

            return withCorsHeaders(await handler(event), origin);
        } catch (err) {
            log.error(`Handler error: ${method} ${path}`, err);
            const message = err instanceof Error ? err.message : 'Internal server error';
            return withCorsHeaders(serverError(message), origin);
        }
    };
};

/** Extract parsed body from event (set by withMiddleware) */
export const getBody = <T = unknown>(event: APIGatewayProxyEvent): T | undefined => {
    return (event as APIGatewayProxyEvent & { parsedBody?: T }).parsedBody;
};

/** Extract path parameter */
export const getPathParam = (event: APIGatewayProxyEvent, name: string): string | undefined => {
    return event.pathParameters?.[name] ?? undefined;
};

/** Extract query string parameter */
export const getQueryParam = (event: APIGatewayProxyEvent, name: string): string | undefined => {
    return event.queryStringParameters?.[name] ?? undefined;
};
