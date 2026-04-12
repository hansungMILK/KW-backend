import { ApiKeyBulkPutRequestSchema, ApiKeyPutRequestSchema } from '@flows/contracts';

import { maskKey, settingsService } from '../../../services/settings-service';
import { getBody, withMiddleware } from '../../../utils/middleware';
import { ok, unprocessable } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * PUT /settings/api-keys
 *
 * Supports two shapes:
 *   - Single: { provider, apiKey }
 *   - Bulk:   { keys: [{ provider, apiKey }, ...] }
 *
 * Raw key is stored but NEVER returned in the response.
 */
const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const body = getBody<Record<string, unknown>>(event) ?? {};

    // Try bulk first (has 'keys' array)
    if ('keys' in body) {
        const parsed = ApiKeyBulkPutRequestSchema.safeParse(body);
        if (!parsed.success) {
            return unprocessable(`Invalid request: ${parsed.error.errors.map(e => e.message).join(', ')}`);
        }

        const items = [];
        for (const entry of parsed.data.keys) {
            await settingsService.putKey(entry.provider, entry.apiKey);
            items.push({
                provider: entry.provider,
                configured: true as const,
                maskedKey: maskKey(entry.apiKey),
                status: 'unverified' as const,
            });
        }

        return ok({ items });
    }

    // Single key
    const parsed = ApiKeyPutRequestSchema.safeParse(body);
    if (!parsed.success) {
        return unprocessable(`Invalid request: ${parsed.error.errors.map(e => e.message).join(', ')}`);
    }

    const { provider, apiKey } = parsed.data;
    await settingsService.putKey(provider, apiKey);

    return ok({
        provider,
        configured: true,
        maskedKey: maskKey(apiKey),
        status: 'unverified',
    });
};

export const main = withMiddleware(handler);
