import { beforeEach, describe, expect, it, vi } from 'vitest';

import { integrationBlock } from './integration-block';
import { openaiAdapter } from '../../adapters/ai/openai-adapter';

vi.mock('../../config/env', () => ({
    env: {
        orchestratorMode: 'openai',
        openaiModel: 'gpt-test',
    },
}));

vi.mock('../../adapters/ai/openai-adapter', () => ({
    openaiAdapter: {
        chatJson: vi.fn(async () => {
            throw new Error('skip optional metadata enhancement');
        }),
    },
}));

describe('integrationBlock', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not inject admission metadata into non-education shorts', async () => {
        vi.mocked(openaiAdapter.chatJson).mockResolvedValueOnce({
            content: JSON.stringify({
                title: '마누스 Pro 특가',
                description: '마누스 Pro 특가 핵심 정리',
                hashtags: ['#마누스AI', '#입시', '#교육'],
            }),
            model: 'gpt-test',
            inputTokens: 1,
            outputTokens: 1,
            latencyMs: 1,
        });

        const result = await integrationBlock.execute({
            keywords: ['마누스 AI', 'Manus Pro', '96% 할인'],
            metadata: {
                title: '마누스 Pro, 연 3만 원대?',
                hook: '마누스 Pro 특가가 떴습니다.',
                cta: '구독 전 자동결제를 확인하세요.',
                presetId: 'general-shorts',
            },
            video: {
                url: 'http://localhost/video.mp4',
                durationSec: 45,
                width: 1080,
                height: 1920,
                format: 'mp4',
            },
        });

        expect(result.output['title']).toBe('마누스 Pro 특가');
        expect(result.output['description']).not.toContain('입시');
        expect(result.output['hashtags']).not.toContain('#입시');
        expect(result.output['hashtags']).not.toContain('#교육');
    });
});
