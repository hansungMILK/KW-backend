import assert from 'node:assert/strict';
import test from 'node:test';

import { buildApiGatewayEvent, buildLambdaInvokeArgs, resolveSmokeTarget } from './smoke-ffmpeg-overlay.mjs';

test('defaults deployed ffmpeg overlay smoke to direct Lambda invocation', () => {
    assert.deepEqual(
        resolveSmokeTarget({
            SMOKE_STAGE: 'dev',
            APP_API_KEY: 'redacted',
        }),
        {
            mode: 'lambda',
            stage: 'dev',
            functionName: 'eureka-flows-backend-dev-diagnosticsFfmpegOverlay',
            apiKey: 'redacted',
        }
    );
});

test('allows explicit HTTP smoke mode for local/manual checks', () => {
    assert.deepEqual(
        resolveSmokeTarget({
            SMOKE_STAGE: 'dev',
            SMOKE_MODE: 'http',
            API_BASE_URL: 'https://example.com/',
            APP_API_KEY: 'redacted',
        }),
        {
            mode: 'http',
            stage: 'dev',
            baseUrl: 'https://example.com',
            apiKey: 'redacted',
        }
    );
});

test('builds an authenticated API Gateway event without exposing key in logs', () => {
    assert.deepEqual(buildApiGatewayEvent('redacted'), {
        httpMethod: 'POST',
        path: '/diagnostics/ffmpeg-overlay',
        headers: {
            'content-type': 'application/json',
            'x-api-key': 'redacted',
        },
        body: JSON.stringify({ source: 'deploy-smoke' }),
        isBase64Encoded: false,
    });
});

test('passes Lambda payload by file so shell errors do not print API keys', () => {
    const args = buildLambdaInvokeArgs({
        functionName: 'eureka-flows-backend-dev-diagnosticsFfmpegOverlay',
        payloadPath: '/tmp/payload.json',
        outputPath: '/tmp/response.json',
    });

    assert.deepEqual(args, [
        'lambda',
        'invoke',
        '--function-name',
        'eureka-flows-backend-dev-diagnosticsFfmpegOverlay',
        '--cli-binary-format',
        'raw-in-base64-out',
        '--cli-read-timeout',
        '240',
        '--cli-connect-timeout',
        '10',
        '--payload',
        'fileb:///tmp/payload.json',
        '/tmp/response.json',
    ]);
    assert.equal(args.join(' ').includes('redacted'), false);
    assert.equal(args.join(' ').includes('x-api-key'), false);
});
