import { expect, test } from '@playwright/test';
import path from 'node:path';

/**
 * Quality-dev scripted flow (built incrementally).
 *
 * Config via env vars (so OSS users can plug in their own):
 * - E2E_BASE_URL (default: https://quality.uat.easygenomics.org)
 * - E2E_EMAIL
 * - E2E_PASSWORD
 * - E2E_WORKFLOW_NAME (default: viralrecon-workflow)
 * - E2E_RUN_NAME (default: automated-run-creation)
 * - E2E_TYPE_DELAY_MS (default: 80)
 * - E2E_VIS_PAUSE_MS (default: 1500) — pauses around button clicks only
 */

const BASE_URL = process.env.E2E_BASE_URL ?? 'https://quality.uat.easygenomics.org';
const EMAIL = process.env.E2E_EMAIL ?? 'admin@easygenomics.org';
const PASSWORD = process.env.E2E_PASSWORD ?? 'EasyGenomicsUAT2026!';
const WORKFLOW_NAME = process.env.E2E_WORKFLOW_NAME ?? 'viralrecon-workflow';
const RUN_NAME = process.env.E2E_RUN_NAME ?? 'automated-run-creation';
const TYPE_DELAY_MS = Number(process.env.E2E_TYPE_DELAY_MS ?? 80);
const VIS_PAUSE_MS = Number(process.env.E2E_VIS_PAUSE_MS ?? 1500);
const HOVER_PAUSE_MS = Number(process.env.E2E_HOVER_PAUSE_MS ?? 500);
const UPLOAD_COMPLETE_TIMEOUT_MS = Number(process.env.E2E_UPLOAD_COMPLETE_TIMEOUT_MS ?? 180_000);
const PARAMS_REVIEW_PAUSE_MS = 5_000;
const SCROLL_STEP_PX = 80;
const SCROLL_STEP_MS = 50;
const LAUNCH_SETTLE_MS = 4_000;
const END_SCREEN_PAUSE_MS = 5_000;
const UI_LOAD_PAUSE_MS = 1_500;
const DASHBOARD_LOAD_PAUSE_MS = 7_000;
const BEFORE_BACK_TO_RUNS_MS = 2_000;
const WORKFLOW_PARAMS: Record<string, string> = {
  genome: 'MN908947.3',
  protocol: 'amplicon',
  primer_set_version: '5.3.2',
  primer_set: 'artic',
  platform: 'illumina',
};
const FIXTURE_FILES =
  process.env.E2E_FIXTURE_FILES?.split(',').map((s) => s.trim()).filter(Boolean) ?? [
    'tests/e2e/fixtures/1DXJQC_R1_.fastq.gz',
    'tests/e2e/fixtures/1DXJQC_R2_.fastq.gz',
    'tests/e2e/fixtures/SVYGHR_R1_.fastq.gz',
    'tests/e2e/fixtures/SVYGHR_R2_.fastq.gz',
    'tests/e2e/fixtures/YB6H7Z_R1_.fastq.gz',
    'tests/e2e/fixtures/YB6H7Z_R2_.fastq.gz',
  ];

