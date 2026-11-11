import { readFile } from 'node:fs/promises';
import { test, expect, type Page, type Response } from 'playwright/test';

/*
 * Test preconditions:
 * - the org admin can manage 'Default Organization'
 * The expand step needs at least one finished run in the default month; without one it is skipped.
 */

const orgName = 'Default Organization';
const CSV_HEADER = 'Lab,Workflow,Runs,Estimated cost (USD),Previous (USD),Change (%),Share (%)';

function runCostsResponse(page: Page, queryPart: string): Promise<Response> {
  return page.waitForResponse(
    (response) => response.url().includes('/usage/list-run-costs') && response.url().includes(queryPart),
  );
}

async function openRunCostsTab(page: Page, baseURL: string | undefined): Promise<void> {
  await page.goto(`${baseURL}/orgs`);
  await page.waitForLoadState('networkidle');

  const orgRow = page.getByRole('row', { name: orgName });
  test.skip(!(await orgRow.isVisible().catch(() => false)), `${orgName} not found`);
  await orgRow.getByLabel('Actions').click();
  await page.getByRole('menuitem', { name: 'View / Edit' }).click();
  await page.waitForLoadState('networkidle');
  await page.getByRole('tab', { name: 'Usage', exact: true }).click();

  const monthLoaded = runCostsResponse(page, 'period=month');
  await page.getByRole('tab', { name: /^Run costs/ }).click();
  expect((await monthLoaded).status()).toBe(200);
}

test('01 - Switch the run costs period, expand a lab and export the CSV', async ({ page, baseURL }) => {
  await openRunCostsTab(page, baseURL);
  await expect(page.getByTestId('run-costs-note')).toHaveText(
    'Estimated from AWS list prices, for finished runs. Not your AWS bill.',
  );

  const thirtyDays = page.getByRole('button', { name: '30 days', exact: true });
  const thirtyDaysLoaded = runCostsResponse(page, 'period=30d');
  await thirtyDays.click();
  expect((await thirtyDaysLoaded).status()).toBe(200);
  await expect(thirtyDays).toHaveAttribute('aria-pressed', 'true');

  const monthPicker = page.getByLabel('Month');
  const monthlyLoaded = runCostsResponse(page, 'period=month');
  await page.getByRole('button', { name: 'Monthly', exact: true }).click();
  await monthlyLoaded;
  const [currentMonth, previousMonth] = await monthPicker
    .locator('option')
    .evaluateAll((options) => options.slice(0, 2).map((option) => (option as HTMLOptionElement).value));

  const previousMonthLoaded = runCostsResponse(page, `month=${previousMonth}`);
  await monthPicker.selectOption(previousMonth);
  expect((await previousMonthLoaded).status()).toBe(200);

  const currentMonthLoaded = runCostsResponse(page, `month=${currentMonth}`);
  await monthPicker.selectOption(currentMonth);
  await currentMonthLoaded;

  await expect(page.getByRole('button', { name: 'Export CSV' })).toBeVisible();
  const labToggle = page.locator('table button[aria-expanded]').first();
  const hasLabRow = await labToggle.isVisible().catch(() => false);

  if (hasLabRow) {
    await labToggle.click();
    await expect(labToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('run-costs-workflow-row').first()).toBeVisible();

    await page.getByRole('button', { name: 'Collapse all', exact: true }).click();
    await expect(labToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('run-costs-workflow-row')).toHaveCount(0);

    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV' }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/^run-costs-.+\.csv$/);
    const csv = await readFile(await download.path(), 'utf-8');
    expect(csv.split('\r\n')[0]).toBe(CSV_HEADER);
  } else {
    await expect(page.getByText('No finished runs in this period.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
    test.skip(true, `${orgName} has no finished runs this month, so there is no lab to expand or export`);
  }
});
