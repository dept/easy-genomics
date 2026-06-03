import { defineConfig } from '@playwright/test';

/**
 * Minimal config for quality-dev scripted flows.
 * Intentionally avoids the repo's globalSetup (role storageState generation).
 *
 * Headless HD recording: deviceScaleFactor 2 + 1920×1080 viewport and video size.
 * Use headed mode locally with video off (see package scripts or --headed).
 */
export default defineConfig({
  testDir: './',
  timeout: 300_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    headless: true,
    deviceScaleFactor: 2,
    viewport: { width: 1920, height: 1080 },
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    video: {
      mode: 'on',
      size: { width: 1920, height: 1080 },
    },
  },
});

