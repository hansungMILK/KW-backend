import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveApiKey, resolveWebOrigin } from './smoke-cors.mjs';

test('requires deployed dev CORS smoke origin to be explicit', () => {
    assert.throws(() => resolveWebOrigin({ SMOKE_STAGE: 'dev' }), /DEV_WEB_ORIGIN or SMOKE_WEB_ORIGIN/);
});

test('allows deploy-specific web origin for dev CORS smoke', () => {
    assert.equal(
        resolveWebOrigin({
            SMOKE_STAGE: 'dev',
            DEV_WEB_ORIGIN: 'https://preview.example.com/',
        }),
        'https://preview.example.com'
    );
});

test('allows smoke web origin override without stage-specific defaults', () => {
    assert.equal(
        resolveWebOrigin({
            SMOKE_STAGE: 'prod',
            SMOKE_WEB_ORIGIN: 'https://preview.example.com/',
        }),
        'https://preview.example.com'
    );
});

test('requires an app access key without printing the value', () => {
    assert.throws(() => resolveApiKey({}), /APP_API_KEY, SMOKE_API_KEY, or VITE_LOCAL_APP_API_KEY/);
    assert.equal(resolveApiKey({ APP_API_KEY: 'redacted' }), 'redacted');
});
