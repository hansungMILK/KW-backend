#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

function normalizeBaseUrl(value) {
    return String(value || '').replace(/\/+$/, '');
}

function resolveBaseUrl(env = process.env) {
    const explicitBaseUrl = env.API_BASE_URL || env.VITE_API_URL || env.BACKEND_API_URL || env.EUREKA_API_URL;
    if (explicitBaseUrl) return normalizeBaseUrl(explicitBaseUrl);

    const stage = env.SMOKE_STAGE || env.STAGE || 'dev';
    try {
        const output = execFileSync('npx', ['serverless', 'info', '--stage', stage, '--verbose'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const httpApiUrl = output.match(/HttpApiUrl:\s*(https?:\/\/\S+)/)?.[1];
        if (httpApiUrl) return normalizeBaseUrl(httpApiUrl);
        const executeApiUrl = output.match(
            /https:\/\/[a-z0-9]+\.execute-api\.[^\s]+\.amazonaws\.com(?:\/[^\s]*)?/i
        )?.[0];
        if (executeApiUrl) return normalizeBaseUrl(executeApiUrl);
    } catch {
        // The explicit error below tells the operator what to provide.
    }

    throw new Error('API_BASE_URL or VITE_API_URL is required for ffmpeg overlay smoke.');
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

export function buildApiGatewayEvent(apiKey) {
    return {
        httpMethod: 'POST',
        path: '/diagnostics/ffmpeg-overlay',
        headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
        },
        body: JSON.stringify({ source: 'deploy-smoke' }),
        isBase64Encoded: false,
    };
}

export function resolveSmokeTarget(env = process.env) {
    const stage = env.SMOKE_STAGE || env.STAGE || 'dev';
    const apiKey = env.SMOKE_API_KEY || env.APP_API_KEY || env.VITE_LOCAL_APP_API_KEY || '';
    assert(apiKey, 'APP_API_KEY, SMOKE_API_KEY, or VITE_LOCAL_APP_API_KEY is required for ffmpeg overlay smoke.');

    const explicitMode = env.SMOKE_MODE?.trim().toLowerCase();
    const mode = explicitMode || (stage === 'local' || stage === 'offline' ? 'http' : 'lambda');

    if (mode === 'http') {
        return {
            mode,
            stage,
            baseUrl: resolveBaseUrl(env),
            apiKey,
        };
    }

    if (mode !== 'lambda') {
        throw new Error(`Unsupported SMOKE_MODE=${mode}. Use "lambda" or "http".`);
    }

    return {
        mode,
        stage,
        functionName: env.SMOKE_LAMBDA_FUNCTION || `eureka-flows-backend-${stage}-diagnosticsFfmpegOverlay`,
        apiKey,
    };
}

function parseJson(text, label) {
    try {
        return text ? JSON.parse(text) : null;
    } catch (error) {
        throw new Error(`Failed to parse ${label} JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
}

function parseGatewayResult(rawPayload) {
    const gatewayResult = parseJson(rawPayload, 'Lambda payload');
    const statusCode = Number(gatewayResult?.statusCode);
    const body = parseJson(gatewayResult?.body || '', 'Lambda response body');
    return { statusCode, body };
}

export function buildLambdaInvokeArgs({ functionName, payloadPath, outputPath }) {
    return [
        'lambda',
        'invoke',
        '--function-name',
        functionName,
        '--cli-binary-format',
        'raw-in-base64-out',
        '--cli-read-timeout',
        '240',
        '--cli-connect-timeout',
        '10',
        '--payload',
        `fileb://${payloadPath}`,
        outputPath,
    ];
}

function invokeLambda(target) {
    const workDir = mkdtempSync(join(tmpdir(), 'eureka-ffmpeg-smoke-'));
    const payloadPath = join(workDir, 'lambda-payload.json');
    const outputPath = join(workDir, 'lambda-response.json');

    try {
        writeFileSync(payloadPath, JSON.stringify(buildApiGatewayEvent(target.apiKey)));
        const metadataText = execFileSync('aws', buildLambdaInvokeArgs({ ...target, payloadPath, outputPath }), {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
                ...process.env,
                AWS_MAX_ATTEMPTS: '1',
            },
        });
        const metadata = parseJson(metadataText, 'Lambda invoke metadata');
        const rawPayload = readFileSync(outputPath, 'utf8');

        if (metadata?.FunctionError) {
            throw new Error(
                `Lambda ${target.functionName} returned ${metadata.FunctionError}: ${rawPayload.slice(0, 1000)}`
            );
        }

        return parseGatewayResult(rawPayload);
    } finally {
        rmSync(workDir, { recursive: true, force: true });
    }
}

async function invokeHttp(target) {
    const response = await fetch(`${target.baseUrl}/diagnostics/ffmpeg-overlay`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': target.apiKey,
        },
        body: JSON.stringify({ source: 'deploy-smoke' }),
    });
    const text = await response.text();
    return {
        statusCode: response.status,
        body: text ? parseJson(text, 'HTTP response body') : null,
    };
}

function assertSmokeResult(statusCode, data) {
    if (statusCode < 200 || statusCode >= 300) {
        throw new Error(`diagnostics/ffmpeg-overlay failed: HTTP ${statusCode}\n${JSON.stringify(data)}`);
    }

    assert(data?.ok === true, `Expected ok=true, got ${JSON.stringify(data)}`);
    assert(data?.video?.hasVideo === true, `Expected hasVideo=true, got ${JSON.stringify(data)}`);
    assert(Number(data?.video?.sizeBytes) > 0, `Expected non-empty MP4, got ${JSON.stringify(data)}`);
    assert(Number(data?.video?.width) > 0, `Expected video width, got ${JSON.stringify(data)}`);
    assert(Number(data?.video?.height) > 0, `Expected video height, got ${JSON.stringify(data)}`);
}

export async function main(env = process.env) {
    const target = resolveSmokeTarget(env);

    if (target.mode === 'lambda') {
        console.log(`[ffmpeg-smoke] Lambda ${target.functionName}`);
    } else {
        console.log(`[ffmpeg-smoke] API ${target.baseUrl}`);
    }
    console.log('[ffmpeg-smoke] checking deployed Lambda overlay composition');

    const { statusCode, body } = target.mode === 'lambda' ? invokeLambda(target) : await invokeHttp(target);
    assertSmokeResult(statusCode, body);

    console.log(
        `[ffmpeg-smoke] PASS: MP4 ${body.video.width}x${body.video.height}, ${body.video.sizeBytes} bytes, ${body.durationMs}ms`
    );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(error => {
        console.error(`[ffmpeg-smoke] FAIL: ${error.message}`);
        process.exitCode = 1;
    });
}
