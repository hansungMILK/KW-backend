import { FlowSaveRequestSchema } from '@flows/contracts';

import { flowRepo } from '../../../repositories/flow-repository';
import { wsService } from '../../../services/websocket-service';
import { getBody, getPathParam, withMiddleware } from '../../../utils/middleware';
import { badRequest, notFound, ok } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

type RecordItem = Record<string, unknown>;

const getItemId = (item: unknown): string | null => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const id = (item as RecordItem)['id'];
    return typeof id === 'string' && id.length > 0 ? id : null;
};

const mergeRecord = (existing: RecordItem, patch: RecordItem): RecordItem => {
    const existingData = existing['data'];
    const patchData = patch['data'];
    const existingConfig = existing['config'];
    const patchConfig = patch['config'];

    return {
        ...existing,
        ...patch,
        ...(existingData && typeof existingData === 'object' && !Array.isArray(existingData)
            ? {
                  data:
                      patchData && typeof patchData === 'object' && !Array.isArray(patchData)
                          ? { ...(existingData as RecordItem), ...(patchData as RecordItem) }
                          : existingData,
              }
            : {}),
        ...(patchData && typeof patchData === 'object' && !Array.isArray(patchData) && !existingData
            ? { data: patchData }
            : {}),
        ...(existingConfig && typeof existingConfig === 'object' && !Array.isArray(existingConfig)
            ? {
                  config:
                      patchConfig && typeof patchConfig === 'object' && !Array.isArray(patchConfig)
                          ? { ...(existingConfig as RecordItem), ...(patchConfig as RecordItem) }
                          : existingConfig,
              }
            : {}),
        ...(patchConfig && typeof patchConfig === 'object' && !Array.isArray(patchConfig) && !existingConfig
            ? { config: patchConfig }
            : {}),
    };
};

const applyUpserts = (existingItems: unknown[], patchItems: unknown[]): unknown[] => {
    let result = [...existingItems];

    for (const patch of patchItems) {
        const patchId = getItemId(patch);
        if (!patchId) continue;

        if (patchId.startsWith('#')) {
            const deleteId = patchId.slice(1);
            result = result.filter(item => getItemId(item) !== deleteId);
            continue;
        }

        const patchRecord = patch as RecordItem;
        const index = result.findIndex(item => getItemId(item) === patchId);
        if (index === -1) {
            result.push(patchRecord);
            continue;
        }

        const existing = result[index];
        result[index] =
            existing && typeof existing === 'object' && !Array.isArray(existing)
                ? mergeRecord(existing as RecordItem, patchRecord)
                : patchRecord;
    }

    return result;
};

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

    const nodes = applyUpserts(existing.nodes ?? [], parsed.data.nodes);
    const edges = applyUpserts(existing.edges ?? [], parsed.data.edges);

    const flow = await flowRepo.updateCanvas(id, { nodes, edges });
    if (!flow) return notFound(`Flow ${id} not found`);

    void wsService.broadcastToFlow(id, {
        type: 'flow',
        id,
        timestamp: Date.now(),
    });

    return ok({
        id: flow.id,
        name: flow.name,
        state: flow.state,
        nodes: flow.nodes,
        edges: flow.edges,
        ports: [],
        channelId: flow.id,
    });
};

export const main = withMiddleware(handler);
