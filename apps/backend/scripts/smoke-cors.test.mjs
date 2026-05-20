import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveApiKey, resolveWebOrigin } from './smoke-cors.mjs';

test('defaults dev CORS smoke to the deployed CloudFront origin', () => {
    assert.equal(resolveWebOrigin({ SMOKE_STAGE: 'dev' }), 'https://d37nj585pnjtts.cloudfront.net');
});

test('allows deploy-specific web origin override for CORS smoke', () => {
    assert.equal(
        resolveWebOrigin({
            SMOKE_STAGE: 'dev',
            DEV_WEB_ORIGIN: 'https://example.cloudfront.net/',
        }),
        'https://example.cloudfront.net'
    );
});

test('requires an app access key without printing the value', () => {
    assert.throws(() => resolveApiKey({}), /APP_API_KEY, SMOKE_API_KEY, or VITE_LOCAL_APP_API_KEY/);
    assert.equal(resolveApiKey({ APP_API_KEY: 'redacted' }), 'redacted');
});
