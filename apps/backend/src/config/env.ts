const readEnv = (name: string, fallback = ''): string => {
    return process.env[name] || fallback;
};

/**
 * Keep backend runtime configuration in one place.
 * Add new environment variables here first.
 */
export const env = {
    stage: readEnv('STAGE', 'local'),
    awsRegion: readEnv('AWS_REGION', 'ap-northeast-2'),
    dynamodbEndpoint: readEnv('DYNAMODB_ENDPOINT'),
    flowsTable: readEnv('FLOWS_TABLE', 'eureka-flows-backend-flows-local'),
    connectionsTable: readEnv('CONNECTIONS_TABLE', 'eureka-flows-backend-connections-local'),
    orchestratorMode: readEnv('ORCHESTRATOR_MODE', 'mock'),
    s3Bucket: readEnv('S3_BUCKET', 'eureka-flows-local'),
} as const;

export const isLocalStage = env.stage === 'local';
