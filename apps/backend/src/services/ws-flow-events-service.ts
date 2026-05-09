import { wsService } from './websocket-service';
import { flowRepo } from '../repositories/flow-repository';

type BroadcastNodePortOptions = {
    splitOutputPorts?: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value != null && typeof value === 'object' && !Array.isArray(value);

const toPortPacket = (value: unknown, timestamp: number): Record<string, unknown> => {
    if (isRecord(value) && 'value' in value && typeof value['type'] === 'string') {
        return {
            value: value['value'],
            type: value['type'],
            timestamp,
        };
    }

    return {
        value,
        type: typeof value === 'string' ? 'text' : 'json',
        timestamp,
    };
};

/**
 * Broadcast `flow` update event to all subscribers of the flow's channel.
 * Clients re-fetch the latest canvas via GET /flows/{flowId} on receipt.
 * Called after any successful spec canvas write.
 */
export async function broadcastFlowUpdated(flowId: string): Promise<void> {
    await wsService.broadcastToFlow(flowId, {
        type: 'flow',
        id: flowId,
        timestamp: Date.now(),
    });
}

/**
 * Update output port data$ in flow.nodes[] and broadcast `node/port` events.
 * Clients re-fetch the latest flow via GET /flows/{flowId} on receipt.
 * Called after node execution completes with non-empty output.
 */
export async function broadcastNodePortUpdated(
    flowId: string,
    nodeId: string,
    output: Record<string, unknown>,
    options: BroadcastNodePortOptions = {}
): Promise<void> {
    if (Object.keys(output).length === 0) return;
    try {
        const flow = await flowRepo.get(flowId);
        if (!flow) return;

        const now = Date.now();
        const updatedPortNames = new Set<string>();
        const outputByPort = options.splitOutputPorts ? output : { out: output };
        const desiredPorts = Object.keys(outputByPort).length > 0 ? Object.keys(outputByPort) : ['out'];
        const currentNodes = Array.isArray(flow.nodes) ? (flow.nodes as Array<Record<string, unknown>>) : [];

        const updatedNodes = currentNodes.map(node => {
            if (node['stereo'] === 'port' && node['parentId'] === nodeId && node['direction'] === 'out') {
                const portName = (node['name'] as string) || 'out';
                if (!desiredPorts.includes(portName)) return node;
                updatedPortNames.add(portName);
                const value = portName in outputByPort ? outputByPort[portName] : outputByPort['out'];
                const packet = toPortPacket(value, now);
                return { ...node, dataType: packet['type'], data$: packet };
            }
            return node;
        });

        for (const portName of desiredPorts) {
            if (updatedPortNames.has(portName)) continue;
            const value = portName in outputByPort ? outputByPort[portName] : outputByPort['out'];
            const packet = toPortPacket(value, now);
            updatedPortNames.add(portName);
            updatedNodes.push({
                id: `port_${nodeId}_out_${portName}`,
                stereo: 'port',
                parentId: nodeId,
                direction: 'out',
                name: portName,
                dataType: packet['type'],
                data$: packet,
            });
        }

        if (updatedPortNames.size === 0) return;

        await flowRepo.updateCanvas(
            flowId,
            { nodes: updatedNodes, edges: flow.edges ?? [] },
            { preservePortNodes: false }
        );

        for (const portName of updatedPortNames) {
            await wsService.broadcastToFlow(flowId, {
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
