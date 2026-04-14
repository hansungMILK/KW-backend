import { assetRepo } from '../../../repositories/asset-repository';
import { runRepo } from '../../../repositories/run-repository';
import { getPathParam, getQueryParam, withMiddleware } from '../../../utils/middleware';
import { badRequest, conflict, notFound, ok, unprocessable } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * GET /workflows/{workflowId}/executions/{executionId}/results
 *
 * #7 최종 결과물 출력 및 다운로드
 * Wraps existing run + asset repositories: workflowId → flowId, executionId → runId.
 */

const ALLOWED_QUALITIES = new Set(['720p', '1080p']);

const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    // #18: reject empty/missing path params before DB lookups
    const workflowId = getPathParam(event, 'workflowId');
    const executionId = getPathParam(event, 'executionId');
    if (!workflowId) return badRequest('workflowId path parameter is required');
    if (!executionId) return badRequest('executionId path parameter is required');

    // #20: strict query validation — if key is present (even with empty value), must be valid.
    // API Gateway omits absent params; an empty value means the caller explicitly sent `?x=`.
    const includeAssetsRaw = getQueryParam(event, 'includeAssets');
    let includeAssets = true;
    if (includeAssetsRaw !== undefined && includeAssetsRaw !== null) {
        if (includeAssetsRaw === 'true') includeAssets = true;
        else if (includeAssetsRaw === 'false') includeAssets = false;
        else return unprocessable('includeAssets must be "true" or "false"');
    }

    const qualityRaw = getQueryParam(event, 'quality');
    if (qualityRaw !== undefined && qualityRaw !== null) {
        if (!ALLOWED_QUALITIES.has(qualityRaw)) {
            return unprocessable(`quality must be one of: ${Array.from(ALLOWED_QUALITIES).join(', ')}`);
        }
    }
    // quality validated but not yet used for filtering — placeholder for future transcode selection

    const run = await runRepo.getRun(executionId);
    if (!run) return notFound(`Execution ${executionId} not found`, 'EXECUTION_NOT_FOUND');

    // Verify workflowId matches run.flowId (do NOT leak other workflows' runs)
    if (run.flowId !== workflowId) {
        return notFound(`Execution ${executionId} not found`, 'EXECUTION_NOT_FOUND');
    }

    // #12: only COMPLETED runs have a final result. Others return 409 so clients don't
    // treat partial state as final.
    if (run.status !== 'COMPLETED') {
        return conflict(
            `Execution is not complete (status=${run.status}). Poll GET /workflows/${workflowId}/execute?executionId=${executionId} for progress.`,
            'RUN_NOT_COMPLETED'
        );
    }

    let assets: Array<Record<string, unknown>> = [];
    if (includeAssets) {
        const assetList = await assetRepo.listByRun(executionId);
        assets = assetList.map(a => {
            // #13: spread metadata FIRST so server-controlled fields cannot be overwritten.
            // Attacker-controlled metadata cannot inject a fake url/type/label/format.
            const serverFields = {
                assetId: a.assetId,
                type: a.assetType?.toLowerCase() ?? 'unknown',
                label: a.assetType ?? 'Asset',
                url: a.publicUrl ?? `https://storage.eureka-flow.com/outputs/${a.assetId}`,
                mimeType: a.mimeType,
                format: a.mimeType?.split('/')[1] ?? 'unknown',
            };
            return { ...(a.metadata ?? {}), ...serverFields };
        });
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
            message: '모든 작업이 완료되어 결과물이 생성되었습니다.',
        },
    });
};

export const main = withMiddleware(handler);
