import { test, expect, type Locator } from 'playwright/test';

const orgName = 'Default Organization';

async function firstUntickedWholeBucketBox(boxes: Locator): Promise<Locator | undefined> {
  const count = await boxes.count();
  for (let i = 0; i < count; i++) {
    const box = boxes.nth(i);
    if ((await box.isEnabled()) && !(await box.isChecked())) return box;
  }
  return undefined;
}

// Ticks and discards without saving: a saved grant would change shared S3 access in the environment.
test('01 - Whole bucket locks the allowed folder until the change is discarded', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/orgs`);
  await page.waitForLoadState('networkidle');

  const orgRow = page.getByRole('row', { name: orgName });
  test.skip(!(await orgRow.isVisible().catch(() => false)), `${orgName} not found`);
  await orgRow.getByLabel('Actions').click();
  await page.getByRole('menuitem', { name: 'View / Edit' }).click();
  await page.waitForLoadState('networkidle');
  await page.getByText('S3 access', { exact: true }).first().click();
  await page.getByRole('radio').first().click();

  const wholeBucketBoxes = page.getByRole('checkbox', { name: /^Allow all of / });
  await expect(wholeBucketBoxes.first()).toBeVisible({ timeout: 30000 });
  const box = await firstUntickedWholeBucketBox(wholeBucketBoxes);
  test.skip(!box, 'The first lab has no granted bucket without whole-bucket access');

  const boxLabel = (await box!.getAttribute('aria-label')) ?? '';
  const folderInput = page.getByLabel(boxLabel.replace(/^Allow all of /, 'Allowed folder in '), { exact: true });
  await expect(folderInput).toBeEnabled();

  await box!.check();
  await expect(folderInput).toBeDisabled();
  await expect(page.getByText(/unsaved S3 access changes/)).toBeVisible();

  await page.getByRole('button', { name: 'Discard all' }).click();
  await expect(box!).not.toBeChecked();
  await expect(folderInput).toBeEnabled();
});
