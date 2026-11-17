import { test, expect, type Locator, type Page } from 'playwright/test';

/*
 * Test preconditions:
 * - the org admin can manage 'Default Organization'
 * - that organization has a lab named 'Playwright test lab'
 *
 * The lab is shared and its limits block launches, so the amounts are far above any E2E run
 * and the test always clears them, even when an assertion fails.
 */

const orgName = 'Default Organization';
const labName = 'Playwright test lab';
const LIMIT_INPUTS = ['Cost warn above', 'Cost block above', 'Samples warn above', 'Samples block above'];

async function openUsageLimitsTab(page: Page, baseURL: string | undefined): Promise<void> {
  await page.goto(`${baseURL}/orgs`);
  await page.waitForLoadState('networkidle');

  const orgRow = page.getByRole('row', { name: orgName });
  test.skip(!(await orgRow.isVisible().catch(() => false)), `${orgName} not found`);
  await orgRow.getByLabel('Actions').click();
  await page.getByRole('menuitem', { name: 'View / Edit' }).click();
  await page.waitForLoadState('networkidle');
  await page.getByRole('tab', { name: 'Usage limits' }).click();
}

function labRow(page: Page): Locator {
  return page.getByRole('row', { name: new RegExp(labName) });
}

async function expectNoLimits(row: Locator): Promise<void> {
  await expect(row.getByText('Not set', { exact: true })).toHaveCount(4);
}

async function clearLimits(page: Page, row: Locator): Promise<void> {
  await row.getByRole('button', { name: `Edit limits for ${labName}` }).click();
  for (const label of LIMIT_INPUTS) {
    await page.getByLabel(label, { exact: true }).fill('');
  }
  await row.getByRole('button', { name: 'Save' }).click();
  await expectNoLimits(row);
}

test("01 - Set, reload and clear a lab's usage limits", async ({ page, baseURL }) => {
  await openUsageLimitsTab(page, baseURL);
  const row = labRow(page);
  test.skip(!(await row.isVisible({ timeout: 30000 }).catch(() => false)), `${labName} not found`);

  try {
    await row.getByRole('button', { name: `Edit limits for ${labName}` }).click();
    await page.getByLabel('Cost warn above', { exact: true }).fill('100000');
    await page.getByLabel('Cost block above', { exact: true }).fill('100000');
    await expect(page.getByText('The cost block amount needs to be higher than the warn amount.')).toBeVisible();
    await expect(row.getByRole('button', { name: 'Save' })).toBeDisabled();

    await page.getByLabel('Cost block above', { exact: true }).fill('200000');
    await page.getByLabel('Samples warn above', { exact: true }).fill('9000');
    await page.getByLabel('Samples block above', { exact: true }).fill('10000');
    await row.getByRole('button', { name: 'Save' }).click();

    for (const shown of ['US$100,000', 'US$200,000', '9,000', '10,000', 'Saved']) {
      await expect(row.getByText(shown, { exact: true })).toBeVisible();
    }

    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: 'Usage limits' }).click();
    for (const shown of ['US$100,000', 'US$200,000', '9,000', '10,000']) {
      await expect(labRow(page).getByText(shown, { exact: true })).toBeVisible();
    }

    await clearLimits(page, labRow(page));
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: 'Usage limits' }).click();
    await expectNoLimits(labRow(page));
  } finally {
    const finalRow = labRow(page);
    const notSetCount = await finalRow.getByText('Not set', { exact: true }).count();
    if (notSetCount !== 4) {
      const cancel = finalRow.getByRole('button', { name: 'Cancel' });
      if (await cancel.isVisible().catch(() => false)) {
        await cancel.click();
      }
      await clearLimits(page, finalRow);
    }
  }
});
