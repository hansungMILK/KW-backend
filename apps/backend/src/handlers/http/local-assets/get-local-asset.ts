import { readFile } from 'fs/promises';

import { getLocalAssetContentType, getLocalAssetPath } from '../../../adapters/aws/s3';
import { isLocalStage } from '../../../config/env';
import { getCorsHeaders, getRequestOrigin } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

export const main = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const corsHeaders = getCorsHeaders(getRequestOrigin(event));
    if (!isLocalStage) {
        return { statusCode: 404, headers: corsHeaders, body: 'Not found' };
    }

    const key = event.pathParameters?.['proxy'];
    if (!key) {
        return { statusCode: 404, headers: corsHeaders, body: 'Not found' };
    }

    try {
        const decodedKey = key
            .split('/')
            .map(part => decodeURIComponent(part))
            .join('/');
        const buffer = await readFile(getLocalAssetPath(decodedKey));
        return {
            statusCode: 200,
            headers: {
                ...corsHeaders,
                'Content-Type': await getLocalAssetContentType(decodedKey),
                'Cache-Control': 'no-store',
            },
            body: buffer.toString('base64'),
            isBase64Encoded: true,
        };
    } catch {
        return { statusCode: 404, headers: corsHeaders, body: 'Not found' };
    }
};
