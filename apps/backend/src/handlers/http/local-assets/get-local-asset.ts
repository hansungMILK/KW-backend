import { readFile } from 'fs/promises';

import { getLocalAssetContentType, getLocalAssetPath } from '../../../adapters/aws/s3';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,x-api-key',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
};

export const main = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const key = event.pathParameters?.['proxy'];
    if (!key) {
        return { statusCode: 404, headers: CORS_HEADERS, body: 'Not found' };
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
                ...CORS_HEADERS,
                'Content-Type': await getLocalAssetContentType(decodedKey),
                'Cache-Control': 'no-store',
            },
            body: buffer.toString('base64'),
            isBase64Encoded: true,
        };
    } catch {
        return { statusCode: 404, headers: CORS_HEADERS, body: 'Not found' };
    }
};
