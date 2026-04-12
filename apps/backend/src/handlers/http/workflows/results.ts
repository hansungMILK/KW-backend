import { assetRepo } from '../../../repositories/asset-repository';
import { runRepo } from '../../../repositories/run-repository';
import { getPathParam, getQueryParam, withMiddleware } from '../../../utils/middleware';
import { conflict, notFound, ok } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * GET /workflows/{workflowId}/executions/{executionId}/results
 *
 * #7 최종 결과물 출력 및 다운로드
 * Wraps existing run + asset repositories: workflowId → flowId, executionId → runId.
 */
const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const workflowId = getPathParam(event, 'workflowId') ?? '';
    const executionId = getPathParam(event, 'executionId') ?? '';

    const run = await runRepo.getRun(executionId);
    if (!run) return notFound(`Execution ${executionId} not found`, 'EXECUTION_NOT_FOUND');

    // Verify workflowId matches
    if (run.flowId !== workflowId) {
        return conflict(`Execution ${executionId} does not belong to workflow ${workflowId}`);
    }

    const includeAssets = getQueryParam(event, 'includeAssets') !== 'false';

    let assets: Array<Record<string, unknown>> = [];
    if (includeAssets) {
        const assetList = await assetRepo.listByRun(executionId);
        assets = assetList.map(a => ({
            type: a.assetType?.toLowerCase() ?? 'unknown',
            label: a.assetType ?? 'Asset',
            url: a.publicUrl ?? `https://storage.eureka-flow.com/outputs/${a.assetId}`,
            format: a.mimeType?.split('/')[1] ?? 'unknown',
            ...(a.metadata ?? {}),
        }));
    }

    return ok({
        finalResult: {
            executionId,
            completedAt: run.completedAt ?? null,
            assets,
            exportOptions: {
                youtubeShorts: `/runs/${executionId}/export/youtube`,
                tikTok: `/runs/${executionId}/export/tiktok`,
            },
            message:
                run.status === 'COMPLETED'
                    ? '모든 작업이 완료되어 결과물이 생성되었습니다.'
                    : `실행 상태: ${run.status}`,
        },
    });
};

export const main = withMiddleware(handler);
