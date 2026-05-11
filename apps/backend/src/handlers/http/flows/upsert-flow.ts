import { FlowSaveRequestSchema } from '@flows/contracts';

import { flowRepo } from '../../../repositories/flow-repository';
import { generateNumericId } from '../../../utils/id-generator';
import { getBody, getPathParam, withMiddleware } from '../../../utils/middleware';
import { badRequest, notFound, ok } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * POST /flows/{id}/upsert
 * Caller: libs/flows/src/api/flows.ts → upsertFlow()
 *
 * Batch update nodes/edges for an existing flow.
 * Same request/response shape as save.
 */
const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const id = getPathParam(event, 'id');
    if (!id) return badRequest('Missing flow ID');

    const existing = await flowRepo.get(id);
    if (!existing) return notFound(`Flow ${id} not found`);

    const body = getBody(event);
    const parsed = FlowSaveRequestSchema.safeParse(body);
    if (!parsed.success) return badRequest(`Invalid body: ${parsed.error.message}`);

    // True merge: update matched nodes/edges by id, add new ones, keep unmentioned ones
    const existingNodes = (existing.nodes as Array<Record<string, unknown>>) ?? [];
    const existingEdges = (existing.edges as Array<Record<string, unknown>>) ?? [];

    const createdNodeIds: string[] = [];
    const mergedNodes = [...existingNodes];
    for (const incoming of parsed.data.nodes as Array<Record<string, unknown>>) {
        // Assign server ID to new nodes that don't have one yet
        if (!incoming.id || typeof incoming.id !== 'string') {
            incoming.id = generateNumericId();
            createdNodeIds.push(incoming.id);
        }
        const idx = mergedNodes.findIndex(n => n.id === incoming.id);
        if (idx !== -1) {
            mergedNodes[idx] = { ...mergedNodes[idx], ...incoming };
        } else {
            mergedNodes.push(incoming);
        }
    }

    const createdEdgeIds: string[] = [];
    const mergedEdges = [...existingEdges];
    for (const incoming of parsed.data.edges as Array<Record<string, unknown>>) {
        // Skip self-loop edges (corrupted data: source === target)
        if (incoming.sourceNodeId && incoming.sourceNodeId === incoming.targetNodeId) continue;
        // Assign server ID to new edges that don't have one yet
        if (!incoming.id || typeof incoming.id !== 'string') {
            incoming.id = generateNumericId();
            createdEdgeIds.push(incoming.id);
        }
        const idx = mergedEdges.findIndex(e => e.id === incoming.id);
        if (idx !== -1) {
            mergedEdges[idx] = { ...mergedEdges[idx], ...incoming };
        } else {
            mergedEdges.push(incoming);
        }
    }

    const flow = await flowRepo.save(id, mergedNodes, mergedEdges);

    return ok({
        id: flow.id,
        name: flow.name,
        state: flow.state,
        nodes: flow.nodes,
        edges: flow.edges,
        ports: [],
        // Explicitly report which node/edge IDs were newly created
        ...(createdNodeIds.length > 0 && { createdNodeId: createdNodeIds[0] }),
        ...(createdEdgeIds.length > 0 && { createdEdgeId: createdEdgeIds[0] }),
    });
};

export const main = withMiddleware(handler);
