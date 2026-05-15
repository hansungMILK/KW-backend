import { beforeEach, describe, expect, it, vi } from 'vitest';

import { analysisBlock } from './analysis-block';
import { openaiAdapter } from '../../adapters/ai/openai-adapter';

vi.mock('../../config/env', () => ({
    env: {
        orchestratorMode: 'openai',
    },
}));

vi.mock('../../adapters/ai/openai-adapter', () => ({
    openaiAdapter: {
        chatJson: vi.fn(async () => ({
            content: JSON.stringify({ suggestedIssues: [] }),
        })),
    },
}));

describe('analysisBlock', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('passes claim type and source refs to the AI review prompt', async () => {
        const normalizedScenes = Array.from({ length: 10 }, (_, index) => ({
            sceneNumber: index + 1,
            caption: `장면 ${index + 1}`,
            narration: `검증 가능한 나레이션 문장입니다 ${index + 1}`,
            imagePrompt: 'A simple Korean explainer shorts scene.',
            visual: {
                topTitle: 'KTX 표가 없는 이유',
                mainCaption: `장면 ${index + 1}`,
            },
            claimType: 'fact',
            sourceRefs: ['source-1'],
            durationSec: 5,
        }));

        await analysisBlock.execute({
            normalizedScenes,
            metadata: {
                title: 'KTX 표가 없는 이유',
                presetId: 'general-shorts',
            },
        });

        expect(openaiAdapter.chatJson).toHaveBeenCalledTimes(1);
        const call = vi.mocked(openaiAdapter.chatJson).mock.calls[0]?.[0];
        expect(call?.userMessage).toContain('claimType=fact');
        expect(call?.userMessage).toContain('sourceRefs=source-1');
        expect(call?.userMessage).toContain('출처 연결이 있는 것으로 간주');
    });

    it('keeps style-only quality issues non-blocking so media generation can continue', async () => {
        const normalizedScenes = Array.from({ length: 12 }, (_, index) => ({
            sceneNumber: index + 1,
            caption: `핵심 장면 ${index + 1}`,
            narration: `검증 가능한 설명형 나레이션 문장입니다 ${index + 1}`,
            imagePrompt: 'A simple Korean explainer shorts scene.',
            visual: {
                topTitle: '1234567890123456789',
                mainCaption: `핵심 장면 ${index + 1}`,
            },
            claimType: 'context',
            sourceRefs: ['source-1'],
            durationSec: 5,
        }));

        const result = await analysisBlock.execute({
            normalizedScenes,
            metadata: {
                title: '세레브라스 IPO',
                presetId: 'general-shorts',
            },
        });

        expect(result.output['approved']).toBe(true);
        expect(result.output['qualityScore']).toBeLessThan(60);
        expect(JSON.stringify(result.output['issues'])).toContain('상단 제목이 너무 깁니다');
    });

    it('auto-remediates source-backed factual wording cautions instead of failing the workflow', async () => {
        vi.mocked(openaiAdapter.chatJson).mockResolvedValueOnce({
            content: JSON.stringify({
                suggestedIssues: [
                    {
                        severity: 'high',
                        sceneNumber: 3,
                        message:
                            "2025년 계약 연장과 계약 만료 시점은 최신 공식 발표 기준이 맞는지 시점 확인이 필요합니다. 단정형 대신 '공식 발표에 따르면'처럼 유지하는 것이 안전합니다.",
                    },
                    {
                        severity: 'high',
                        sceneNumber: 6,
                        message: '최신 사실관계는 출처가 있어도 영상 시점 기준의 정확성을 재확인해야 합니다.',
                    },
                ],
            }),
        });

        const normalizedScenes = Array.from({ length: 12 }, (_, index) => ({
            sceneNumber: index + 1,
            caption: `장면 ${index + 1}`,
            narration:
                index === 2
                    ? '2025년 계약 연장으로 계약은 2026년까지 이어집니다.'
                    : index === 5
                      ? '2025년 유로파리그 우승의 주장으로 다시 주목받았습니다.'
                      : `검증 가능한 설명형 나레이션 문장입니다 ${index + 1}`,
            imagePrompt: 'A simple Korean explainer shorts scene.',
            visual: {
                topTitle: '토트넘 강등 위기',
                mainCaption: `장면 ${index + 1}`,
            },
            claimType: 'fact',
            sourceRefs: ['source-1'],
            durationSec: 5,
        }));

        const result = await analysisBlock.execute({
            normalizedScenes,
            metadata: {
                title: '토트넘 강등 위기',
                presetId: 'general-shorts',
            },
        });

        expect(result.output['approved']).toBe(true);
        expect(JSON.stringify(result.output['issues'])).toContain('자동 완화');
        expect(JSON.stringify(result.output['autoRemediations'])).toContain('sceneNumber');

        const repairedScenes = result.output['normalizedScenes'] as Array<{ sceneNumber: number; narration: string }>;
        expect(repairedScenes.find(scene => scene.sceneNumber === 3)?.narration).toContain('공식 발표 기준으로');
        expect(repairedScenes.find(scene => scene.sceneNumber === 6)?.narration).toContain('공식 발표 기준으로');
    });

    it('does not block source-backed news controversy topics only because they contain the word scam', async () => {
        const normalizedScenes = Array.from({ length: 12 }, (_, index) => ({
            sceneNumber: index + 1,
            caption: `논란 장면 ${index + 1}`,
            narration:
                index === 0
                    ? '보도에 따르면 모수 와인 사기 논란은 결제와 제공 방식에 대한 의혹에서 시작됐습니다.'
                    : `출처 기반으로 논란의 배경을 설명하는 나레이션입니다 ${index + 1}`,
            imagePrompt: 'A source-backed Korean news explainer scene.',
            visual: {
                topTitle: '모수 와인 논란',
                mainCaption: `논란 장면 ${index + 1}`,
            },
            claimType: 'fact',
            sourceRefs: ['source-1'],
            durationSec: 5,
        }));

        const result = await analysisBlock.execute({
            normalizedScenes,
            metadata: {
                title: '모수 와인 사기논란',
                presetId: 'general-shorts',
            },
        });

        expect(result.output['approved']).toBe(true);
        expect(JSON.stringify(result.output['issues'])).not.toContain('금지 키워드 "사기"');
    });

    it('approves complete longform Gate A artifacts and keeps paid execution blocked', async () => {
        const result = await analysisBlock.execute(
            {
                gate: 'A',
                mode: 'longform-gate-a',
                outline: [{ title: '도입', summary: '문제 제기' }],
                fullScriptDraft: 'AI 에이전트의 미래를 설명하는 긴 대본 초안입니다.',
                scenePlan: [{ sceneNumber: 1, title: '도입', durationSec: 40 }],
                estimatedDurationSec: 240,
                estimatedCost: { currency: 'USD', total: 0.18 },
                rendererRoute: 'hyperframes',
                qaChecklist: ['출처 확인'],
                mediaExecutionAllowed: false,
            },
            { mode: 'longform-gate-a' }
        );

        expect(openaiAdapter.chatJson).not.toHaveBeenCalled();
        expect(result.output).toMatchObject({
            approved: true,
            safetyScore: 100,
            qualityScore: 100,
            gate: 'A',
            mode: 'longform-gate-a',
            mediaExecutionAllowed: false,
            rendererRoute: 'hyperframes',
        });
    });

    it('does not treat a generic gate A marker as longform without longform mode or profile', async () => {
        const normalizedScenes = Array.from({ length: 10 }, (_, index) => ({
            sceneNumber: index + 1,
            caption: `장면 ${index + 1}`,
            narration: `일반 콘텐츠 검수 장면입니다 ${index + 1}`,
            imagePrompt: 'A generic review scene.',
            visual: {
                topTitle: '일반 검수',
                mainCaption: `장면 ${index + 1}`,
            },
            claimType: 'opinion',
            sourceRefs: [],
            durationSec: 5,
        }));

        const result = await analysisBlock.execute({ normalizedScenes }, { gate: 'A' });

        expect(openaiAdapter.chatJson).toHaveBeenCalledTimes(1);
        expect(result.output).toHaveProperty('normalizedScenes');
        expect(result.output['mode']).toBeUndefined();
    });
});
