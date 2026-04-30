import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';

import { log } from '../../utils/logger';

let wsClient: ApiGatewayManagementApiClient | null = null;

export const initWsClient = (endpoint: string) => {
    const resolvedEndpoint = normalizeEndpoint(endpoint);
    if (!resolvedEndpoint) return;

    // Local serverless-offline uses `https://localhost:<port>/local` or similar —
    // the SDK's credential provider chain throws without dummy creds, so we inject them.
    const isLocal =
        resolvedEndpoint.includes('localhost') ||
        resolvedEndpoint.includes('127.0.0.1') ||
        resolvedEndpoint.startsWith('http://');
    wsClient = new ApiGatewayManagementApiClient({
        endpoint: resolvedEndpoint,
        region: process.env.AWS_REGION || 'ap-northeast-2',
        ...(isLocal
            ? {
                  credentials: {
                      accessKeyId: 'local',
                      secretAccessKey: 'local',
                  },
              }
            : {}),
    });
};

/**
 * Lazy init from env var when the WS client has not been explicitly initialized.
 * Used so the HTTP Lambda process (which never receives a WS event and therefore
 * never hits initWsClient from handlers/ws/default.ts) can still broadcast to
 * connected clients via serverless-offline's local WS mgmt endpoint.
 *
 * Env var: WS_CALLBACK_ENDPOINT (e.g., http://localhost:8801 for serverless-offline)
 */
function ensureClient(): ApiGatewayManagementApiClient | null {
    if (wsClient) return wsClient;
    const endpoint = normalizeEndpoint(process.env.WS_CALLBACK_ENDPOINT);
    if (!endpoint) return null;
    const isLocal = endpoint.startsWith('http://localhost') || endpoint.startsWith('http://127.0.0.1');
    wsClient = new ApiGatewayManagementApiClient({
        endpoint,
        region: process.env.AWS_REGION || 'ap-northeast-2',
        // Local serverless-offline has no IAM — inject dummy credentials so the
        // SDK's credential provider chain does not throw.
        ...(isLocal
            ? {
                  credentials: {
                      accessKeyId: 'local',
                      secretAccessKey: 'local',
                  },
              }
            : {}),
    });
    return wsClient;
}

export const postToConnection = async (connectionId: string, data: unknown): Promise<boolean> => {
    const client = ensureClient();
    if (!client) {
        log.warn('WebSocket client not initialized (set WS_CALLBACK_ENDPOINT or call initWsClient)');
        return false;
    }
    try {
        await client.send(
            new PostToConnectionCommand({
                ConnectionId: connectionId,
                Data: Buffer.from(JSON.stringify(data)),
            })
        );
        return true;
    } catch (err: unknown) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 410) {
            log.info(`Stale connection: ${connectionId}`);
            return false; // connection gone — caller should clean up
        }
        log.error(`Failed to post to ${connectionId}`, err);
        return false;
    }
};

function normalizeEndpoint(endpoint?: string): string {
    const raw = endpoint && endpoint !== '[object Object]' ? endpoint : '';
    if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
    if (process.env.STAGE === 'local' || !process.env.STAGE) return 'http://localhost:8801';
    return '';
}
