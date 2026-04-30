import { connectionRepo } from '../../repositories/connection-repository';
import { authorizeApiKeyValue } from '../../utils/auth';
import { log } from '../../utils/logger';

import type { APIGatewayProxyResult } from 'aws-lambda';

/**
 * WebSocket $connect handler.
 * Stores connectionId + subscribed channels (flowIds) in the connections store.
 * Query params: ?x-api-key=...&channels=flowId1,flowId2
 */
export const main = async (event: {
    requestContext: { connectionId: string };
    queryStringParameters?: Record<string, string>;
}): Promise<APIGatewayProxyResult> => {
    const connectionId = event.requestContext.connectionId;
    const auth = authorizeApiKeyValue(event.queryStringParameters?.['x-api-key']);
    if (!auth.ok) {
        log.warn(`WS $connect rejected: ${connectionId}, ${auth.error}`);
        return { statusCode: auth.statusCode, body: auth.message };
    }

    // Support both 'flowId' (product API) and 'channels' (compat) query params
    const flowIdParam = event.queryStringParameters?.flowId ?? '';
    const channelsParam = event.queryStringParameters?.channels ?? '';
    const channels = channelsParam
        .split(',')
        .map(c => c.trim())
        .filter(Boolean);

    // If flowId is provided directly, add it to channels
    if (flowIdParam && !channels.includes(flowIdParam)) {
        channels.unshift(flowIdParam);
    }

    // Use the first channel as the primary flowId (or empty string if none)
    const flowId = channels[0] ?? '';

    const now = new Date().toISOString();
    const ttlSeconds = 24 * 60 * 60; // 24 hours
    const ttl = Math.floor(Date.now() / 1000) + ttlSeconds;

    try {
        await connectionRepo.put({ connectionId, flowId, channels, connectedAt: now, ttl });
        log.info(`WS $connect: ${connectionId}, channels: ${channels.join(',')}`);
    } catch (err) {
        log.error(`WS $connect: failed to store connection ${connectionId}`, err);
        // Still return 200 — API Gateway requires it
    }

    return { statusCode: 200, body: 'Connected' };
};
