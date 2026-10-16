import { test, expect, type Page } from 'playwright/test';

const labName = 'Automated Lab - Updated';

async function openFilesTab(page: Page, baseURL: string): Promise<boolean> {
  await page.goto(`${baseURL}/labs`);
  await page.waitForLoadState('networkidle');

  const hasLab = await page
    .getByRole('row', { name: labName })
    .isVisible()
    .catch(() => false);
  if (!hasLab) {
    console.log(`${labName} not found — skipping add-to-sample E2E`);
    return false;
  }

  await page.getByRole('row', { name: labName }).locator('button').click();
  await page.getByRole('menuitem', { name: 'View / Edit' }).click();
  await page.waitForLoadState('networkidle');
  await page.getByRole('tab', { name: 'Data Collections' }).click();
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: /^Files\b/ }).click();
  await page.waitForLoadState('networkidle');
  return true;
}

test('01 - Adds an unlinked file to an existing sample', async ({ page, baseURL }) => {
  if (!(await openFilesTab(page, baseURL))) return;

  const fileCheckbox = page.getByRole('checkbox', { name: /^Select file / }).first();
  const hasUnlinkedFile = await fileCheckbox.isVisible({ timeout: 30000 }).catch(() => false);
  test.skip(!hasUnlinkedFile, 'No unlinked files in the lab — see TESTING.md (EGV-328) to re-seed');

  const fileName = ((await fileCheckbox.getAttribute('aria-label')) ?? '').replace(/^Select file /, '');
  await fileCheckbox.check();

  const addButton = page.getByRole('button', { name: 'Add to sample' });
  test.skip(await addButton.isDisabled(), 'Lab has no samples to add files to');
  await addButton.click();

  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /Select sample/ }).click();
  await page.getByRole('option').first().click();
  await dialog.getByRole('button', { name: 'Add files' }).click();

  await expect(page.getByText(/^Added 1 file\(s\) to .+\.$/)).toBeVisible();
  await expect(page.getByRole('checkbox', { name: `Select file ${fileName}` })).toHaveCount(0);
});
