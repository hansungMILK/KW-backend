import { FlowSaveRequestSchema } from '@flows/contracts';

import { flowRepo } from '../../../repositories/flow-repository';
import { wsService } from '../../../services/websocket-service';
import { getBody, getPathParam, withMiddleware } from '../../../utils/middleware';
import { badRequest, notFound, ok } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * POST /flows/{id}/save
 * Caller: libs/flows/src/api/flows.ts → saveFlow() / createFlow()
 *
 * id="0" → create new flow
 * Body: { nodes: NodeData[], edges: EdgeData[] }
 * Returns: SaveFlowView
 */
const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const id = getPathParam(event, 'id');
    if (!id) return badRequest('Missing flow ID');

    const body = getBody(event);
    const parsed = FlowSaveRequestSchema.safeParse(body);
    if (!parsed.success) return badRequest(`Invalid body: ${parsed.error.message}`);

    const flow =
        id === '0'
            ? await flowRepo.create({ title: 'Untitled Flow' })
            : await flowRepo.updateCanvas(id, { nodes: parsed.data.nodes, edges: parsed.data.edges });

    if (!flow) return notFound(`Flow ${id} not found`);

    const saved =
        id === '0' && (parsed.data.nodes.length > 0 || parsed.data.edges.length > 0)
            ? await flowRepo.updateCanvas(flow.id, { nodes: parsed.data.nodes, edges: parsed.data.edges })
            : flow;

    if (!saved) return notFound(`Flow ${flow.id} not found after create`);

    // Broadcast only for updates — new flows have no subscribers yet
    if (id !== '0') {
        await wsService.broadcastToFlow(saved.id, {
            type: 'flow',
            id: saved.id,
            timestamp: Date.now(),
        });
    }

    return ok({
        id: saved.id,
        name: saved.name,
        state: saved.state,
        nodes: saved.nodes,
        edges: saved.edges,
        ports: [],
        channelId: saved.id,
    });
};

export const main = withMiddleware(handler);
