#!/usr/bin/env node

const baseUrl = (process.env.API_BASE_URL || 'http://localhost:8800').replace(/\/+$/, '');
const apiKey = process.env.SMOKE_API_KEY || process.env.APP_API_KEY || '';
const waitMs = Number(process.env.SMOKE_WAIT_MS || 120000);
const pollMs = Number(process.env.SMOKE_POLL_MS || 3000);
const prompt = process.env.SMOKE_PROMPT || '입시정보 쇼츠 제작해줘';
const flowTitle = process.env.SMOKE_FLOW_TITLE || `Local smoke ${new Date().toISOString()}`;
const isTruthy = value => ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
const allowPaidOpenAI = isTruthy(process.env.ALLOW_PAID_OPENAI);
const expectPaidSmoke = isTruthy(process.env.EXPECT_PAID_SMOKE);

const headers = {
    'Content-Type': 'application/json',
};
if (apiKey) headers['x-api-key'] = apiKey;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function request(path, options = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: {
            ...headers,
            ...(options.headers || {}),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
        if (options.allowError) {
            return { ok: false, status: response.status, data };
        }
        const details = JSON.stringify(data, null, 2);
        throw new Error(`${options.method || 'GET'} ${path} failed: HTTP ${response.status}\n${details}`);
    }
    return options.allowError ? { ok: true, status: response.status, data } : data;
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function getProposalId(messageResponse) {
    return (
        messageResponse?.proposal?.proposalId ||
        messageResponse?.proposalId ||
        messageResponse?.assistantMessage?.proposalId
    );
}

async function pollRun(runId) {
    const startedAt = performance.now();
    let lastRun = null;

    while (performance.now() - startedAt < waitMs) {
        lastRun = await request(`/runs/${runId}`);
        const status = lastRun.status || lastRun.run?.status;
        console.log(`[smoke] run ${runId}: ${status}`);

        if (status === 'COMPLETED') return lastRun;
        if (status === 'FAILED' || status === 'CANCELLED') {
            throw new Error(`Run ended as ${status}:\n${JSON.stringify(lastRun, null, 2)}`);
        }
        await sleep(pollMs);
    }

    throw new Error(
        `Run ${runId} did not complete within ${waitMs}ms. Last state:\n${JSON.stringify(lastRun, null, 2)}`
    );
}

async function main() {
    console.log(`[smoke] API ${baseUrl}`);
    console.log(`[smoke] paid OpenAI allowed: ${allowPaidOpenAI ? 'yes' : 'no'}`);

    if (allowPaidOpenAI && !expectPaidSmoke) {
        throw new Error(
            'Refusing to run paid smoke without EXPECT_PAID_SMOKE=1. This prevents accidental OpenAI spend.'
        );
    }

    const flow = await request('/flows', {
        method: 'POST',
        body: { title: flowTitle },
    });
    const flowId = flow.flowId || flow.id;
    assert(flowId, `POST /flows returned no flowId: ${JSON.stringify(flow, null, 2)}`);
    console.log(`[smoke] flow created: ${flowId}`);

    if (!allowPaidOpenAI) {
        const blockedMessage = await request(`/flows/${flowId}/messages`, {
            method: 'POST',
            body: { content: prompt },
            allowError: true,
        });
        assert(blockedMessage.status === 422, `Expected paid message block, got ${blockedMessage.status}`);
        assert(
            blockedMessage.data?.error === 'PAID_OPENAI_DISABLED',
            `Expected PAID_OPENAI_DISABLED, got ${JSON.stringify(blockedMessage.data, null, 2)}`
        );
        console.log('[smoke] paid message call blocked before OpenAI network call');

        await request(`/flows/${flowId}`, {
            method: 'PUT',
            body: {
                title: 'No-paid safety run',
                nodes: [{ id: 'node-openai-search', type: 'search', name: 'Search admissions info', config: {} }],
                edges: [],
            },
        });
        const blockedRun = await request(`/flows/${flowId}/runs`, {
            method: 'POST',
            body: { triggerSource: 'SMOKE' },
            allowError: true,
        });
        assert(blockedRun.status === 422, `Expected paid run block, got ${blockedRun.status}`);
        assert(
            blockedRun.data?.error === 'PAID_OPENAI_DISABLED',
            `Expected PAID_OPENAI_DISABLED, got ${JSON.stringify(blockedRun.data, null, 2)}`
        );
        console.log('[smoke] paid run call blocked before OpenAI network call');
        console.log('[smoke] PASS: no-paid safety gate');
        return;
    }

    const greeting = await request(`/flows/${flowId}/messages`, {
        method: 'POST',
        body: { content: 'ㅎㅇ' },
    });
    assert(greeting.assistantMessage, `Greeting did not return assistantMessage: ${JSON.stringify(greeting, null, 2)}`);
    assert(!greeting.proposal, `Greeting incorrectly created proposal: ${JSON.stringify(greeting, null, 2)}`);
    console.log('[smoke] greeting stayed chat-only');

    const proposalResponse = await request(`/flows/${flowId}/messages`, {
        method: 'POST',
        body: { content: prompt },
    });
    const proposalId = getProposalId(proposalResponse);
    const proposedNodes = proposalResponse?.proposal?.proposedNodes || [];
    assert(proposalId, `Shorts request returned no proposalId: ${JSON.stringify(proposalResponse, null, 2)}`);
    assert(proposedNodes.length > 0, `Shorts proposal has no nodes: ${JSON.stringify(proposalResponse, null, 2)}`);
    console.log(`[smoke] proposal created: ${proposalId}, nodes=${proposedNodes.length}`);

    const approved = await request(`/proposals/${proposalId}/approve`, {
        method: 'POST',
        body: { decisionNote: 'local smoke approval' },
    });
    const approvedNodes = approved?.flow?.nodes || [];
    assert(approved?.flow?.state === 'READY', `Approved flow is not READY: ${JSON.stringify(approved, null, 2)}`);
    assert(approvedNodes.length > 0, `Approved flow has no nodes: ${JSON.stringify(approved, null, 2)}`);
    console.log(`[smoke] proposal approved: flow READY, nodes=${approvedNodes.length}`);

    const runResponse = await request(`/flows/${flowId}/runs`, {
        method: 'POST',
        body: { triggerSource: 'SMOKE' },
    });
    const runId = runResponse.runId || runResponse?.run?.runId;
    assert(runId, `Run response has no runId: ${JSON.stringify(runResponse, null, 2)}`);
    console.log(`[smoke] run started: ${runId}`);

    await pollRun(runId);

    const [nodes, assets] = await Promise.all([request(`/runs/${runId}/nodes`), request(`/runs/${runId}/assets`)]);
    const nodeItems = nodes.items || nodes.nodes || nodes;
    const assetItems = assets.items || assets.assets || assets;
    assert(Array.isArray(nodeItems), `Run nodes response is not a list: ${JSON.stringify(nodes, null, 2)}`);
    assert(Array.isArray(assetItems), `Run assets response is not a list: ${JSON.stringify(assets, null, 2)}`);
    const videoAsset = assetItems.find(asset => String(asset.assetType || '').toUpperCase() === 'VIDEO');
    assert(videoAsset, 'No final VIDEO asset found');
    console.log(`[smoke] final video asset: ${videoAsset.assetId || '(no assetId)'} ${videoAsset.publicUrl || ''}`);

    console.log('[smoke] PASS: chat -> proposal -> approve -> run -> video asset');
}

main().catch(error => {
    console.error(`[smoke] FAIL: ${error.message}`);
    process.exitCode = 1;
});
