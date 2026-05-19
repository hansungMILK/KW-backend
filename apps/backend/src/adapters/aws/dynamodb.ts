import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { env, isAwsExecutionEnvironment, isLocalStage } from '../../config/env';

const USE_REAL_DYNAMO = !!env.dynamodbEndpoint || !isLocalStage;
const USE_LOCAL_FILE_DB = !USE_REAL_DYNAMO && !isAwsExecutionEnvironment;

const REQUIRED_REAL_DYNAMO_TABLES = [
    ['FLOWS_TABLE', env.flowsTable],
    ['CONNECTIONS_TABLE', env.connectionsTable],
    ['RUNS_TABLE', env.runsTable],
    ['RUN_NODES_TABLE', env.runNodesTable],
    ['MESSAGES_TABLE', env.messagesTable],
    ['PROPOSALS_TABLE', env.proposalsTable],
    ['TRACES_TABLE', env.tracesTable],
    ['ASSETS_TABLE', env.assetsTable],
    ['SETTINGS_TABLE', env.settingsTable],
] as const;

const hasUsableRemoteTableName = (value: string): boolean =>
    !!value && value !== '[object Object]' && !value.endsWith('-local');

const assertRealDynamoConfigured = (): void => {
    if (!USE_REAL_DYNAMO || isLocalStage) return;

    const missing = REQUIRED_REAL_DYNAMO_TABLES.filter(([, value]) => !hasUsableRemoteTableName(value)).map(
        ([name]) => name
    );
    if (missing.length > 0) {
        throw new Error(
            `[dynamodb] real DynamoDB is selected for stage "${env.stage}", but required table env vars are missing: ${missing.join(', ')}`
        );
    }
};

assertRealDynamoConfigured();

// ============================================================================
// Real DynamoDB client (for dev/prod or when DYNAMODB_ENDPOINT is set)
// ============================================================================

let _docClient: DynamoDBDocumentClient | null = null;

export const getDocClient = (): DynamoDBDocumentClient => {
    if (!_docClient) {
        const client = new DynamoDBClient({
            region: env.awsRegion,
            ...(env.dynamodbEndpoint ? { endpoint: env.dynamodbEndpoint } : {}),
        });
        _docClient = DynamoDBDocumentClient.from(client, {
            marshallOptions: { removeUndefinedValues: true },
        });
    }
    return _docClient;
};

// ============================================================================
// File-based store (for local dev without Docker/DynamoDB Local)
// serverless-offline runs each handler in a separate invocation,
// so in-memory Maps don't persist between calls. File-based does.
// ============================================================================

const DATA_DIR = join(process.cwd(), '.local-db');

export const assertLocalFileDbAllowed = (): void => {
    if (isAwsExecutionEnvironment) {
        throw new Error(
            '[dynamodb] local file database is disabled in AWS Lambda. ' +
                'Configure DynamoDB/SQS/S3 resources for this stage instead of falling back to .local-db.'
        );
    }
    if (USE_REAL_DYNAMO) {
        throw new Error(
            '[dynamodb] local file database is disabled when real DynamoDB is selected. ' +
                'Check repository adapter selection for this stage.'
        );
    }
};

const ensureDir = () => {
    assertLocalFileDbAllowed();
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
};

const tablePath = (tableName: string) => join(DATA_DIR, `${tableName}.json`);

const readTable = (tableName: string): Record<string, Record<string, unknown>> => {
    ensureDir();
    const p = tablePath(tableName);
    if (!existsSync(p)) return {};
    try {
        return JSON.parse(readFileSync(p, 'utf-8'));
    } catch {
        return {};
    }
};

const writeTable = (tableName: string, data: Record<string, Record<string, unknown>>) => {
    ensureDir();
    writeFileSync(tablePath(tableName), JSON.stringify(data, null, 2));
};

export const memDb = {
    get(tableName: string, key: string): Record<string, unknown> | undefined {
        return readTable(tableName)[key];
    },

    put(tableName: string, key: string, item: Record<string, unknown>): void {
        const data = readTable(tableName);
        data[key] = item;
        writeTable(tableName, data);
    },

    delete(tableName: string, key: string): void {
        const data = readTable(tableName);
        delete data[key];
        writeTable(tableName, data);
    },

    scan(tableName: string): Record<string, unknown>[] {
        return Object.values(readTable(tableName));
    },

    query(tableName: string, filterFn: (item: Record<string, unknown>) => boolean): Record<string, unknown>[] {
        return this.scan(tableName).filter(filterFn);
    },
};

// ============================================================================
// Table names
// ============================================================================

export const TableNames = {
    flows: env.flowsTable,
    connections: env.connectionsTable,
    runs: env.runsTable,
    runNodes: env.runNodesTable,
    messages: env.messagesTable,
    proposals: env.proposalsTable,
    traces: env.tracesTable,
    assets: env.assetsTable,
    settings: env.settingsTable,
} as const;

export { USE_LOCAL_FILE_DB, USE_REAL_DYNAMO };
