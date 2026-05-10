import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests/e2e',
    timeout: 60000,
    expect: {
        timeout: 10000,
    },
    reporter: [['list']],
    use: {
        baseURL: 'http://127.0.0.1:3001',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
});
