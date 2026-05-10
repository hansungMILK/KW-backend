import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

import type { APIResponse, Page, Response } from '@playwright/test';

const outputDir = process.env.E2E_OUTPUT_DIR || '/Users/a0000/Downloads/eureka-ui-check';
const appApiKey = process.env.E2E_APP_API_KEY || 'local-test';
const agentPrompt = process.env.E2E_AGENT_PROMPT || '입시정보 쇼츠 만들어줘';
const paidRunTimeoutMs = readPositiveInt(process.env.E2E_PAID_RUN_TIMEOUT_MS, 12 * 60 * 1000);

interface ApiResponseLog {
    method: string;
    url: string;
    status: number;
    body: string;
}

interface ConsoleLog {
    type: string;
    text: string;
}

interface UiProbe {
    apiResponses: ApiResponseLog[];
    consoleLogs: ConsoleLog[];
}

const requiredCatalogBlocks = [
    'Text Input',
    '트렌드 수집',
    '스크립트 생성',
    '이미지 생성',
    '음성 생성',
    '영상 합성',
    '메타데이터 생성',
];

test.describe('Eureka Flow UI inspection', () => {
    test('lists blocks, adds a Text Input node, and shows local output data without paid AI calls', async ({
        page,
    }) => {
        prepareOutputDir();
        const probe = attachProbe(page);
        await openAuthenticatedEditor(page, 'manual-node');

        await openBlockLibrary(page);
        const libraryText = await capture(page, '01-block-library');

        for (const blockName of requiredCatalogBlocks) {
            expect(libraryText, `block library should show ${blockName}`).toContain(blockName);
        }

        await addTextInputNode(page);
        await expect(page.getByText('Text Input').first()).toBeVisible();
        await expect(page.getByText(/Configuration|CONFIGURATION|설정/)).toBeVisible();
        await expect(page.getByText(/Outputs|OUTPUTS|출력/)).toBeVisible();

        const localOutput = `로컬 출력 검증 ${Date.now()}`;
        await fillTextInputConfig(page, localOutput);
        await page
            .getByRole('button', { name: /Run Block|블록 실행/i })
            .last()
            .click();
        await expect(page.locator('span').filter({ hasText: localOutput }).first()).toBeVisible({ timeout: 10000 });

        const afterRunText = await capture(page, '02-after-local-run');
        expect(afterRunText).not.toContain('Unknown block type: unknown');
        expect(afterRunText).not.toContain('Invalid API key');

        writeProbeArtifacts(probe, {
            mode: 'no-paid-manual-node',
            requiredCatalogBlocks,
            detectedCatalogBlocks: requiredCatalogBlocks.filter(blockName => libraryText.includes(blockName)),
            detectedNodes: ['Text Input'],
            localOutputVisible: afterRunText.includes(localOutput),
            hasDataWaitingText: afterRunText.includes('데이터 대기 중'),
            hasUnknownBlockError: afterRunText.includes('Unknown block type: unknown'),
            apiStatuses: summarizeApiStatuses(probe.apiResponses),
        });
    });

    test('opens Flow Agent and approves a real proposal when explicitly enabled', async ({ page }) => {
        test.skip(process.env.E2E_ALLOW_AGENT !== '1', 'Set E2E_ALLOW_AGENT=1 to call the AI proposal endpoint');

        prepareOutputDir();
        const probe = attachProbe(page);
        await openAuthenticatedEditor(page, 'agent-proposal');

        await page.getByTitle('Flow Agent').click();
        await expect(page.getByText('무엇을 만들까요?')).toBeVisible();
        await capture(page, '03-agent-open');

        await page.locator('textarea').last().fill(agentPrompt);
        await page.keyboard.press('Enter');

        await expect(page.getByText(/개 블록 생성/)).toBeVisible({ timeout: 45000 });
        await expect(page.getByText('승인')).toBeVisible();
        const proposalText = await capture(page, '04-agent-proposal');
        expect(proposalText).not.toContain('0개 블록 생성');
        expect(proposalText).toContain('1회 실행 한도');

        await page.getByText('승인').click();
        await expect(page.getByText('트렌드 수집')).toBeVisible({ timeout: 20000 });
        await expect(page.getByText('영상 합성')).toBeVisible({ timeout: 20000 });
        const approvedText = await capture(page, '05-agent-approved');

        writeProbeArtifacts(probe, {
            mode: 'agent-proposal-opt-in',
            prompt: agentPrompt,
            proposalVisible: /개 블록 생성/.test(proposalText),
            approvedNodesVisible: ['트렌드 수집', '영상 합성'].filter(nodeName => approvedText.includes(nodeName)),
            hasUnknownBlockError: approvedText.includes('Unknown block type: unknown'),
            apiStatuses: summarizeApiStatuses(probe.apiResponses),
        });
    });

    test('executes an approved workflow to final video when paid run is explicitly enabled', async ({ page }) => {
        test.skip(
            process.env.E2E_ALLOW_PAID_RUN !== '1',
            'Set E2E_ALLOW_PAID_RUN=1 to call paid AI media generation and FFmpeg synthesis'
        );
        test.setTimeout(paidRunTimeoutMs + 120000);

        prepareOutputDir();
        const probe = attachProbe(page);
        await openAuthenticatedEditor(page, 'paid-run');

        await page.getByTitle('Flow Agent').click();
        await expect(page.getByText('무엇을 만들까요?')).toBeVisible();
        await capture(page, '10-paid-agent-open');

        await page.locator('textarea').last().fill(agentPrompt);
        await page.keyboard.press('Enter');

        await expect(page.getByText(/개 블록 생성/)).toBeVisible({ timeout: 45000 });
        const proposalText = await capture(page, '11-paid-proposal');
        expect(proposalText).toContain('1회 실행 한도');
        expect(proposalText).not.toContain('0개 블록 생성');

        await page.getByText('승인').click();
        await expect(page.getByText('트렌드 수집')).toBeVisible({ timeout: 20000 });
        await expect(page.getByText('영상 합성')).toBeVisible({ timeout: 20000 });
        await capture(page, '12-paid-approved');

        const flowId = findCreatedFlowId(probe.apiResponses);
        expect(flowId, 'created flow id should be captured before starting run').toBeTruthy();

        const runStart = await postJson(page, `http://localhost:8800/_apis/flows/${flowId}/runs`, {});
        fs.writeFileSync(path.join(outputDir, '13-run-start.json'), JSON.stringify(runStart, null, 2));
        expect(runStart.status, `run start should be accepted: ${JSON.stringify(runStart.json)}`).toBe(202);

        const runId = String((runStart.json as Record<string, unknown>).runId ?? '');
        expect(runId, 'run id should be returned').toBeTruthy();
        await capture(page, '13-run-started');

        const result = await pollRunToTerminal(page, flowId, runId);
        await capture(page, `14-run-${result.status.toLowerCase()}`);

        writeProbeArtifacts(probe, {
            mode: 'paid-run-opt-in',
            prompt: agentPrompt,
            flowId,
            runId,
            finalStatus: result.status,
            finalVideoAssetId: result.videoAsset?.assetId ?? null,
            finalVideoPath: result.videoPath ?? null,
            hasUnknownBlockError: (await page.locator('body').innerText()).includes('Unknown block type: unknown'),
            apiStatuses: summarizeApiStatuses(probe.apiResponses),
        });

        expect(result.status, `run should complete; see ${outputDir}/run-polls.json`).toBe('COMPLETED');
        expect(result.videoAsset, 'completed run should create a VIDEO asset').toBeTruthy();
    });
});

