import { beforeEach, describe, expect, it, vi } from 'vitest';

import { contentBlock } from './content-block';
import { openaiAdapter } from '../../adapters/ai/openai-adapter';

vi.mock('../../config/env', () => ({
    env: {
        orchestratorMode: 'openai',
        openaiModel: 'gpt-test',
    },
}));

vi.mock('../../adapters/ai/openai-adapter', () => ({
    openaiAdapter: {
        chatJson: vi.fn(async () => ({
            content: JSON.stringify({ text: '링크의 핵심은 KTX 예매 수요와 공급 병목입니다.' }),
            model: 'gpt-test',
            inputTokens: 1,
            outputTokens: 1,
            latencyMs: 1,
        })),
    },
}));

describe('contentBlock', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('supports generic text explanation mode without forcing a Shorts scene contract', async () => {
        const result = await contentBlock.execute(
            {
                keywords: ['KTX', '예매'],
                articles: [{ id: 'source-1', title: 'KTX 기사', url: 'https://example.com', source: 'Example' }],
            },
            { mode: 'explain' }
        );

        expect(openaiAdapter.chatJson).toHaveBeenCalledTimes(1);
        const request = vi.mocked(openaiAdapter.chatJson).mock.calls[0]?.[0];
        expect(request?.systemPrompt).not.toContain('YouTube Shorts');
        expect(request?.systemPrompt).not.toContain('10–15 scene');
        expect(result.output).toMatchObject({
            text: '링크의 핵심은 KTX 예매 수요와 공급 병목입니다.',
            content: '링크의 핵심은 KTX 예매 수요와 공급 병목입니다.',
            value: '링크의 핵심은 KTX 예매 수요와 공급 병목입니다.',
            mode: 'text',
        });
        expect(result.output['scenes']).toBeUndefined();
    });
});