test.describe('quality-dev: HealthOmics run creation (scripted)', () => {
  test('login -> launch HealthOmics workflow run (scripted)', async ({ page }) => {
    page.setDefaultTimeout(45_000);
    page.setDefaultNavigationTimeout(45_000);

    const visPause = async (label: string) => {
      // VIS-PAUSE: button clicks only; remove/reduce once flow is stable.
      await test.step(`VIS-PAUSE ${label} (${VIS_PAUSE_MS}ms)`, async () => {
        await page.waitForTimeout(VIS_PAUSE_MS);
      });
    };

    const hoverPause = async (label: string) => {
      await test.step(`HOVER-PAUSE ${label} (${HOVER_PAUSE_MS}ms)`, async () => {
        await page.waitForTimeout(HOVER_PAUSE_MS);
      });
    };

    const prepForClick = async (locator: ReturnType<typeof page.locator>, label: string) => {
      await locator.scrollIntoViewIfNeeded();
      await locator.hover();
      await hoverPause(`before click: ${label}`);
    };

    const clickButton = async (locator: ReturnType<typeof page.locator>, label: string) => {
      await visPause(`before click ${label}`);
      await prepForClick(locator, label);
      await locator.click();
      await visPause(`after click ${label}`);
    };

    const clickNav = async (locator: ReturnType<typeof page.locator>, label: string) => {
      await prepForClick(locator, label);
      await locator.click();
    };

    const typeIntoField = async (locator: ReturnType<typeof page.locator>, value: string) => {
      await locator.scrollIntoViewIfNeeded();
      await locator.click();
      await locator.fill('');
      await locator.type(value, { delay: TYPE_DELAY_MS });
    };

    const slowScrollDown = async () => {
      await test.step('slow scroll down (upload step)', async () => {
        for (let i = 0; i < 50; i++) {
          await page.mouse.wheel(0, SCROLL_STEP_PX);
          await page.waitForTimeout(SCROLL_STEP_MS);
          const atBottom = await page.evaluate(
            () => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2,
          );
          if (atBottom) break;
        }
      });
    };

    const visible = (locator: ReturnType<typeof page.locator>) => locator.filter({ visible: true });

    const uiLoadPause = async (label: string) => {
      await test.step(`UI load pause ${label} (${UI_LOAD_PAUSE_MS}ms)`, async () => {
        await page.waitForTimeout(UI_LOAD_PAUSE_MS);
      });
    };

    const setWorkflowParameter = async (paramName: string, value: string) => {
      const field = visible(page.getByLabel(paramName, { exact: true })).first();
      await expect(field).toBeVisible();

      const role = await field.getAttribute('role');
      const tagName = (await field.evaluate((el) => el.tagName)).toLowerCase();

      if (tagName === 'button' || role === 'combobox') {
        await clickButton(field, paramName);
        await page.getByRole('option', { name: value, exact: true }).click();
      } else {
        await typeIntoField(field, value);
      }
    };

    // Login (instant fill — no slow type)
    await page.goto(`${BASE_URL}/signin`, { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await clickButton(page.getByRole('button', { name: /sign in/i }), 'Sign in');
    await page.waitForURL((url) => !url.pathname.startsWith('/signin'), { timeout: 45_000 });

    await test.step(`dashboard load pause (${DASHBOARD_LOAD_PAUSE_MS}ms)`, async () => {
      await page.waitForTimeout(DASHBOARD_LOAD_PAUSE_MS);
    });

    // Navigate to HealthOmics Workflows (sidebar button on UAT; legacy tab id on older layouts)
    const healthOmicsNav = page
      .getByRole('button', { name: 'HealthOmics Workflows' })
      .or(page.getByRole('tab', { name: 'HealthOmics Workflows' }))
      .or(page.locator('#tab-omicsWorkflows'));
    await expect(healthOmicsNav.first()).toBeVisible();
    await clickNav(healthOmicsNav.first(), 'HealthOmics Workflows');
    await page.waitForLoadState('networkidle');

    // Find workflow (table row) and open it
    const workflowRow = page.getByRole('row', { name: new RegExp(WORKFLOW_NAME, 'i') });
    await uiLoadPause(`before workflow row: ${WORKFLOW_NAME}`);
    await expect(workflowRow).toBeVisible();
    await clickNav(workflowRow, `workflow row: ${WORKFLOW_NAME}`);
    await page.waitForLoadState('networkidle');

    // Run name
    const runName = visible(page.getByRole('textbox', { name: /run name/i })).first();
    await expect(runName).toBeVisible();
    await typeIntoField(runName, RUN_NAME);

    await clickButton(visible(page.getByRole('button', { name: 'Save & Continue', exact: true })).first(), 'Save & Continue');
    await page.waitForLoadState('networkidle');

    // Upload FASTQ files via dropzoneFiles (hidden input — setInputFiles only, no click pauses)
    // Hidden file input — do not filter by visible
    const dropzone = page.locator('#dropzoneFiles').first();
    await expect(dropzone).toBeAttached();
    const files = FIXTURE_FILES.map((p) => path.resolve(process.cwd(), p));
    await dropzone.setInputFiles(files);

    const uploadFilesButton = visible(page.getByRole('button', { name: 'Upload Files' })).first();
    await expect(uploadFilesButton).toBeEnabled({ timeout: 30_000 });
    await clickButton(uploadFilesButton, 'Upload Files');

    const nextStepButton = visible(page.getByRole('button', { name: 'Next step' })).first();
    await expect(nextStepButton).toBeEnabled({ timeout: UPLOAD_COMPLETE_TIMEOUT_MS });
    await slowScrollDown();
    await clickButton(nextStepButton, 'Next step');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.spinner-container')).toHaveCount(0, { timeout: 90_000 });

    // Step 03: Edit Parameters (viralrecon) — input/outdir auto-populated from upload
    await expect(page.getByRole('heading', { name: 'Edit Parameters' })).toBeVisible({ timeout: 90_000 });
    const parametersInput = page.getByRole('textbox', { name: 'input*' });
    const parametersOutdir = page.getByRole('textbox', { name: 'outdir*' });
    await expect(parametersInput).toHaveValue(/s3:\/\//, { timeout: 60_000 });
    await expect(parametersOutdir).toHaveValue(/s3:\/\//, { timeout: 60_000 });

    for (const [paramName, value] of Object.entries(WORKFLOW_PARAMS)) {
      await setWorkflowParameter(paramName, value);
    }

    await test.step(`review parameters pause (${PARAMS_REVIEW_PAUSE_MS}ms)`, async () => {
      await page.waitForTimeout(PARAMS_REVIEW_PAUSE_MS);
    });

    await clickButton(visible(page.getByRole('button', { name: 'Save & Continue', exact: true })).last(), 'Save & Continue (parameters)');
    await expect(page.locator('.spinner-container')).toHaveCount(0, { timeout: 90_000 });
    await expect(visible(page.getByText('Step 04')).first()).toBeVisible({ timeout: 60_000 });

    const launchButton = visible(page.getByRole('button', { name: 'Launch Workflow Run' })).first();
    await expect(launchButton).toBeVisible({ timeout: 60_000 });
    await clickButton(launchButton, 'Launch Workflow Run');
    await page.waitForTimeout(LAUNCH_SETTLE_MS);
    const backToRunsButton = visible(page.getByRole('button', { name: 'Back to Runs' })).first();
    await expect(backToRunsButton).toBeVisible({ timeout: 60_000 });

    await test.step(`delay before Back to Runs (${BEFORE_BACK_TO_RUNS_MS}ms)`, async () => {
      await page.waitForTimeout(BEFORE_BACK_TO_RUNS_MS);
    });
    await clickButton(backToRunsButton, 'Back to Runs');

    await test.step(`hold final screen (${END_SCREEN_PAUSE_MS}ms)`, async () => {
      await page.waitForTimeout(END_SCREEN_PAUSE_MS);
    });
  });
});
