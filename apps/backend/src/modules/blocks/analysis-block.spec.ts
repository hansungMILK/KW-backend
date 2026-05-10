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
});
