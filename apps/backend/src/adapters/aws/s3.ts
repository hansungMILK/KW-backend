import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { env } from '../../config/env';

const s3 = new S3Client({
    region: env.awsRegion,
});

const BUCKET = env.s3Bucket;

export const getS3Uri = (key: string): string => `s3://${BUCKET}/${key}`;

export const getPublicUrl = (key: string): string => {
    const domain = env.cdnDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    if (!domain) return getS3Uri(key);
    return `https://${domain}/${key.split('/').map(encodeURIComponent).join('/')}`;
};

export const publicUrlFromS3Uri = (uri: string): string => {
    const key = uri.replace(/^s3:\/\/[^/]+\//, '');
    return getPublicUrl(key);
};

export const getObject = async (key: string) => {
    const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
    return s3.send(cmd);
};

export const putObject = async (key: string, body: Buffer | string, contentType: string) => {
    const cmd = new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType });
    return s3.send(cmd);
};

export { BUCKET, s3 };
