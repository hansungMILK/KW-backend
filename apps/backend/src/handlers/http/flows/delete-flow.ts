import { flowRepo } from '../../../repositories/flow-repository';
import { getPathParam, withMiddleware } from '../../../utils/middleware';
import { badRequest, conflict, notFound, ok } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * DELETE /flows/{flowId}  (audit #7, F-18)
 * Cascade: Messages, Proposals, finished Runs, RunNodes, Traces, Assets, and asset storage objects are deleted.
 * Active runs are rejected so deleted flows cannot keep producing new assets in the background.
 */
const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const flowId = getPathParam(event, 'flowId');
    if (!flowId) return badRequest('Missing flowId');

    const result = await flowRepo.deleteWithCascade(flowId);
    if (!result.deleted && result.activeRunCount > 0) {
        return conflict(
            `Flow ${flowId} has ${result.activeRunCount} active run(s). Cancel or wait for them before deleting.`,
            'FLOW_HAS_ACTIVE_RUNS'
        );
    }
    if (!result.deleted) return notFound(`Flow ${flowId} not found`);

    return ok({
        deleted: true,
        messagesDeleted: result.messagesDeleted,
        proposalsDeleted: result.proposalsDeleted,
        runsDeleted: result.runsDeleted,
        runNodesDeleted: result.runNodesDeleted,
        tracesDeleted: result.tracesDeleted,
        assetsDeleted: result.assetsDeleted,
        storageObjectsDeleted: result.storageObjectsDeleted,
    });
};

export const main = withMiddleware(handler);
