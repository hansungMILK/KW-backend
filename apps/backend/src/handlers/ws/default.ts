import { initWsClient, postToConnection } from '../../adapters/aws/websocket-api';
import { log } from '../../utils/logger';

import type { APIGatewayProxyResult } from 'aws-lambda';

/**
 * WebSocket $default handler.
 * Handles ping messages and responds with pong.
 */
export const main = async (event: {
    requestContext: { connectionId: string; domainName?: string; stage?: string };
    body?: string;
}): Promise<APIGatewayProxyResult> => {
    const connectionId = event.requestContext.connectionId;

    // Initialize the WS client.
    // Prefer WS_CALLBACK_ENDPOINT env var when set (local serverless-offline),
    // otherwise build from event.requestContext (prod API Gateway).
    const envEndpoint = process.env.WS_CALLBACK_ENDPOINT ?? '';
    if (envEndpoint || process.env.STAGE === 'local' || process.env.IS_OFFLINE === 'true') {
        initWsClient(envEndpoint);
    } else if (event.requestContext.domainName && event.requestContext.stage) {
        const endpoint = `https://${event.requestContext.domainName}/${event.requestContext.stage}`;
        initWsClient(endpoint);
    }

    let parsed: unknown;
    try {
        parsed = event.body ? JSON.parse(event.body) : {};
    } catch {
        parsed = {};
    }

    const message =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    const action = message.action;

    if (action === 'ping') {
        log.info(`WS ping from ${connectionId}`);
        const data = message.data && typeof message.data === 'object' ? (message.data as Record<string, unknown>) : {};
        const timestamp = typeof data.timestamp === 'number' ? data.timestamp : Date.now();
        try {
            await postToConnection(connectionId, {
                type: 'system',
                action: 'pong',
                data: { timestamp },
                ts: new Date().toISOString(),
            });
        } catch (err) {
            log.warn(`WS pong failed for ${connectionId}`, err);
        }
    }

    if (action === 'info') {
        try {
            await postToConnection(connectionId, {
                type: 'system',
                action: 'info',
                data: { id: connectionId, connectionId },
                ts: new Date().toISOString(),
            });
        } catch (err) {
            log.warn(`WS info response failed for ${connectionId}`, err);
        }
    }

    return { statusCode: 200, body: '' };
};
