import { defineConfig, devices } from '@playwright/test';

/**
 * Browser acceptance against the real stack: Keycloak (infra/compose.yaml), PostgreSQL,
 * the API serving the built web app, and the worker. The e2e database is recreated
 * and seeded with fictional data before each run (global-setup.ts).
 */
const PORT = 3100;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const dbEnv = { ULYSSE_DB_NAME: 'ulysse_e2e' };

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: `http://localhost:${String(PORT)}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
    },
    {
      name: 'mobile',
      use: {
        ...devices['Pixel 7'],
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
      grep: /@mobile/,
    },
  ],
  webServer: [
    {
      command: 'node --env-file-if-exists=../../.env --conditions=ulysse-source ../api/src/main.ts',
      url: `http://localhost:${String(PORT)}/health/ready`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...dbEnv,
        API_PORT: String(PORT),
        PUBLIC_ORIGIN: `http://localhost:${String(PORT)}`,
        WEB_DIST_DIR: 'dist',
        LOG_LEVEL: 'warn',
      },
    },
    {
      command:
        'node --env-file-if-exists=../../.env --conditions=ulysse-source ../worker/src/main.ts',
      url: 'http://127.0.0.1:3101/health/ready',
      reuseExistingServer: false,
      timeout: 120_000,
      env: { ...dbEnv, WORKER_HTTP_PORT: '3101', OUTBOX_POLL_MS: '300', LOG_LEVEL: 'warn' },
    },
  ],
});
