import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { dirname, extname, join, resolve } from 'path';

import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { env, isLocalStage } from '../../config/env';

const s3 = new S3Client({
    region: env.awsRegion,
});

const BUCKET = env.s3Bucket;
const LOCAL_ASSETS_DIR = resolve(process.cwd(), '.local-assets');
const LOCAL_ASSET_BASE_URL = process.env.LOCAL_ASSET_BASE_URL || 'http://localhost:8800/_local-assets';

const hasUsableRemoteBucketName = (value: string): boolean =>
    !!value && value !== '[object Object]' && value !== 'eureka-flows-local';

const assertRemoteS3Configured = (): void => {
    if (isLocalStage) return;
    if (!hasUsableRemoteBucketName(BUCKET)) {
        throw new Error(
            `[s3] S3_BUCKET is required for stage "${env.stage}". ` +
                'Remote stages must use S3 instead of falling back to local asset storage.'
        );
    }
};

export const getS3Uri = (key: string): string => {
    assertRemoteS3Configured();
    return `s3://${BUCKET}/${key}`;
};

export const getPublicUrl = (key: string): string => {
    if (isLocalStage) return `${LOCAL_ASSET_BASE_URL.replace(/\/+$/, '')}/${encodePath(key)}`;
    assertRemoteS3Configured();

    const domain = env.cdnDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    if (!domain) return getS3Uri(key);
    return `https://${domain}/${key.split('/').map(encodeURIComponent).join('/')}`;
};

export const publicUrlFromS3Uri = (uri: string): string => {
    const key = uri.replace(/^s3:\/\/[^/]+\//, '');
    return getPublicUrl(key);
};

export const getObject = async (key: string) => {
    if (isLocalStage) {
        return { Body: await readFile(getLocalAssetPath(key)) };
    }
    assertRemoteS3Configured();

    const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
    return s3.send(cmd);
};

export const putObject = async (key: string, body: Buffer | string, contentType: string) => {
    if (isLocalStage) {
        const filePath = getLocalAssetPath(key);
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, body);
        await writeFile(`${filePath}.metadata.json`, JSON.stringify({ contentType }));
        return { localPath: filePath };
    }
    assertRemoteS3Configured();

    const cmd = new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType });
    return s3.send(cmd);
};

export const deleteObject = async (key: string) => {
    if (isLocalStage) {
        const filePath = getLocalAssetPath(key);
        await rm(filePath, { force: true });
        await rm(`${filePath}.metadata.json`, { force: true });
        return;
    }
    assertRemoteS3Configured();

    const cmd = new DeleteObjectCommand({ Bucket: BUCKET, Key: key });
    await s3.send(cmd);
};

export const getLocalAssetPath = (key: string): string => {
    const safeKey = key
        .split('/')
        .filter(part => part && part !== '.' && part !== '..')
        .join('/');
    const fullPath = resolve(join(LOCAL_ASSETS_DIR, safeKey));
    if (!fullPath.startsWith(`${LOCAL_ASSETS_DIR}/`) && fullPath !== LOCAL_ASSETS_DIR) {
        throw new Error(`Invalid local asset key: ${key}`);
    }
    return fullPath;
};

export const getLocalAssetContentType = async (key: string): Promise<string> => {
    const filePath = getLocalAssetPath(key);
    try {
        const metadata = JSON.parse(await readFile(`${filePath}.metadata.json`, 'utf8')) as { contentType?: string };
        if (metadata.contentType) return metadata.contentType;
    } catch {
        /* fall back to extension */
    }

    const ext = extname(filePath).toLowerCase();
    if (ext === '.png') return 'image/png';
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.mp3') return 'audio/mpeg';
    if (ext === '.mp4') return 'video/mp4';
    return 'application/octet-stream';
};

function encodePath(key: string): string {
    return key.split('/').map(encodeURIComponent).join('/');
}

export { BUCKET, s3 };
