import type { PlaywrightTestConfig } from '@playwright/test';
import { environments, getE2EEnvironment } from './tests/e2e/helpers/env';

const activeEnv = getE2EEnvironment();
const { baseURL, name: envName } = environments[activeEnv];

/**
 * Base URLs by environment:
 * - QA  → https://quality.dev.easygenomics.org  (E2E_ENV=qa)
 * - UAT → https://quality.uat.easygenomics.org  (E2E_ENV=uat)
 *
 * Select environment with: E2E_ENV=qa|uat (defaults to qa)
 */
const config: PlaywrightTestConfig = {
  testDir: './tests/e2e',
  timeout: 100 * 1000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 1,
  use: {
    actionTimeout: 0,
    baseURL,
    trace: 'on-first-retry',
    headless: true,
    screenshot: 'only-on-failure',
    // Optional: PLAYWRIGHT_CHANNEL=chrome when bundled Chromium is unavailable locally.
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
  },
  metadata: {
    environment: envName,
    baseURL,
  },
  projects: [
    {
      name: 'smoke',
      testMatch: 'tests/e2e/smoke/**/*.spec.e2e.ts',
      use: { baseURL },
    },
    {
      name: 'sys-admin',
      testMatch: 'tests/e2e/sys-admin/*.spec.e2e.ts',
      use: { baseURL },
    },
    {
      name: 'org-admin',
      testMatch: 'tests/e2e/org-admin/*.spec.e2e.ts',
      use: { baseURL },
    },
    {
      name: 'lab-manager',
      testMatch: 'tests/e2e/lab-manager/*.spec.e2e.ts',
      use: { baseURL },
    },
    {
      name: 'lab-technician',
      testMatch: 'tests/e2e/lab-technician/*.spec.e2e.ts',
      use: { baseURL },
    },
  ],
  reporter:
    process.env.CI && process.env.SLACK_E2E_TEST_WEBHOOK_URL
      ? [
          [
            './node_modules/playwright-slack-report/dist/src/SlackReporter.js',
            {
              slackWebHookUrl: process.env.SLACK_E2E_TEST_WEBHOOK_URL,
              sendResults: 'always',
              meta: [
                { key: 'environment', value: envName },
                { key: 'baseURL', value: baseURL },
                { key: 'runNumber', value: process.env.GITHUB_RUN_NUMBER },
                { key: 'sha', value: process.env.GITHUB_SHA },
              ],
            },
          ],
          ['dot'],
        ]
      : [['html', { outputDir: './playwright-report' }]],
};

export default config;
