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
    runsTable: readEnv('RUNS_TABLE', 'eureka-flows-backend-runs-local'),
    runNodesTable: readEnv('RUN_NODES_TABLE', 'eureka-flows-backend-run-nodes-local'),
    messagesTable: readEnv('MESSAGES_TABLE', 'eureka-flows-backend-messages-local'),
    proposalsTable: readEnv('PROPOSALS_TABLE', 'eureka-flows-backend-proposals-local'),
    tracesTable: readEnv('TRACES_TABLE', 'eureka-flows-backend-traces-local'),
    assetsTable: readEnv('ASSETS_TABLE', 'eureka-flows-backend-assets-local'),
    settingsTable: readEnv('SETTINGS_TABLE', 'eureka-flows-backend-settings-local'),
    orchestratorMode: readEnv('ORCHESTRATOR_MODE', 'mock'),
    s3Bucket: readEnv('S3_BUCKET', 'eureka-flows-local'),
} as const;

export const isLocalStage = env.stage === 'local';
