import { postToConnection } from '../adapters/aws/websocket-api';
import { connectionRepo } from '../repositories/connection-repository';
import { log } from '../utils/logger';

/**
 * WebSocket broadcast service.
 * Sends events to all connections subscribed to a flow's channel.
 *
 * Event format: events are sent directly as-is (e.g., {type: "run.started", runId, ...}).
 * No wrapper envelope — the event itself is the message payload.
 * This matches the product API spec: client receives raw typed events.
 *
 * IMPORTANT: Failures must never throw or break the caller.
 */
export const wsService = {
    async broadcastToFlow(flowId: string, event: unknown): Promise<void> {
        try {
            const connections = await connectionRepo.listByChannel(flowId);
            for (const conn of connections) {
                try {
                    // Send event directly — no {action, data, channel} wrapper
                    const success = await postToConnection(conn.connectionId, event);
                    if (!success) {
                        try {
                            await connectionRepo.delete(conn.connectionId);
                        } catch (cleanupErr) {
                            log.warn(`[ws-service] Failed to clean stale connection ${conn.connectionId}`, cleanupErr);
                        }
                    }
                } catch (sendErr) {
                    log.warn(`[ws-service] Failed to send to connection ${conn.connectionId}`, sendErr);
                }
            }
        } catch (err) {
            log.warn('[ws-service] broadcastToFlow error (non-fatal)', err);
        }
    },
};
