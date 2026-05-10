const readEnv = (name: string, fallback = ''): string => {
    const value = process.env[name];
    if (!value || value === '[object Object]') return fallback;
    return value;
};

const readBoolEnv = (name: string, fallback = false): boolean => {
    const value = readEnv(name).trim();
    if (!value) return fallback;
    return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

const readIntEnv = (name: string, fallback: number, min = 0): number => {
    const value = Number(readEnv(name, String(fallback)));
    if (!Number.isFinite(value)) return fallback;
    return Math.max(min, Math.floor(value));
};

const readNumberEnv = (name: string, fallback: number, min = 0): number => {
    const value = Number(readEnv(name, String(fallback)));
    if (!Number.isFinite(value)) return fallback;
    return Math.max(min, value);
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
    orchestratorMode: readEnv('ORCHESTRATOR_MODE', 'openai'),
    aiProvider: readEnv('AI_PROVIDER', 'openai'),
    s3Bucket: readEnv('S3_BUCKET', 'eureka-flows-local'),
    cdnDomain: readEnv('CLOUDFRONT_DOMAIN', readEnv('CDN_DOMAIN')),
    executionQueueUrl: readEnv('EXECUTION_QUEUE_URL'),
    localQueueMode: readEnv('LOCAL_QUEUE_MODE', 'async'),
    anthropicDefaultModel: readEnv('ANTHROPIC_DEFAULT_MODEL', 'claude-sonnet-4-6'),
    anthropicFastModel: readEnv('ANTHROPIC_FAST_MODEL', 'claude-haiku-4-5-20251001'),
    openaiModel: readEnv('OPENAI_MODEL', readEnv('OPENAI_TEXT_MODEL', 'gpt-5.4-nano')),
    openaiOrchestratorModel: readEnv('OPENAI_ORCHESTRATOR_MODEL', readEnv('OPENAI_MODEL', 'gpt-5.4-nano')),
    openaiVisionModel: readEnv('OPENAI_VISION_MODEL', 'gpt-5.4-nano'),
    openaiSearchModel: readEnv('OPENAI_SEARCH_MODEL', readEnv('OPENAI_MODEL', 'gpt-5.4-nano')),
    openaiBaseUrl: readEnv('OPENAI_BASE_URL', 'https://api.openai.com/v1'),
    openaiTextTimeoutMs: readIntEnv('OPENAI_TEXT_TIMEOUT_MS', 60000, 1),
    allowPaidOpenAI: readBoolEnv('ALLOW_PAID_OPENAI', false),
    maxRunEstimatedCostUsd: readNumberEnv('MAX_RUN_ESTIMATED_COST_USD', 2, 0),
    openaiImageModel: readEnv('OPENAI_IMAGE_MODEL', 'gpt-image-2'),
    openaiImageQuality: readEnv('OPENAI_IMAGE_QUALITY', 'medium'),
    openaiImageTimeoutMs: readIntEnv('OPENAI_IMAGE_TIMEOUT_MS', 120000, 1),
    openaiImageMaxAttempts: readIntEnv('OPENAI_IMAGE_MAX_ATTEMPTS', 1, 1),
    openaiImageSceneTimeoutMs: readIntEnv('OPENAI_IMAGE_SCENE_TIMEOUT_MS', 120000, 1),
    openaiImageSceneMaxAttempts: readIntEnv('OPENAI_IMAGE_SCENE_MAX_ATTEMPTS', 1, 1),
    openaiImageSceneConcurrency: readIntEnv('OPENAI_IMAGE_SCENE_CONCURRENCY', 12, 1),
    openaiTtsModel: readEnv('OPENAI_TTS_MODEL', 'gpt-4o-mini-tts'),
    openaiTtsVoice: readEnv('OPENAI_TTS_VOICE', 'nova'),
    shortsBgmMode: readEnv('SHORTS_BGM_MODE', 'catalog'),
    shortsBgmRequired: readBoolEnv('SHORTS_BGM_REQUIRED', false),
    shortsBgmAssetsDir: readEnv('SHORTS_BGM_ASSETS_DIR', 'assets/bgm'),
    shortsBgmVolume: readNumberEnv('SHORTS_BGM_VOLUME', 0.07, 0),
    nanobananaBaseUrl: readEnv('NANOBANANA_BASE_URL', 'https://www.nananobanana.com/api/v1'),
    nanobananaModel: readEnv('NANOBANANA_MODEL', 'nano-banana'),
} as const;

export const isLocalStage = env.stage === 'local';