function prepareOutputDir() {
    fs.rmSync(outputDir, { recursive: true, force: true });
    fs.mkdirSync(outputDir, { recursive: true });
}

function attachProbe(page: Page): UiProbe {
    const probe: UiProbe = {
        apiResponses: [],
        consoleLogs: [],
    };

    page.on('console', msg => {
        probe.consoleLogs.push({ type: msg.type(), text: msg.text() });
    });

    page.on('response', response => {
        void captureApiResponse(response, probe.apiResponses);
    });

    return probe;
}

async function captureApiResponse(response: Response, apiResponses: ApiResponseLog[]) {
    const url = response.url();
    if (!url.includes(':8800')) return;

    let body = '';
    try {
        body = (await response.text()).slice(0, 4000);
    } catch {
        body = '';
    }

    apiResponses.push({
        method: response.request().method(),
        url,
        status: response.status(),
        body,
    });
}

async function openAuthenticatedEditor(page: Page, capturePrefix: string) {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('body')).toContainText(/Flow|API Key|워크플로우/i);

    const bodyText = await page.locator('body').innerText();
    if (/API Key/i.test(bodyText)) {
        await page.locator('input').first().fill(appApiKey);
        await page.getByRole('button', { name: /Continue/i }).click();
        await expect(page.locator('body')).not.toContainText('Invalid API key', { timeout: 5000 });
    }

    await expect(page.getByText(/Flow|워크플로우/).first()).toBeVisible({ timeout: 10000 });
    await capture(page, `${capturePrefix}-authenticated`);
}

async function openBlockLibrary(page: Page) {
    const startButton = page.getByRole('button', { name: /Add First Node|첫 노드 추가|노드 추가/i }).first();
    if (await startButton.isVisible().catch(() => false)) {
        await startButton.click();
    } else {
        const libraryButton = page.locator('button[title*="node" i], button[aria-label*="node" i]').first();
        if (await libraryButton.isVisible().catch(() => false)) {
            await libraryButton.click();
        } else {
            await page
                .locator('button')
                .filter({ hasText: /^[+＋]$/ })
                .first()
                .click();
        }
    }

    await expect(page.getByRole('button', { name: /Text Input/ })).toBeVisible({ timeout: 10000 });
}

async function addTextInputNode(page: Page) {
    await page.getByRole('button', { name: /Text Input/ }).click();
    await expect(page.getByText(/Configuration|CONFIGURATION|설정/)).toBeVisible({ timeout: 10000 });
}

