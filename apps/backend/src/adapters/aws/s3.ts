import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { env } from '../../config/env';

const s3 = new S3Client({
    region: env.awsRegion,
});

const BUCKET = env.s3Bucket;

export const getObject = async (key: string) => {
    const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
    return s3.send(cmd);
};

export const putObject = async (key: string, body: Buffer | string, contentType: string) => {
    const cmd = new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType });
    return s3.send(cmd);
};

export { BUCKET, s3 };
