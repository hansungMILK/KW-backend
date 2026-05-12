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
