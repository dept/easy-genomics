import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.E2E_BASE_URL ?? 'https://quality.dev.easygenomics.org';
const EMAIL = process.env.E2E_EMAIL ?? 'admin@easygenomics.org';
const PASSWORD = process.env.E2E_PASSWORD ?? '123456!Qa';
const RUN_NAME = process.env.E2E_RUN_NAME ?? 'automated-run-creation';
const WORKFLOW_NAME = process.env.E2E_WORKFLOW_NAME ?? 'viralrecon-workflow';
const TYPE_DELAY_MS = Number(process.env.E2E_TYPE_DELAY_MS ?? 80);

const outDir = path.resolve(process.cwd(), 'artifacts', 'quality-login-video');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({
  recordVideo: { dir: outDir, size: { width: 1920, height: 1080 } },
  viewport: { width: 1920, height: 1080 },
});

const page = await context.newPage();
page.setDefaultTimeout(45_000);
page.setDefaultNavigationTimeout(45_000);
try {
  await page.goto(`${BASE_URL}/signin`, { waitUntil: 'domcontentloaded' });
  const email = page.getByLabel('Email');
  await email.click();
  await email.fill('');
  await email.type(EMAIL, { delay: TYPE_DELAY_MS });

  const password = page.getByLabel('Password');
  await password.click();
  await password.fill('');
  await password.type(PASSWORD, { delay: TYPE_DELAY_MS });
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/signin'), { timeout: 45_000 });
  await page.waitForTimeout(2000);

  // Navigate to HealthOmics Workflows via left menu.
  // App provides a stable id for this nav item.
  await page.locator('#tab-omicsWorkflows').click();
  await page.waitForLoadState('networkidle');

  // Clicking the menu redirects to a (test) laboratory context.
  // Find the workflow and open it.
  await page.getByRole('row', { name: new RegExp(WORKFLOW_NAME, 'i') }).click();
  await page.waitForLoadState('networkidle');

  // On the run workflow page, enter run name.
  const runName = page.getByRole('textbox', { name: /run name/i });
  await runName.click();
  await runName.fill('');
  await runName.type(RUN_NAME, { delay: TYPE_DELAY_MS });

  // Let the final state sit on screen in the recording.
  await page.waitForTimeout(2000);
} finally {
  await context.close();
  await browser.close();
}

console.log(`Video(s) written to: ${outDir}`);
