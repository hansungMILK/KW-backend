import { env } from '../../config/env';
import { settingsService } from '../../services/settings-service';

export interface TtsRequest {
    text: string;
    voiceId?: string; // OpenAI voice name
    modelId?: string;
}

export interface TtsResult {
    audioBuffer: Buffer;
    contentType: string;
    estimatedDurationSec: number;
}

export const ttsAdapter = {
    async synthesize(request: TtsRequest): Promise<TtsResult> {
        const apiKey = await settingsService.getKeyForProviderAsync('openai');
        if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

        const response = await fetch(`${env.openaiBaseUrl}/audio/speech`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: request.modelId || env.openaiTtsModel,
                voice: request.voiceId || env.openaiTtsVoice,
                input: request.text.slice(0, 4096),
                response_format: 'mp3',
            }),
        });

        if (!response.ok) {
            const err = await response.text().catch(() => 'unknown');
            throw new Error(`OpenAI TTS error ${response.status}: ${err.slice(0, 200)}`);
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        // Estimate: Korean ~4 chars/sec narration
        const estimatedDurationSec = Math.ceil(request.text.length / 4);

        return { audioBuffer: buffer, contentType: 'audio/mpeg', estimatedDurationSec };
    },
};
