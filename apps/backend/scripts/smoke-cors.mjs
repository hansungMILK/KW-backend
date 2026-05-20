#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function normalizeUrl(value) {
    return String(value || '').replace(/\/+$/, '');
}

export function resolveBaseUrl(env = process.env) {
    const explicitBaseUrl = env.API_BASE_URL || env.VITE_API_URL || env.BACKEND_API_URL || env.EUREKA_API_URL;
    if (explicitBaseUrl) return normalizeUrl(explicitBaseUrl);

    const stage = env.SMOKE_STAGE || env.STAGE || 'dev';
    try {
        const output = execFileSync('npx', ['serverless', 'info', '--stage', stage, '--verbose'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const httpApiUrl = output.match(/HttpApiUrl:\s*(https?:\/\/\S+)/)?.[1];
        if (httpApiUrl) return normalizeUrl(httpApiUrl);
    } catch {
        // The explicit error below tells the operator what to provide.
    }

    throw new Error('API_BASE_URL or VITE_API_URL is required for CORS smoke.');
}

export function resolveWebOrigin(env = process.env) {
    const stage = env.SMOKE_STAGE || env.STAGE || 'dev';
    const explicitOrigin = env.SMOKE_WEB_ORIGIN || env.WEB_ORIGIN;
    if (explicitOrigin) return normalizeUrl(explicitOrigin);

    if (stage === 'dev') return normalizeUrl(env.DEV_WEB_ORIGIN || 'https://d37nj585pnjtts.cloudfront.net');
    if (stage === 'prod') return normalizeUrl(env.PROD_WEB_ORIGIN || 'https://flow.eureka.codes');
    return normalizeUrl(env.LOCAL_WEB_ORIGIN || 'http://localhost:3000');
}

export function resolveApiKey(env = process.env) {
    const apiKey = env.SMOKE_API_KEY || env.APP_API_KEY || env.VITE_LOCAL_APP_API_KEY || '';
    if (!apiKey) throw new Error('APP_API_KEY, SMOKE_API_KEY, or VITE_LOCAL_APP_API_KEY is required for CORS smoke.');
    return apiKey;
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function headerValue(headers, name) {
    return headers.get(name) || '';
}

function assertAllowOrigin(response, origin, label) {
    const allowOrigin = headerValue(response.headers, 'access-control-allow-origin');
    assert(
        allowOrigin === origin,
        `${label} CORS allow-origin mismatch: expected ${origin}, got ${allowOrigin || '(missing)'}`
    );
}

export async function runCorsSmoke(env = process.env) {
    const baseUrl = resolveBaseUrl(env);
    const origin = resolveWebOrigin(env);
    const apiKey = resolveApiKey(env);
    const url = `${baseUrl}/_apis/blocks`;

    const preflight = await fetch(url, {
        method: 'OPTIONS',
        headers: {
            Origin: origin,
            'Access-Control-Request-Method': 'GET',
            'Access-Control-Request-Headers': 'x-api-key',
        },
    });
    assert(preflight.status >= 200 && preflight.status < 300, `Preflight failed with HTTP ${preflight.status}`);
    assertAllowOrigin(preflight, origin, 'Preflight');

    const allowHeaders = headerValue(preflight.headers, 'access-control-allow-headers').toLowerCase();
    assert(
        allowHeaders.includes('x-api-key'),
        `Preflight allow-headers missing x-api-key: ${allowHeaders || '(missing)'}`
    );

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            Origin: origin,
            'x-api-key': apiKey,
        },
    });
    assert(response.status === 200, `GET /_apis/blocks failed with HTTP ${response.status}`);
    assertAllowOrigin(response, origin, 'GET /_apis/blocks');

    return { baseUrl, origin };
}

export async function main(env = process.env) {
    const { baseUrl, origin } = await runCorsSmoke(env);
    console.log(`[cors-smoke] PASS: ${origin} can call ${baseUrl}/_apis/blocks`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(error => {
        console.error(`[cors-smoke] FAIL: ${error.message}`);
        process.exitCode = 1;
    });
}
