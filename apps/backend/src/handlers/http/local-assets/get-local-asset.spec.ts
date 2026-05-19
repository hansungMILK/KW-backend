import { afterEach, describe, expect, it, vi } from 'vitest';

import type { APIGatewayProxyEvent } from 'aws-lambda';

afterEach(() => {
    vi.doUnmock('../../../config/env');
    vi.resetModules();
});

describe('local asset handler boundary', () => {
    it('does not read local asset files outside local/offline stage', async () => {
        vi.doMock('../../../config/env', () => ({
            env: {
                awsRegion: 'ap-northeast-2',
                cdnDomain: 'cdn.example.com',
                s3Bucket: 'eureka-flows-backend-assets-dev',
                stage: 'dev',
            },
            isLocalStage: false,
        }));

        const { main } = await import('./get-local-asset');
        const response = await main({
            headers: {},
            pathParameters: { proxy: 'images/test.png' },
        } as unknown as APIGatewayProxyEvent);

        expect(response.statusCode).toBe(404);
        expect(response.body).toBe('Not found');
    });
});
