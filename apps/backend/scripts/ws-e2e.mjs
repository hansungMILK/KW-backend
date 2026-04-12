#!/usr/bin/env node
/**
 * WebSocket E2E test.
 *
 * Requires a running serverless-offline instance:
 *   cd apps/backend && npx nx run backend:start
 * (HTTP on :8800, WS on :8801)
 *
 * Flow:
 *   1. POST /flows            — create an empty flow
 *   2. PUT  /flows/{id}       — save 2 nodes + 1 edge (media-tts → integration)
 *      (these blocks don't require real API keys in mock orchestrator mode)
 *   3. Open WebSocket with ?flowId=<id>
 *   4. Send ping, expect {type:'pong'}
 *   5. POST /flows/{id}/runs  — trigger execution (inline in local mode)
 *   6. Collect all WS messages for N seconds
 *   7. Assert we received at least: run.started, node.started, node.completed, run.completed
 *
 * Run:
 *   node apps/backend/scripts/ws-e2e.mjs
 *
 * Env overrides:
 *   HTTP_BASE=http://localhost:8800
 *   WS_URL=ws://localhost:8801
 *   COLLECT_MS=5000
 */

import WebSocket from 'ws';

const HTTP_BASE = process.env.HTTP_BASE || 'http://localhost:8800';
const WS_URL = process.env.WS_URL || 'ws://localhost:8801';
const COLLECT_MS = Number(process.env.COLLECT_MS || 5000);

// Events we expect to see for a successful mock run.
// The mock orchestrator emits these via wsService.broadcastToFlow in execution-engine.ts.
const REQUIRED_EVENT_TYPES = ['run.started', 'node.started', 'node.completed', 'run.completed'];

const log = (...a) => console.log('[ws-e2e]', ...a);
const err = (...a) => console.error('[ws-e2e]', ...a);

async function httpJson(method, path, body) {
    const res = await fetch(`${HTTP_BASE}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try {
        json = text ? JSON.parse(text) : null;
    } catch {
        json = { raw: text };
    }
    if (!res.ok) {
        throw new Error(`HTTP ${method} ${path} -> ${res.status}: ${text}`);
    }
    return json;
}

function openWs(flowId) {
    return new Promise((resolve, reject) => {
        const url = `${WS_URL}?flowId=${encodeURIComponent(flowId)}`;
        const ws = new WebSocket(url);
        const timeout = setTimeout(() => reject(new Error(`WS connect timeout: ${url}`)), 5000);
        ws.on('open', () => {
            clearTimeout(timeout);
            resolve(ws);
        });
        ws.on('error', e => {
            clearTimeout(timeout);
            reject(e);
        });
    });
}

function waitForMessage(ws, predicate, timeoutMs) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            ws.off('message', onMsg);
            reject(new Error('waitForMessage timeout'));
        }, timeoutMs);
        const onMsg = raw => {
            try {
                const parsed = JSON.parse(raw.toString());
                if (predicate(parsed)) {
                    clearTimeout(timer);
                    ws.off('message', onMsg);
                    resolve(parsed);
                }
            } catch {
                /* ignore non-JSON frames */
            }
        };
        ws.on('message', onMsg);
    });
}

function collectMessages(ws, durationMs) {
    return new Promise(resolve => {
        const msgs = [];
        const onMsg = raw => {
            try {
                msgs.push(JSON.parse(raw.toString()));
            } catch {
                msgs.push({ _nonJson: raw.toString() });
            }
        };
        ws.on('message', onMsg);
        setTimeout(() => {
            ws.off('message', onMsg);
            resolve(msgs);
        }, durationMs);
    });
}

async function main() {
    // 1. Create an empty flow
    log('POST /flows');
    const createRes = await httpJson('POST', '/flows', {
        title: 'WS E2E Test Flow',
        description: 'automated',
        scenario: 'admission-shorts',
        ownerId: 'e2e-test-user',
    });
    const flowId = createRes.flowId;
    if (!flowId) throw new Error('no flowId in create response');
    log('created flowId =', flowId);

    // 2. Save a minimal canvas (2 nodes + 1 edge).
    //    media-tts and integration are chosen because the mock orchestrator
    //    emits them without requiring real API key verification.
    log(`PUT /flows/${flowId}`);
    await httpJson('PUT', `/flows/${flowId}`, {
        title: 'WS E2E Test Flow',
        nodes: [
            {
                id: 'n1',
                type: 'media-tts',
                position: { x: 100, y: 100 },
                data: { label: 'TTS', config: { apiKeyOverride: 'e2e-dummy-tts' } },
            },
            {
                id: 'n2',
                type: 'integration',
                position: { x: 400, y: 100 },
                data: { label: 'Integration', config: { apiKeyOverride: 'e2e-dummy-int' } },
            },
        ],
        edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    });

    // 3. Open WS
    log('opening WS', `${WS_URL}?flowId=${flowId}`);
    const ws = await openWs(flowId);
    log('WS connected');

    // 4. Ping/pong sanity check
    ws.send(JSON.stringify({ action: 'ping' }));
    const pong = await waitForMessage(ws, m => m && m.type === 'pong', 3000);
    if (!pong || pong.type !== 'pong') throw new Error('ping/pong failed');
    if (Object.keys(pong).filter(k => k !== 'type').length > 0) {
        throw new Error(`pong envelope has extra fields: ${JSON.stringify(pong)}`);
    }
    log('ping/pong OK — raw {type:"pong"} shape confirmed');

    // 5. Trigger the run while collecting messages
    const collector = collectMessages(ws, COLLECT_MS);
    log(`POST /flows/${flowId}/runs`);
    await httpJson('POST', `/flows/${flowId}/runs`, { triggerSource: 'MANUAL' });
    const messages = await collector;
    ws.close();

    log(`received ${messages.length} WS messages`);
    for (const m of messages) {
        log('  <-', m.type || '(no type)', m.runId ? `run=${m.runId}` : '');
    }

    // 6. Assert required event types seen
    const typesSeen = new Set(messages.map(m => m && m.type).filter(Boolean));
    const missing = REQUIRED_EVENT_TYPES.filter(t => !typesSeen.has(t));

    // Assert NO wrapper envelope (no stray `action`/`data`/`channel` top-level keys)
    const wrapperLeak = messages.find(
        m => m && typeof m === 'object' && (m.action !== undefined || m.data !== undefined || m.channel !== undefined)
    );

    if (missing.length > 0) {
        err('MISSING required event types:', missing.join(', '));
        err('saw:', [...typesSeen].join(', '));
        process.exit(1);
    }
    if (wrapperLeak) {
        err('FOUND wrapper envelope leak (events must be raw typed):', JSON.stringify(wrapperLeak));
        process.exit(1);
    }

    log('PASS — all required event types received, no wrapper envelope leaks');
    log('types seen:', [...typesSeen].join(', '));
    process.exit(0);
}

main().catch(e => {
    err('FAIL:', e && e.stack ? e.stack : e);
    process.exit(1);
});
