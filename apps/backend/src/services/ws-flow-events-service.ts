import { wsService } from './websocket-service';
import { flowRepo } from '../repositories/flow-repository';

/**
 * Broadcast `flow` update event to all subscribers of the flow's channel.
 * Clients re-fetch the latest canvas via GET /flows/{id}/load on receipt.
 * Called after any successful canvas write (PUT /flows, save, upsert).
 */
export function broadcastFlowUpdated(flowId: string): void {
    void wsService.broadcastToFlow(flowId, {
        type: 'flow',
        id: flowId,
        timestamp: Date.now(),
    });
}

/**
 * Update output port data$ in flow.nodes[] and broadcast `node/port` events.
 * Clients re-fetch port data via GET /nodes/{portId}/port on receipt.
 * Called after node execution completes with non-empty output.
 */
export async function broadcastNodePortUpdated(
    flowId: string,
    nodeId: string,
    output: Record<string, unknown>
): Promise<void> {
    if (Object.keys(output).length === 0) return;
    try {
        const flow = await flowRepo.get(flowId);
        if (!flow) return;

        const now = Date.now();
        const updatedPortNames: string[] = [];

        const updatedNodes = (flow.nodes as Array<Record<string, unknown>>).map(node => {
            if (node['stereo'] === 'port' && node['parentId'] === nodeId && node['direction'] === 'out') {
                updatedPortNames.push((node['name'] as string) || 'out');
                return { ...node, data$: { value: output, type: 'object', timestamp: now } };
            }
            return node;
        });

        if (updatedPortNames.length === 0) return;

        await flowRepo.save(flowId, updatedNodes, flow.edges);

        for (const portName of updatedPortNames) {
            void wsService.broadcastToFlow(flowId, {
                type: 'node/port',
                id: `${nodeId}:${portName}@out`,
                flowId,
                timestamp: now,
            });
        }
    } catch {
        /* non-fatal — WS delivery is best-effort */
    }
}
