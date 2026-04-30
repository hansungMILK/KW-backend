import { env } from '../../config/env';
import { settingsService } from '../../services/settings-service';
import { log } from '../../utils/logger';

export interface ImageGenerationRequest {
    prompt: string;
    width?: number;
    height?: number;
    style?: string;
}

export interface ImageGenerationResult {
    imageBuffer?: Buffer;
    imageUrl?: string;
    contentType: string;
    width: number;
    height: number;
}

const openAIImageSizeFor = (width: number, height: number): { size: string; width: number; height: number } => {
    if (width > height) return { size: '1536x1024', width: 1536, height: 1024 };
    if (height > width) return { size: '1024x1536', width: 1024, height: 1536 };
    return { size: '1024x1024', width: 1024, height: 1024 };
};

export const imageAdapter = {
    async generate(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
        const apiKey = await settingsService.getKeyForProviderAsync('openai');
        if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

        const width = request.width || 1080;
        const height = request.height || 1920;
        const size = openAIImageSizeFor(width, height);

        log.info('OpenAI image generation', {
            model: env.openaiImageModel,
            promptLength: request.prompt.length,
            size: size.size,
            quality: env.openaiImageQuality,
        });

        const response = await fetch(`${env.openaiBaseUrl}/images/generations`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: env.openaiImageModel,
                prompt: request.prompt,
                n: 1,
                size: size.size,
                quality: env.openaiImageQuality,
                output_format: 'png',
            }),
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => 'unknown');
            throw new Error(`OpenAI image API error ${response.status}: ${errText.slice(0, 200)}`);
        }

        const data = (await response.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
        const first = data.data?.[0];
        if (!first?.b64_json && !first?.url) throw new Error('OpenAI returned no image data');

        const imageBuffer = first.b64_json ? Buffer.from(first.b64_json, 'base64') : undefined;

        return { imageBuffer, imageUrl: first.url, contentType: 'image/png', width: size.width, height: size.height };
    },
};
