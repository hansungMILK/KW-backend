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
    const envEndpoint =
        process.env.WS_CALLBACK_ENDPOINT && process.env.WS_CALLBACK_ENDPOINT !== '[object Object]'
            ? process.env.WS_CALLBACK_ENDPOINT
            : '';
    if (envEndpoint) {
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

    const action = (parsed as Record<string, unknown>)?.action;

    if (action === 'ping') {
        log.info(`WS ping from ${connectionId}`);
        try {
            await postToConnection(connectionId, {
                type: 'pong',
            });
        } catch (err) {
            log.warn(`WS pong failed for ${connectionId}`, err);
        }
    }

    return { statusCode: 200, body: '' };
};