async function fillTextInputConfig(page: Page, value: string) {
    const configInput = page.getByPlaceholder(/Enter text|텍스트를 입력하세요/i).last();
    await expect(configInput).toBeVisible({ timeout: 10000 });
    await configInput.fill(value);
}

async function capture(page: Page, name: string) {
    await page.screenshot({ path: path.join(outputDir, `${name}.png`), fullPage: true });
    const bodyText = await page
        .locator('body')
        .innerText()
        .catch(error => `ERR:${error.message}`);
    fs.writeFileSync(path.join(outputDir, `${name}.txt`), bodyText);
    return bodyText;
}

function writeProbeArtifacts(probe: UiProbe, summary: Record<string, unknown>) {
    fs.writeFileSync(path.join(outputDir, 'api-responses.json'), JSON.stringify(probe.apiResponses, null, 2));
    fs.writeFileSync(path.join(outputDir, 'console.json'), JSON.stringify(probe.consoleLogs, null, 2));
    fs.writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2));
}

function summarizeApiStatuses(apiResponses: ApiResponseLog[]) {
    return apiResponses.map(item => ({
        method: item.method,
        status: item.status,
        path: new URL(item.url).pathname,
    }));
}

function readPositiveInt(value: string | undefined, fallback: number) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function findCreatedFlowId(apiResponses: ApiResponseLog[]) {
    const createFlow = apiResponses.find(
        item => item.method === 'POST' && new URL(item.url).pathname === '/_apis/flows' && item.status === 201
    );
    if (!createFlow) return '';

    try {
        const body = JSON.parse(createFlow.body) as { flowId?: string };
        return body.flowId ?? '';
    } catch {
        return '';
    }
}

async function postJson(page: Page, url: string, data: Record<string, unknown>) {
    const response = await page.request.post(url, {
        headers: { 'x-api-key': appApiKey },
        data,
    });
    return responseToJson(response);
}

async function getJson(page: Page, url: string) {
    const response = await page.request.get(url, {
        headers: { 'x-api-key': appApiKey },
    });
    return responseToJson(response);
}

async function responseToJson(response: APIResponse) {
    const text = await response.text();
    let json: unknown = null;
    try {
        json = text ? JSON.parse(text) : null;
    } catch {
        json = { raw: text };
    }

    return {
        status: response.status(),
        json,
    };
}

async function pollRunToTerminal(page: Page, flowId: string, runId: string) {
    const polls: Array<Record<string, unknown>> = [];
    const startedAt = Date.now();

    while (Date.now() - startedAt < paidRunTimeoutMs) {
        const runResponse = await getJson(page, `http://localhost:8800/_apis/runs/${runId}`);
        const nodesResponse = await getJson(page, `http://localhost:8800/_apis/runs/${runId}/nodes`);
        const assetsResponse = await getJson(page, `http://localhost:8800/_apis/runs/${runId}/assets`);

        const runJson = runResponse.json as Record<string, unknown>;
        const nodesJson = nodesResponse.json as { items?: Array<Record<string, unknown>> };
        const assetsJson = assetsResponse.json as { items?: Array<Record<string, unknown>> };
        const status = String(runJson.status ?? '');

        const poll = {
            elapsedMs: Date.now() - startedAt,
            status,
            nodes: nodesJson.items?.map(node => ({
                nodeId: node.nodeId,
                label: node.label,
                blockType: node.blockType,
                status: node.status,
                progress: node.progress,
                errorCode: node.errorCode,
                errorMessage: node.errorMessage,
            })),
            assets: assetsJson.items?.map(asset => ({
                assetId: asset.assetId,
                assetType: asset.assetType,
                publicUrl: asset.publicUrl,
            })),
        };
        polls.push(poll);
        fs.writeFileSync(path.join(outputDir, 'run-polls.json'), JSON.stringify(polls, null, 2));

        const pollIndex = String(polls.length).padStart(2, '0');
        await capture(page, `run-poll-${pollIndex}-${status || 'UNKNOWN'}`);

        if (status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED') {
            const videoAsset = assetsJson.items?.find(asset => asset.assetType === 'VIDEO');
            const videoPath = videoAsset ? await saveVideoAsset(videoAsset) : undefined;
            return { status, videoAsset, videoPath };
        }

        await page.waitForTimeout(5000);
    }

    await postJson(page, `http://localhost:8800/_apis/runs/${runId}/cancel`, {});
    return { status: 'TIMEOUT_CANCELLED' };
}

async function saveVideoAsset(asset: Record<string, unknown>) {
    const publicUrl = String(asset.publicUrl ?? '');
    if (!publicUrl) return undefined;

    const response = await fetch(publicUrl);
    if (!response.ok) return undefined;

    const buffer = Buffer.from(await response.arrayBuffer());
    const videoPath = path.join(outputDir, `final-video-${String(asset.assetId ?? 'asset')}.mp4`);
    fs.writeFileSync(videoPath, buffer);
    return videoPath;
}
