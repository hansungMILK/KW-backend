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
        await expect(page.getByText('영상 합성', { exact: true })).toBeVisible({ timeout: 20000 });
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

    test('starts a script-first approved workflow in step mode without paid AI calls', async ({ page }) => {
        prepareOutputDir();
        const probe = attachProbe(page);
        const flowId = await createFlowWithCanvas(page, {
            nodes: [
                {
                    id: 'node-search',
                    type: 'search',
                    blockType: 'search',
                    name: '기사 내용 수집',
                    position: { x: 120, y: 160 },
                    state: 'IDLE',
                    config: { query: 'E2E no paid source collection' },
                },
                {
                    id: 'node-content',
                    type: 'content',
                    blockType: 'content',
                    name: '스크립트 생성',
                    position: { x: 440, y: 160 },
                    state: 'IDLE',
                    config: { reviewMode: 'script-first', topic: 'E2E no paid script review' },
                },
            ],
            edges: [
                {
                    id: 'edge-search-content',
                    sourceNodeId: 'node-search',
                    sourcePortId: 'out',
                    targetNodeId: 'node-content',
                    targetPortId: 'in',
                },
            ],
        });

        let runRequestBody: Record<string, unknown> | null = null;
        await page.route(`**/_apis/flows/${flowId}/runs`, async route => {
            if (route.request().method() !== 'POST') {
                await route.continue();
                return;
            }

            runRequestBody = route.request().postDataJSON() as Record<string, unknown>;
            await route.fulfill({
                status: 202,
                contentType: 'application/json',
                body: JSON.stringify({
                    runId: 'run-e2e-step-mode',
                    flowId,
                    status: 'QUEUED',
                    runType: 'FULL_FLOW',
                    createdAt: new Date().toISOString(),
                }),
            });
        });
        await page.route('**/_apis/runs/run-e2e-step-mode', route =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    runId: 'run-e2e-step-mode',
                    flowId,
                    runType: 'FULL_FLOW',
                    status: 'COMPLETED',
                    triggerSource: 'MANUAL',
                    executionMode: 'step',
                    flowSnapshot: { nodes: [], edges: [] },
                    finalOutputSummary: {
                        stoppedForReview: true,
                        reviewNodeId: 'node-content',
                    },
                    createdAt: new Date().toISOString(),
                }),
            })
        );
        await page.route('**/_apis/runs/run-e2e-step-mode/nodes', route =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    items: [
                        {
                            runId: 'run-e2e-step-mode',
                            nodeId: 'node-content',
                            blockType: 'content',
                            label: '스크립트 생성',
                            status: 'COMPLETED',
                            progress: 100,
                            retryCount: 0,
                            parentNodeIds: ['node-search'],
                            outputPayload: {
                                scenes: [{ narration: '검수할 대본입니다.' }],
                            },
                            updatedAt: new Date().toISOString(),
                        },
                    ],
                }),
            })
        );

        await openAuthenticatedEditor(page, 'script-first-run-mode', `/flows/${flowId}`);
        await expect(page.getByText('스크립트 생성')).toBeVisible({ timeout: 10000 });
        await capture(page, '06-script-first-loaded');

        await page.getByRole('button', { name: /워크플로우 실행|Run Workflow/i }).click();
        await expect(page.getByText('대본 검수 모드로 실행을 시작했습니다.')).toBeVisible({ timeout: 10000 });
        await capture(page, '07-script-first-step-run-started');

        expect(runRequestBody).toMatchObject({ executionMode: 'step' });

        writeProbeArtifacts(probe, {
            mode: 'script-first-run-mode-no-paid',
            flowId,
            runRequestBody,
            apiStatuses: summarizeApiStatuses(probe.apiResponses),
        });
    });

    test('continues a script-first workflow in full mode after reviewed output is saved', async ({ page }) => {
        prepareOutputDir();
        const probe = attachProbe(page);
        const flowId = await createFlowWithCanvas(page, {
            nodes: [
                {
                    id: 'node-content-reviewed',
                    type: 'content',
                    blockType: 'content',
                    name: '스크립트 생성',
                    position: { x: 160, y: 160 },
                    state: 'IDLE',
                    config: {
                        reviewMode: 'script-first',
                        topic: 'E2E reviewed script',
                        reviewedOutput: JSON.stringify({ scenes: [{ narration: '검수 완료 대본입니다.' }] }),
                    },
                },
                {
                    id: 'node-image',
                    type: 'media-image',
                    blockType: 'media-image',
                    name: '이미지 생성',
                    position: { x: 480, y: 160 },
                    state: 'IDLE',
                    config: { count: 1 },
                },
            ],
            edges: [
                {
                    id: 'edge-content-image',
                    sourceNodeId: 'node-content-reviewed',
                    sourcePortId: 'out',
                    targetNodeId: 'node-image',
                    targetPortId: 'in',
                },
            ],
        });

        let runRequestBody: Record<string, unknown> | null = null;
        await page.route(`**/_apis/flows/${flowId}/runs`, async route => {
            if (route.request().method() !== 'POST') {
                await route.continue();
                return;
            }

            runRequestBody = route.request().postDataJSON() as Record<string, unknown>;
            await route.fulfill({
                status: 202,
                contentType: 'application/json',
                body: JSON.stringify({
                    runId: 'run-e2e-full-mode',
                    flowId,
                    status: 'QUEUED',
                    runType: 'FULL_FLOW',
                    createdAt: new Date().toISOString(),
                }),
            });
        });
        await page.route('**/_apis/runs/run-e2e-full-mode', route =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    runId: 'run-e2e-full-mode',
                    flowId,
                    runType: 'FULL_FLOW',
                    status: 'COMPLETED',
                    triggerSource: 'MANUAL',
                    executionMode: 'full',
                    flowSnapshot: { nodes: [], edges: [] },
                    createdAt: new Date().toISOString(),
                }),
            })
        );
        await page.route('**/_apis/runs/run-e2e-full-mode/nodes', route =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ items: [] }),
            })
        );

        await openAuthenticatedEditor(page, 'script-reviewed-full-mode', `/flows/${flowId}`);
        await expect(page.getByText('스크립트 생성')).toBeVisible({ timeout: 10000 });
        await capture(page, '08-script-reviewed-loaded');

        await page.getByRole('button', { name: /워크플로우 실행|Run Workflow/i }).click();
        await expect(page.getByText('워크플로우 실행을 시작했습니다.', { exact: true })).toBeVisible({
            timeout: 10000,
        });
        await capture(page, '09-script-reviewed-full-run-started');

        expect(runRequestBody).toMatchObject({ executionMode: 'full' });

        writeProbeArtifacts(probe, {
            mode: 'script-reviewed-full-mode-no-paid',
            flowId,
            runRequestBody,
            apiStatuses: summarizeApiStatuses(probe.apiResponses),
        });
    });

    test('shows and runs longform Gate A without enabling paid media generation', async ({ page }) => {
        prepareOutputDir();
        const probe = attachProbe(page);
        const flowId = await createFlowWithCanvas(page, { nodes: [], edges: [] });
        const createdAt = new Date().toISOString();
        const proposalId = 'proposal-longform-gate-a-e2e';
        const runId = 'run-longform-gate-a-e2e';
        const longformArtifact = {
            gate: 'A',
            mode: 'longform-gate-a',
            sourceDigest: ['AI 에이전트는 단순 챗봇을 넘어 실제 업무 실행 계층으로 이동하고 있습니다.'],
            outline: [
                {
                    title: '왜 지금 AI 에이전트인가',
                    summary: '모델 성능보다 중요한 변화는 도구를 실제로 호출하는 실행 능력입니다.',
                },
                {
                    title: '기존 자동화와의 차이',
                    summary: '정해진 규칙만 따르는 자동화와 달리 목표를 해석하고 중간 결정을 내립니다.',
                },
            ],
            fullScriptDraft:
                'AI 에이전트의 미래를 이해하려면 먼저 챗봇과 실행형 소프트웨어를 구분해야 합니다.\n' +
                '중요한 변화는 답변을 잘하는 모델이 아니라, 사용자의 목표를 받아 도구를 연결하고 결과를 검증하는 시스템입니다.\n' +
                '정리하면 앞으로 중요한 건 더 긴 답변이 아니라, 믿고 맡길 수 있는 실행 흐름입니다.',
            scenePlan: [
                {
                    sceneNumber: 1,
                    title: '오프닝',
                    visualPlan: '업무 도구가 연결되는 데스크톱 화면',
                    durationSec: 35,
                },
                {
                    sceneNumber: 2,
                    title: '문제 재정의',
                    visualPlan: '챗봇 답변과 실제 자동 실행 결과를 비교하는 화면',
                    durationSec: 50,
                },
            ],
            estimatedDurationSec: 300,
            estimatedCost: { currency: 'USD', total: 0.16, notes: ['Gate A planning only'] },
            rendererRoute: 'hyperframes',
            mediaExecutionAllowed: false,
        };
        const longformNodes = [
            {
                id: 'node-longform-search',
                type: 'search',
                blockType: 'search',
                name: '롱폼 자료 수집',
                position: { x: 120, y: 160 },
                state: 'IDLE',
                config: { mode: 'longform-gate-a', query: 'AI 에이전트의 미래' },
            },
            {
                id: 'node-longform-content',
                type: 'content',
                blockType: 'content',
                name: '롱폼 기획안 작성',
                position: { x: 440, y: 160 },
                state: 'IDLE',
                config: {
                    mode: 'longform-gate-a',
                    contentProfileId: 'longform.explainer.v1',
                    reviewMode: 'script-first',
                    rendererRoute: 'hyperframes',
                    mediaExecutionAllowed: false,
                    targetDurationSec: 300,
                    maxDurationSec: 300,
                },
            },
            {
                id: 'node-longform-data',
                type: 'data',
                blockType: 'data',
                name: '롱폼 Gate A 정규화',
                position: { x: 760, y: 160 },
                state: 'IDLE',
                config: { mode: 'longform-gate-a', mediaExecutionAllowed: false },
            },
            {
                id: 'node-longform-analysis',
                type: 'analysis',
                blockType: 'analysis',
                name: '롱폼 Gate A 검수',
                position: { x: 1080, y: 160 },
                state: 'IDLE',
                config: { mode: 'longform-gate-a', mediaExecutionAllowed: false },
            },
        ];
        const longformEdges = [
            {
                id: 'edge-longform-search-content',
                sourceNodeId: 'node-longform-search',
                sourcePortId: 'out',
                targetNodeId: 'node-longform-content',
                targetPortId: 'in',
            },
            {
                id: 'edge-longform-content-data',
                sourceNodeId: 'node-longform-content',
                sourcePortId: 'out',
                targetNodeId: 'node-longform-data',
                targetPortId: 'in',
            },
            {
                id: 'edge-longform-data-analysis',
                sourceNodeId: 'node-longform-data',
                sourcePortId: 'out',
                targetNodeId: 'node-longform-analysis',
                targetPortId: 'in',
            },
        ];
        const contentProfileMetadata = {
            contentProfile: {
                contentProfileId: 'longform.explainer.v1',
                scriptToneId: 'calm-explainer',
                scriptToneIntensity: 'medium',
                reviewMode: 'script-first',
                profileOptions: [
                    { id: 'longform.explainer.v1', label: '롱폼 해설', description: '3-5분 이상 해설 영상' },
                ],
                toneOptions: [
                    { id: 'calm-explainer', label: '차분한 해설형', description: '롱폼과 교육형 설명 기본값' },
                ],
                intensityOptions: [{ id: 'medium', label: '표준', description: '자연스럽게' }],
                reviewModeOptions: [
                    {
                        id: 'script-first',
                        label: '대본 검수 후 실행',
                        description: '대본 단계에서 멈춰 사용자가 검수합니다.',
                    },
                ],
            },
        };
        let approveRequestBody: Record<string, unknown> | null = null;
        let runRequestBody: Record<string, unknown> | null = null;

        await page.route(`**/_apis/flows/${flowId}/messages`, async route => {
            if (route.request().method() !== 'POST') {
                await route.continue();
                return;
            }

            await route.fulfill({
                status: 201,
                contentType: 'application/json',
                body: JSON.stringify({
                    message: {
                        messageId: 'msg-longform-user-e2e',
                        flowId,
                        role: 'USER',
                        messageType: 'TEXT',
                        content: '롱폼 제작해줘. 주제는 AI 에이전트의 미래',
                        createdAt,
                    },
                    proposal: {
                        proposalId,
                        flowId,
                        status: 'PENDING',
                        estimatedCost: { currency: 'USD', total: 0.16 },
                        estimatedCostUsd: 0.16,
                        maxRunEstimatedCostUsd: 2,
                        metadata: contentProfileMetadata,
                        proposedNodes: longformNodes,
                        proposedEdges: longformEdges,
                        approvalRequired: true,
                        createdAt,
                    },
                    assistantMessage: {
                        messageId: 'msg-longform-agent-e2e',
                        flowId,
                        role: 'ASSISTANT',
                        messageType: 'PROPOSAL',
                        proposalId,
                        content:
                            '롱폼 Gate A입니다. 자료 수집, outline, full script draft, scene plan, 예상 길이/비용, HyperFrames 경로를 먼저 만들고 검수 전에는 이미지, TTS, 영상 렌더를 실행하지 않습니다.',
                        createdAt,
                    },
                }),
            });
        });
        await page.route(`**/_apis/proposals/${proposalId}/approve`, async route => {
            approveRequestBody = route.request().postDataJSON() as Record<string, unknown>;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    proposal: {
                        proposalId,
                        flowId,
                        sourceMessageId: 'msg-longform-user-e2e',
                        status: 'APPROVED',
                        proposedNodes: longformNodes,
                        proposedEdges: longformEdges,
                        estimatedCost: { currency: 'USD', total: 0.16 },
                        metadata: contentProfileMetadata,
                        approvalRequired: true,
                        createdAt,
                        updatedAt: createdAt,
                    },
                    flow: {
                        id: flowId,
                        name: 'E2E longform Gate A',
                        state: 'READY',
                        nodes: longformNodes,
                        edges: longformEdges,
                        updatedAt: createdAt,
                    },
                }),
            });
        });
        await page.route(`**/_apis/flows/${flowId}/runs`, async route => {
            if (route.request().method() !== 'POST') {
                await route.continue();
                return;
            }

            runRequestBody = route.request().postDataJSON() as Record<string, unknown>;
            await route.fulfill({
                status: 202,
                contentType: 'application/json',
                body: JSON.stringify({
                    runId,
                    flowId,
                    status: 'QUEUED',
                    runType: 'FULL_FLOW',
                    createdAt,
                }),
            });
        });
        await page.route(`**/_apis/runs/${runId}`, route =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    runId,
                    flowId,
                    runType: 'FULL_FLOW',
                    status: 'COMPLETED',
                    triggerSource: 'MANUAL',
                    executionMode: 'step',
                    flowSnapshot: { nodes: longformNodes, edges: longformEdges },
                    finalOutputSummary: {
                        stoppedForReview: true,
                        reviewNodeId: 'node-longform-content',
                    },
                    createdAt,
                }),
            })
        );
        await page.route(`**/_apis/runs/${runId}/nodes`, route =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    items: [
                        {
                            runId,
                            nodeId: 'node-longform-search',
                            blockType: 'search',
                            label: '롱폼 자료 수집',
                            status: 'COMPLETED',
                            progress: 100,
                            retryCount: 0,
                            parentNodeIds: [],
                            outputPayload: { articles: longformArtifact.sourceDigest },
                            updatedAt: createdAt,
                        },
                        {
                            runId,
                            nodeId: 'node-longform-content',
                            blockType: 'content',
                            label: '롱폼 기획안 작성',
                            status: 'COMPLETED',
                            progress: 100,
                            retryCount: 0,
                            parentNodeIds: ['node-longform-search'],
                            outputPayload: longformArtifact,
                            updatedAt: createdAt,
                        },
                    ],
                }),
            })
        );

        await openAuthenticatedEditor(page, '15-longform-gate-a', `/flows/${flowId}`);
        await page.getByTitle('Flow Agent').click();
        await expect(page.getByText('무엇을 만들까요?')).toBeVisible();
        await capture(page, '16-longform-agent-open');

        await page.locator('textarea').last().fill('롱폼 제작해줘. 주제는 AI 에이전트의 미래');
        await page.keyboard.press('Enter');

        await expect(page.getByText('4개 블록 생성')).toBeVisible({ timeout: 10000 });
        await expect(page.getByText('롱폼 Gate A입니다')).toBeVisible();
        await expect(page.getByText('롱폼 해설')).toBeVisible();
        await expect(page.getByText('대본 검수 후 실행')).toBeVisible();
        await expect(page.getByText('대본 단계에서 멈춰 사용자가 검수한 뒤 유료 생성으로 이어갑니다.')).toBeVisible();
        await expect(page.getByText('이미지 설정')).toHaveCount(0);
        await capture(page, '17-longform-gate-a-proposal');

        await page.getByText('승인').click();
        await expect(page.getByText('롱폼 자료 수집')).toBeVisible({ timeout: 10000 });
        await expect(page.getByText('롱폼 기획안 작성')).toBeVisible();
        await expect(page.getByText('이미지 생성', { exact: true })).toHaveCount(0);
        await expect(page.getByText('음성 생성', { exact: true })).toHaveCount(0);
        await expect(page.getByText('영상 합성', { exact: true })).toHaveCount(0);
        await capture(page, '18-longform-gate-a-approved');

        await page.getByRole('button', { name: /워크플로우 실행|Run Workflow/i }).click();
        await expect(page.getByText('대본 검수 모드로 실행을 시작했습니다.')).toBeVisible({ timeout: 10000 });
        await expect(page.getByText('롱폼 Gate A 기획안')).toBeVisible({ timeout: 10000 });
        await expect(page.getByText('전체 대본 초안')).toBeVisible();
        await expect(page.getByText('씬 플랜')).toBeVisible();
        await expect(page.getByText(/hyperframes/i).first()).toBeVisible();
        await capture(page, '19-longform-gate-a-run-completed');

        expect(approveRequestBody).toMatchObject({
            contentProfileId: 'longform.explainer.v1',
            reviewMode: 'script-first',
            scriptToneId: 'calm-explainer',
        });
        expect(runRequestBody).toMatchObject({ executionMode: 'step' });

        writeProbeArtifacts(probe, {
            mode: 'longform-gate-a-no-paid',
            flowId,
            approveRequestBody,
            runRequestBody,
            mediaNodesVisible: {
                image: (await page.getByText('이미지 생성', { exact: true }).count()) > 0,
                tts: (await page.getByText('음성 생성', { exact: true }).count()) > 0,
                video: (await page.getByText('영상 합성', { exact: true }).count()) > 0,
            },
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
        await expect(page.getByText('영상 합성', { exact: true })).toBeVisible({ timeout: 20000 });
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

async function openAuthenticatedEditor(page: Page, capturePrefix: string, pathName = '/') {
    await page.addInitScript(key => {
        localStorage.setItem('x-api-key', String(key));
    }, appApiKey);
    await page.goto(pathName);
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

async function createFlowWithCanvas(
    page: Page,
    canvas: { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> }
) {
    const create = await postJson(page, 'http://localhost:8800/_apis/flows', {
        title: `E2E ${Date.now()}`,
    });
    expect(create.status, `flow create should succeed: ${JSON.stringify(create.json)}`).toBe(201);

    const flowId = String((create.json as Record<string, unknown>).flowId ?? '');
    expect(flowId, 'flow id should be returned').toBeTruthy();

    const update = await page.request.put(`http://localhost:8800/_apis/flows/${flowId}`, {
        headers: { 'x-api-key': appApiKey },
        data: {
            title: `E2E ${Date.now()}`,
            nodes: canvas.nodes,
            edges: canvas.edges,
        },
    });
    expect(update.status(), `flow canvas save should succeed: ${await update.text()}`).toBe(200);
    return flowId;
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
