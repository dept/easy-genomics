import { test, expect, type Page } from 'playwright/test';

const labName = 'Automated Lab - Updated';
const pairedReads = [
  './tests/e2e/fixtures/NA1287820K_R1_001.fastq.gz',
  './tests/e2e/fixtures/NA1287820K_R2_001.fastq.gz',
];
const sameNameFasta = './tests/e2e/fixtures/NA1287820K.fasta';
const sharedFasta = './tests/e2e/fixtures/shared-reference.fa';

async function openSamplesTab(page: Page, baseURL: string): Promise<boolean> {
  await page.goto(`${baseURL}/labs`);
  await page.waitForLoadState('networkidle');

  const hasLab = await page
    .getByRole('row', { name: labName })
    .isVisible()
    .catch(() => false);
  if (!hasLab) {
    console.log(`${labName} not found — skipping FASTA-with-FASTQ import E2E`);
    return false;
  }

  await page.getByRole('row', { name: labName }).getByLabel('Actions').click();
  await page.getByRole('menuitem', { name: 'View / Edit' }).click();
  await page.waitForLoadState('networkidle');
  await page.getByRole('tab', { name: 'Data Collections' }).click();
  await page.waitForLoadState('networkidle');
  return true;
}

// Stops at Review: samples can't be deleted, so the run creates none. The uploaded files stay as unlinked files.
test('01 - Pairs a same-name FASTA with its reads and lists the shared FASTA', async ({ page, baseURL }) => {
  if (!(await openSamplesTab(page, baseURL))) return;

  const importButton = page.getByRole('button', { name: 'Import data' });
  await expect(importButton).toBeVisible({ timeout: 30000 });
  test.skip(await importButton.isDisabled(), 'Lab has no default S3 bucket');
  await importButton.click();

  await page.getByRole('button', { name: /^Upload from computer/ }).click();
  await page.locator('input[type="file"][multiple]').setInputFiles([...pairedReads, sameNameFasta, sharedFasta]);
  await page.getByRole('button', { name: 'Upload & continue to pattern' }).click();
  await expect(page.getByText('How are files grouped?')).toBeVisible({ timeout: 120000 });

  const sharedNotice = page.getByRole('status').filter({ hasText: 'match no sample' }).first();
  await expect(sharedNotice).toContainText('shared-reference.fa');
  await expect(sharedNotice).not.toContainText('NA1287820K.fasta');

  await page.getByRole('button', { name: 'Continue to tags' }).click();
  await page.getByRole('button', { name: 'Continue to review' }).click();
  await expect(page.getByText(/1 paired\s*·\s*1 with FASTA/)).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'match no sample' }).first()).toContainText(
    'shared-reference.fa',
  );
});
