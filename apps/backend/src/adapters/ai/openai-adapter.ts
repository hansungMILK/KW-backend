import { env } from '../../config/env';
import { settingsService } from '../../services/settings-service';
import { log } from '../../utils/logger';

export interface OpenAIJsonRequest {
    systemPrompt: string;
    userMessage: string;
    model?: string;
    maxTokens?: number;
}

export interface OpenAIJsonResponse {
    content: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
}

export interface OpenAIVisionJsonRequest extends OpenAIJsonRequest {
    imageUrl: string;
}

interface ChatCompletionResponse {
    model?: string;
    choices?: Array<{ message?: { content?: string } }>;
    usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
    };
    error?: { message?: string };
}

interface ResponsesApiResponse {
    model?: string;
    output_text?: string;
    output?: Array<{
        type?: string;
        content?: Array<{ type?: string; text?: string }>;
    }>;
    usage?: {
        input_tokens?: number;
        output_tokens?: number;
    };
    error?: { message?: string };
}

export const openaiAdapter = {
    async chatJson(request: OpenAIJsonRequest): Promise<OpenAIJsonResponse> {
        const apiKey = await settingsService.getKeyForProviderAsync('openai');
        if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

        const model = request.model ?? env.openaiModel;
        const start = Date.now();

        log.info('OpenAI API call', {
            model,
            maxTokens: request.maxTokens,
            systemPromptLength: request.systemPrompt.length,
            userMessageLength: request.userMessage.length,
        });

        const response = await fetch(`${env.openaiBaseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: request.systemPrompt },
                    { role: 'user', content: request.userMessage },
                ],
                response_format: { type: 'json_object' },
                max_completion_tokens: request.maxTokens ?? 1024,
            }),
        });

        const body = (await response.json().catch(() => ({}))) as ChatCompletionResponse;
        if (!response.ok) {
            throw new Error(`OpenAI API error ${response.status}: ${body.error?.message ?? 'request failed'}`);
        }

        const content = body.choices?.[0]?.message?.content;
        if (!content) throw new Error('OpenAI returned no message content');

        const latencyMs = Date.now() - start;
        log.info('OpenAI API response', {
            model: body.model ?? model,
            inputTokens: body.usage?.prompt_tokens ?? 0,
            outputTokens: body.usage?.completion_tokens ?? 0,
            latencyMs,
            contentLength: content.length,
        });

        return {
            content,
            model: body.model ?? model,
            inputTokens: body.usage?.prompt_tokens ?? 0,
            outputTokens: body.usage?.completion_tokens ?? 0,
            latencyMs,
        };
    },

    async webSearchJson(request: OpenAIJsonRequest): Promise<OpenAIJsonResponse> {
        const apiKey = await settingsService.getKeyForProviderAsync('openai');
        if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

        const model = request.model ?? env.openaiSearchModel;
        const start = Date.now();

        log.info('OpenAI web search API call', {
            model,
            maxTokens: request.maxTokens,
            systemPromptLength: request.systemPrompt.length,
            userMessageLength: request.userMessage.length,
        });

        const response = await fetch(`${env.openaiBaseUrl}/responses`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model,
                tools: [{ type: 'web_search' }],
                tool_choice: 'required',
                input: [
                    { role: 'system', content: request.systemPrompt },
                    { role: 'user', content: request.userMessage },
                ],
                max_output_tokens: request.maxTokens ?? 2048,
            }),
        });

        const body = (await response.json().catch(() => ({}))) as ResponsesApiResponse;
        if (!response.ok) {
            throw new Error(
                `OpenAI web search API error ${response.status}: ${body.error?.message ?? 'request failed'}`
            );
        }

        const content = extractResponseText(body);
        if (!content) throw new Error('OpenAI web search returned no text content');

        return {
            content,
            model: body.model ?? model,
            inputTokens: body.usage?.input_tokens ?? 0,
            outputTokens: body.usage?.output_tokens ?? 0,
            latencyMs: Date.now() - start,
        };
    },

    async visionJson(request: OpenAIVisionJsonRequest): Promise<OpenAIJsonResponse> {
        const apiKey = await settingsService.getKeyForProviderAsync('openai');
        if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

        const model = request.model ?? env.openaiVisionModel;
        const start = Date.now();

        log.info('OpenAI vision API call', {
            model,
            maxTokens: request.maxTokens,
            systemPromptLength: request.systemPrompt.length,
            userMessageLength: request.userMessage.length,
        });

        const response = await fetch(`${env.openaiBaseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: request.systemPrompt },
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: request.userMessage },
                            { type: 'image_url', image_url: { url: request.imageUrl } },
                        ],
                    },
                ],
                response_format: { type: 'json_object' },
                max_completion_tokens: request.maxTokens ?? 1024,
            }),
        });

        const body = (await response.json().catch(() => ({}))) as ChatCompletionResponse;
        if (!response.ok) {
            throw new Error(`OpenAI vision API error ${response.status}: ${body.error?.message ?? 'request failed'}`);
        }

        const content = body.choices?.[0]?.message?.content;
        if (!content) throw new Error('OpenAI vision returned no message content');

        return {
            content,
            model: body.model ?? model,
            inputTokens: body.usage?.prompt_tokens ?? 0,
            outputTokens: body.usage?.completion_tokens ?? 0,
            latencyMs: Date.now() - start,
        };
    },
};

function extractResponseText(body: ResponsesApiResponse): string {
    if (body.output_text) return body.output_text;

    const parts: string[] = [];
    for (const item of body.output ?? []) {
        for (const content of item.content ?? []) {
            if (content.type === 'output_text' && content.text) parts.push(content.text);
        }
    }
    return parts.join('\n').trim();
}
