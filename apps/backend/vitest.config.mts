import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    root,
    test: {
        env: {
            STAGE: 'local',
            AWS_EXECUTION_ENV: '',
            LAMBDA_TASK_ROOT: '',
            DYNAMODB_ENDPOINT: '',
        },
        environment: 'node',
        include: ['src/**/*.spec.ts'],
    },
});
