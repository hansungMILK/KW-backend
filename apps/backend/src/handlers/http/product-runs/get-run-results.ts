import { assetRepo } from '../../../repositories/asset-repository';
import { runRepo } from '../../../repositories/run-repository';
import { getPathParam, getQueryParam, withMiddleware } from '../../../utils/middleware';
import { badRequest, notFound, ok } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * GET /runs/{runId}/results?includeAssets=true&quality=1080p
 *
 * Product API Task #7 — unified results endpoint.
 * Returns final assets + export options.
 */

const ASSET_TYPE_LABELS: Record<string, string> = {
    VIDEO: '최종 쇼츠 영상',
    IMAGE: '추천 썸네일',
    AUDIO: '음성 파일',
    TEXT: '최종 대본',
    JSON: '메타데이터',
};

const MIME_TO_FORMAT: Record<string, string> = {
    'video/mp4': 'mp4',
    'image/png': 'png',
    'image/jpeg': 'jpeg',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'text/plain': 'txt',
    'application/json': 'json',
};

const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const runId = getPathParam(event, 'runId');
    if (!runId) return badRequest('runId is required');

    const run = await runRepo.getRun(runId);
    if (!run) return notFound(`Run ${runId} not found`, 'RUN_NOT_FOUND');

    const includeAssets = getQueryParam(event, 'includeAssets') !== 'false';
    const quality = getQueryParam(event, 'quality'); // e.g., '720p', '1080p'

    let assets: Array<Record<string, unknown>> = [];

    if (includeAssets) {
        const rawAssets = await assetRepo.listByRun(runId);

        assets = rawAssets
            .filter(a => {
                // Quality filter: only applies to VIDEO assets
                if (quality && a.assetType === 'VIDEO') {
                    const meta = a.metadata as Record<string, unknown> | undefined;
                    const resolution = meta?.resolution as string | undefined;
                    if (resolution && !resolution.includes(quality.replace('p', ''))) {
                        return false;
                    }
                }
                return true;
            })
            .map(a => ({
                assetId: a.assetId,
                type: a.assetType,
                label: ASSET_TYPE_LABELS[a.assetType] ?? a.assetType,
                url: a.publicUrl ?? null,
                format: MIME_TO_FORMAT[a.mimeType] ?? null,
                mimeType: a.mimeType,
                metadata: a.metadata,
            }));
    }

    return ok({
        executionId: run.runId,
        completedAt: run.completedAt ?? null,
        assets,
        exportOptions: {
            youtubeShorts: `/runs/${runId}/export/youtube`,
            tikTok: `/runs/${runId}/export/tiktok`,
        },
        message:
            run.status === 'COMPLETED' ? '모든 작업이 완료되어 결과물이 생성되었습니다.' : `실행 상태: ${run.status}`,
    });
};

export const main = withMiddleware(handler);
