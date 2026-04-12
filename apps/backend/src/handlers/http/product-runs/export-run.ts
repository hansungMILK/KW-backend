import { RunExportParamsSchema } from '@flows/contracts';

import { exportAdapter } from '../../../adapters/external/export-adapter';
import { assetRepo } from '../../../repositories/asset-repository';
import { runRepo } from '../../../repositories/run-repository';
import { getPathParam, withMiddleware } from '../../../utils/middleware';
import { badRequest, notFound, ok } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * POST /runs/{runId}/export/{platform}
 *
 * Product API — export run results to external platform.
 * Uses exportAdapter which checks for platform credentials
 * and calls the real API when configured.
 */
const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const runId = getPathParam(event, 'runId');
    const platform = getPathParam(event, 'platform');

    const parsed = RunExportParamsSchema.safeParse({ runId, platform });
    if (!parsed.success) return badRequest(`Invalid params: ${parsed.error.message}`);

    const run = await runRepo.getRun(parsed.data.runId);
    if (!run) return notFound(`Run ${runId} not found`, 'RUN_NOT_FOUND');

    if (run.status !== 'COMPLETED') return badRequest(`Run is ${run.status}, only COMPLETED runs can be exported`);

    const assets = await assetRepo.listByRun(parsed.data.runId);
    const videoAsset = assets.find(a => a.assetType === 'VIDEO');
    const videoUrl = videoAsset?.publicUrl ?? '';

    // Call export adapter
    const exportResult =
        parsed.data.platform === 'youtube'
            ? await exportAdapter.publishToYouTube(videoUrl, { runId: parsed.data.runId, flowId: run.flowId })
            : await exportAdapter.publishToTikTok(videoUrl, { runId: parsed.data.runId, flowId: run.flowId });

    return ok({
        exportId: `export-${runId}-${parsed.data.platform}`,
        runId: parsed.data.runId,
        platform: parsed.data.platform,
        status: exportResult.success ? 'completed' : 'ready',
        videoUrl: videoAsset?.publicUrl ?? null,
        assetCount: assets.length,
        externalId: exportResult.externalId ?? null,
        externalUrl: exportResult.externalUrl ?? null,
        message: exportResult.message,
    });
};

export const main = withMiddleware(handler);
