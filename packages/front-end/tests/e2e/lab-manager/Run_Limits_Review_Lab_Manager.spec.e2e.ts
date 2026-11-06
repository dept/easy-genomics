/**
 * Review step limit states on a real lab (EGV-382).
 *
 * Preconditions:
 * - 'Automated Lab - Updated' exists, the lab manager is a member, and it has the HealthOmics workflow
 *   'k-florek/workshop-main' (both are set up by the org-admin and lab-manager suites).
 * - The org admin's credentials in easy-genomics.yaml can set the lab's run limits.
 *
 * The lab is shared with Labs_Lab_Manager.spec.e2e.ts, so afterAll clears every limit it set.
 */
import { randomUUID } from 'node:crypto';
import { test, expect, type Browser, type Page } from 'playwright/test';
import type { LaboratoryRunLimits } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { envConfig } from '../../../config/env-config';

const labName = 'Automated Lab - Updated';
const omicsWorkflow = 'k-florek/workshop-main';
// One paired sample (R1 + R2) and one single-end sample: 2 samples.
const sampleFiles = [
  './tests/e2e/fixtures/NA1287820K_R1_001.fastq.gz',
  './tests/e2e/fixtures/NA1287820K_R2_001.fastq.gz',
  './tests/e2e/fixtures/EasyG_File.fastq.gz',
];

let laboratoryId: string | undefined;
let orgAdminIdToken: string | undefined;

/**
 * Signs in as the org admin in a separate context. Only the org admin can set limits, and the lab-manager run
 * signs in only the lab manager, so the org admin's saved auth file may be missing or expired.
 */
async function signInAsOrgAdmin(browser: Browser, baseURL: string): Promise<string> {
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();
  await page.goto(`${baseURL}/signin`);
  await page.getByLabel('Email').fill(envConfig.orgAdminEmail ?? '');
  await page.getByLabel('Password', { exact: true }).fill(envConfig.orgAdminPassword ?? '');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForLoadState('networkidle');
  const idToken = await page.evaluate(
    () => Object.entries(localStorage).find(([key]) => key.endsWith('.idToken'))?.[1],
  );
  await context.close();
  if (!idToken) {
    throw new Error('Org admin sign-in left no Cognito idToken in localStorage');
  }
  return idToken;
}

async function setRunLimits(page: Page, limits: LaboratoryRunLimits): Promise<void> {
  const response = await page.request.put(
    `${envConfig.easyGenomicsApiUrl}/easy-genomics/usage/update-laboratory-run-limits/${laboratoryId}`,
    { headers: { Authorization: `Bearer ${orgAdminIdToken}` }, data: limits },
  );
  expect(response.ok(), `update-laboratory-run-limits returned ${response.status()}`).toBeTruthy();
}

/** Opens the lab and records its id. Returns false when the shared lab is missing. */
async function openLab(page: Page, baseURL: string): Promise<boolean> {
  await page.goto(`${baseURL}/labs`);
  await page.waitForLoadState('networkidle');
  const hasLab = await page
    .getByRole('row', { name: labName })
    .isVisible()
    .catch(() => false);
  if (!hasLab) {
    return false;
  }
  await page.getByRole('row', { name: labName }).locator('button').click();
  await page.getByRole('menuitem', { name: 'View / Edit' }).click();
  await page.waitForLoadState('networkidle');
  laboratoryId = page.url().match(/labs\/([^/?#]+)/)?.[1];
  return !!laboratoryId;
}

/** From the open lab page, runs the HealthOmics wizard with 2 samples up to the review step. Returns the run name. */
async function goToReviewStep(page: Page): Promise<string> {
  const runName = `EG_OMICS_Limits-${randomUUID()}`;
  await page.getByRole('tab', { name: 'HealthOmics Workflows' }).click();
  await page.waitForLoadState('networkidle');
  await page.getByRole('row', { name: omicsWorkflow }).locator('button').click();
  await page.getByRole('menuitem', { name: 'Run' }).click();
  await page.waitForLoadState('networkidle');

  // STEP 01
  await page.getByRole('textbox', { name: 'Run Name*' }).fill(runName);
  await page.getByRole('button', { name: 'Save & Continue' }).click();

  // STEP 02
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose Files' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(sampleFiles);
  await page.getByRole('button', { name: 'Upload Files' }).click();
  await expect(page.getByRole('button', { name: 'Download sample sheet' })).toBeEnabled({ timeout: 60 * 1000 });
  await page.getByRole('button', { name: 'Next step' }).click();

  // STEP 03
  await page.getByRole('button', { name: 'Save & Continue' }).click();

  // STEP 04: wait for the estimate and verdict
  await page.waitForLoadState('networkidle');
  return runName;
}

test.describe.serial('Run limits on the review step', () => {
  test.beforeAll(async ({ browser }) => {
    orgAdminIdToken = await signInAsOrgAdmin(browser, `https://${envConfig.appDomainName}`);
  });

  test.afterAll(async ({ browser }) => {
    if (!laboratoryId) {
      return;
    }
    const context = await browser.newContext();
    const page = await context.newPage();
    await setRunLimits(page, {});
    await context.close();
  });

  test("01 - A run over the sample block amount can't be launched", async ({ page, baseURL }) => {
    const hasLab = await openLab(page, baseURL!);
    test.skip(!hasLab, `${labName} not found; it is created by the org-admin project`);

    await setRunLimits(page, { SamplesBlockAbove: 1 });
    await goToReviewStep(page);

    await expect(page.getByText("This run can't be launched")).toBeVisible();
    await expect(
      page.getByText(
        'It has 2 samples, and this lab allows 1 per run. Split the samples into smaller runs, or ask an organization admin to raise the limit.',
      ),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Launch Workflow Run' })).toBeDisabled();
  });

  test('02 - A run over the cost warn amount can launch anyway', async ({ page, baseURL }) => {
    const hasLab = await openLab(page, baseURL!);
    test.skip(!hasLab, `${labName} not found; it is created by the org-admin project`);

    // The sample warn amount makes the warning certain; the lab may lack the past runs a cost estimate needs.
    await setRunLimits(page, { CostWarnAboveUsd: 0.01, SamplesWarnAbove: 1 });
    const runName = await goToReviewStep(page);

    const launchAnyway = page.getByRole('button', { name: 'Launch anyway' });
    await expect(launchAnyway).toBeEnabled();
    const hasCostEstimate = !(await page.getByText('Not enough runs to estimate').isVisible());
    if (hasCostEstimate) {
      await expect(page.getByText("over this lab's US$0.01 warning amount.")).toBeVisible();
    }

    await launchAnyway.click();
    await page.getByRole('button', { name: 'Back to Runs' }).click();
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('row', { name: runName })).toBeVisible();
  });
});
