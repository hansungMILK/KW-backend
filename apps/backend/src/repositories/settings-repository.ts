import { DecryptCommand, EncryptCommand, KMSClient } from '@aws-sdk/client-kms';
import { DeleteCommand, GetCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

import { TableNames, USE_REAL_DYNAMO, getDocClient, memDb } from '../adapters/aws/dynamodb';

import type { ApiKeyProvider } from '@flows/contracts';

/**
 * Settings repository — persists API key records per provider.
 *
 * Encryption policy:
 * - Any environment that writes to real DynamoDB (USE_REAL_DYNAMO) MUST use KMS.
 *   Derived from DYNAMODB_ENDPOINT/STAGE, so the check does not depend on
 *   matching the literal stage name "prod" (production / prod-us / live / …
 *   all behave the same — if they hit real AWS, they require KMS).
 * - Base64 is only permitted when USE_REAL_DYNAMO is false (local/offline dev),
 *   OR when the operator explicitly opts in via ALLOW_INSECURE_SETTINGS=true.
 *   The escape hatch exists so a disposable preview stage can run without KMS,
 *   but it has to be a deliberate, auditable env var — not a silent fallback.
 *
 * Storage:
 * - USE_REAL_DYNAMO=false → file-based memDb
 * - USE_REAL_DYNAMO=true  → DynamoDB (SettingsTable)
 */

const TABLE = USE_REAL_DYNAMO ? TableNames.settings : 'settings';
const RAW_KMS_KEY_ID = process.env.KMS_KEY_ID || '';
const KMS_KEY_ID = RAW_KMS_KEY_ID && RAW_KMS_KEY_ID !== '[object Object]' ? RAW_KMS_KEY_ID : '';
const ALLOW_INSECURE_SETTINGS = process.env.ALLOW_INSECURE_SETTINGS === 'true';

// Real KMS is used only when writing to real DynamoDB. serverless-offline can
// stringify CloudFormation objects into env values, so local dev must not treat
// those placeholders as usable KMS keys.
const USE_KMS = USE_REAL_DYNAMO && !!KMS_KEY_ID;

// Fail-fast: if we're writing to real DynamoDB we must either have KMS or the
// operator must have explicitly accepted insecure base64 storage. Refuse to
// start otherwise so API keys are never silently written as base64 to real DB.
if (USE_REAL_DYNAMO && !USE_KMS && !ALLOW_INSECURE_SETTINGS) {
    throw new Error(
        '[settings-repository] FATAL: USE_REAL_DYNAMO is true but KMS_KEY_ID is not set. ' +
            'API keys would be written to real DynamoDB with base64-only "encryption". ' +
            'Set KMS_KEY_ID to a real KMS key, or set ALLOW_INSECURE_SETTINGS=true ' +
            'to explicitly opt in (NOT recommended outside disposable preview stages).'
    );
}

let _kmsClient: KMSClient | null = null;
const getKmsClient = (): KMSClient => {
    if (!_kmsClient) {
        _kmsClient = new KMSClient({ region: process.env.AWS_REGION || 'ap-northeast-2' });
    }
    return _kmsClient;
};

// ============================================================================
// Encryption — KMS in prod, base64 in local/dev
// ============================================================================

async function encryptKey(rawKey: string): Promise<string> {
    if (!USE_KMS) {
        return Buffer.from(rawKey, 'utf-8').toString('base64');
    }
    const result = await getKmsClient().send(
        new EncryptCommand({
            KeyId: KMS_KEY_ID,
            Plaintext: Buffer.from(rawKey, 'utf-8'),
        })
    );
    if (!result.CiphertextBlob) throw new Error('KMS encrypt returned empty ciphertext');
    return Buffer.from(result.CiphertextBlob).toString('base64');
}

async function decryptKey(storedKey: string): Promise<string> {
    if (!USE_KMS) {
        return Buffer.from(storedKey, 'base64').toString('utf-8');
    }
    const result = await getKmsClient().send(
        new DecryptCommand({
            CiphertextBlob: Buffer.from(storedKey, 'base64'),
        })
    );
    if (!result.Plaintext) throw new Error('KMS decrypt returned empty plaintext');
    return Buffer.from(result.Plaintext).toString('utf-8');
}

// ============================================================================
// Record type
// ============================================================================

export interface SettingsRecord {
    provider: ApiKeyProvider;
    encryptedKey: string;
    maskedKey: string;
    status: 'active' | 'invalid' | 'unverified';
    lastVerifiedAt: string | null;
    updatedAt: string;
}

// ============================================================================
// Repository — dual path: memDb (local) / DynamoDB (prod)
// ============================================================================

export const settingsRepo = {
    getKey(provider: ApiKeyProvider): SettingsRecord | null {
        if (!USE_REAL_DYNAMO) {
            return (memDb.get(TABLE, provider) as unknown as SettingsRecord) ?? null;
        }
        // DynamoDB: synchronous access not possible — this method stays sync for now.
        // In prod, callers should use getKeyAsync() below.
        return (memDb.get(TABLE, provider) as unknown as SettingsRecord) ?? null;
    },

    async getKeyAsync(provider: ApiKeyProvider): Promise<SettingsRecord | null> {
        if (!USE_REAL_DYNAMO) {
            return (memDb.get(TABLE, provider) as unknown as SettingsRecord) ?? null;
        }
        const result = await getDocClient().send(
            new GetCommand({
                TableName: TABLE,
                Key: { provider },
            })
        );
        return (result.Item as SettingsRecord) ?? null;
    },

    /** @deprecated Use getDecryptedKeyAsync in prod. Sync fallback for local only. */
    getDecryptedKey(provider: ApiKeyProvider): string | null {
        if (USE_KMS) return null; // KMS decrypt is async — must use getDecryptedKeyAsync
        const record = this.getKey(provider);
        if (!record?.encryptedKey) return null;
        // local only: base64 decode is sync-safe
        return Buffer.from(record.encryptedKey, 'base64').toString('utf-8');
    },

    async getDecryptedKeyAsync(provider: ApiKeyProvider): Promise<string | null> {
        const record = await this.getKeyAsync(provider);
        if (!record?.encryptedKey) return null;
        return await decryptKey(record.encryptedKey);
    },

    async putKey(provider: ApiKeyProvider, rawKey: string, maskedKey: string): Promise<void> {
        const now = new Date().toISOString();
        const existing = await this.getKeyAsync(provider);
        const record: SettingsRecord = {
            provider,
            encryptedKey: await encryptKey(rawKey),
            maskedKey,
            status: 'unverified',
            lastVerifiedAt: existing?.lastVerifiedAt ?? null,
            updatedAt: now,
        };
        if (!USE_REAL_DYNAMO) {
            memDb.put(TABLE, provider, record as unknown as Record<string, unknown>);
            return;
        }
        await getDocClient().send(new PutCommand({ TableName: TABLE, Item: record }));
    },

    async deleteKey(provider: ApiKeyProvider): Promise<void> {
        if (!USE_REAL_DYNAMO) {
            memDb.delete(TABLE, provider);
            return;
        }
        await getDocClient().send(new DeleteCommand({ TableName: TABLE, Key: { provider } }));
    },

    async listAll(): Promise<SettingsRecord[]> {
        if (!USE_REAL_DYNAMO) {
            return memDb.scan(TABLE) as unknown as SettingsRecord[];
        }
        const result = await getDocClient().send(new ScanCommand({ TableName: TABLE }));
        return (result.Items || []) as SettingsRecord[];
    },

    async updateStatus(provider: ApiKeyProvider, status: 'active' | 'invalid', lastVerifiedAt: string): Promise<void> {
        const existing = await this.getKeyAsync(provider);
        if (!existing) return;
        const record: SettingsRecord = {
            ...existing,
            status,
            lastVerifiedAt,
            updatedAt: new Date().toISOString(),
        };
        if (!USE_REAL_DYNAMO) {
            memDb.put(TABLE, provider, record as unknown as Record<string, unknown>);
            return;
        }
        await getDocClient().send(new PutCommand({ TableName: TABLE, Item: record }));
    },
};
