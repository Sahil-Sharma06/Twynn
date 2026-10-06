import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the real stack: the API (with Docker Postgres and Redis from
 * `npm run setup`), the Vite dashboard and a mock OpenAI-compatible provider.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node e2e/mock-upstream.mjs',
      url: 'http://localhost:4010',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run dev -w @twynn/api',
      url: 'http://localhost:3000/health',
      reuseExistingServer: !process.env.CI,
      // Every test signs up from localhost; lift the per-address sign-up limit for the run.
      env: { TWYNN_SIGNUPS_PER_IP_PER_HOUR: '100000' },
    },
    {
      command: 'npm run dev -w @twynn/web',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
