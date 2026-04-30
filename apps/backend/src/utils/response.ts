import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const FALLBACK_ORIGINS_BY_STAGE: Record<string, string[]> = {
    local: ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:3001', 'http://127.0.0.1:3001'],
    dev: ['https://flow-dev.eureka.codes', 'http://localhost:3000', 'http://localhost:3001'],
    prod: ['https://flow.eureka.codes'],
};

const getAllowedOrigins = (): string[] => {
    const configured = (process.env.CORS_ALLOWED_ORIGINS ?? '')
        .split(',')
        .map(origin => origin.trim())
        .filter(Boolean);
    if (configured.length > 0) return configured;
    return FALLBACK_ORIGINS_BY_STAGE[process.env.STAGE ?? 'local'] ?? FALLBACK_ORIGINS_BY_STAGE.local;
};

export const getRequestOrigin = (event: Pick<APIGatewayProxyEvent, 'headers'>): string | undefined =>
    Object.entries(event.headers ?? {}).find(([key]) => key.toLowerCase() === 'origin')?.[1];

export const getCorsHeaders = (origin?: string): Record<string, string> => {
    const allowedOrigins = getAllowedOrigins();
    const allowedOrigin =
        origin && allowedOrigins.includes(origin) ? origin : (allowedOrigins[0] ?? FALLBACK_ORIGINS_BY_STAGE.prod[0]);

    return {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Api-Key,x-api-key',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        Vary: 'Origin',
    };
};

const CORS_HEADERS = getCorsHeaders();

const json = (statusCode: number, body: unknown): APIGatewayProxyResult => ({
    statusCode,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
});

export const ok = (body: unknown): APIGatewayProxyResult => json(200, body);
export const created = (body: unknown): APIGatewayProxyResult => json(201, body);
export const accepted = (body: unknown): APIGatewayProxyResult => json(202, body);
export const noContent = (): APIGatewayProxyResult => ({ statusCode: 204, headers: CORS_HEADERS, body: '' });

export const badRequest = (message: string): APIGatewayProxyResult =>
    json(400, { status: 400, error: 'BAD_REQUEST', message });

export const unauthorized = (message: string): APIGatewayProxyResult =>
    json(401, { status: 401, error: 'UNAUTHORIZED', message });

export const forbidden = (message: string): APIGatewayProxyResult =>
    json(403, { status: 403, error: 'FORBIDDEN', message });

export const notFound = (message: string, errorCode?: string): APIGatewayProxyResult =>
    json(404, { status: 404, error: errorCode ?? 'NOT_FOUND', message });

export const conflict = (message: string, errorCode?: string): APIGatewayProxyResult =>
    json(409, { status: 409, error: errorCode ?? 'CONFLICT', message });

export const unprocessable = (message: string): APIGatewayProxyResult =>
    json(422, { status: 422, error: 'UNPROCESSABLE_ENTITY', message });

/** 422 with structured body — for MISSING_API_KEYS etc. */
export const unprocessableJson = (body: Record<string, unknown>): APIGatewayProxyResult =>
    json(422, { status: 422, ...body });

export const serverError = (message: string): APIGatewayProxyResult =>
    json(500, { status: 500, error: 'INTERNAL_SERVER_ERROR', message });

export const preflight = (origin?: string): APIGatewayProxyResult => ({
    statusCode: 204,
    headers: getCorsHeaders(origin),
    body: '',
});

export const withCorsHeaders = (result: APIGatewayProxyResult, origin?: string): APIGatewayProxyResult => ({
    ...result,
    headers: { ...(result.headers ?? {}), ...getCorsHeaders(origin) },
});

/** Plain text response (for GET / system info) */
export const plainText = (text: string): APIGatewayProxyResult => ({
    statusCode: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' },
    body: text,
});
