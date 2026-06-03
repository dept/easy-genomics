import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.E2E_BASE_URL ?? 'https://quality.dev.easygenomics.org';
const EMAIL = process.env.E2E_EMAIL ?? 'admin@easygenomics.org';
const PASSWORD = process.env.E2E_PASSWORD ?? '123456!Qa';

const outDir = path.resolve(process.cwd(), 'artifacts', 'quality-login-video');
fs.mkdirSync(outDir, { recursive: true });

const ts = new Date().toISOString().replace(/[:.]/g, '-');
const userDataDir = path.join(outDir, `pw-user-data-${ts}`);

const context = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  recordVideo: { dir: outDir, size: { width: 1280, height: 720 } },
  viewport: { width: 1280, height: 720 },
});

const page = await context.newPage();
try {
  await page.goto(`${BASE_URL}/signin`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  // Wait until we leave /signin (or time out).
  await page.waitForURL((url) => !url.pathname.startsWith('/signin'), { timeout: 45_000 });
  await page.waitForTimeout(1500); // give the post-login page a moment to settle in the video
} finally {
  await context.close();
}

console.log(`Video(s) written to: ${outDir}`);
