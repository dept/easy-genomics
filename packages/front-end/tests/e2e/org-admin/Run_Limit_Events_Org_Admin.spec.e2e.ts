import { test, expect, type Page, type Response } from 'playwright/test';

/*
 * Test preconditions:
 * - the org admin can manage 'Default Organization'
 * The Blocked card is only a button when the default month has blocked launches; otherwise the test
 * checks that it is not one.
 */

const orgName = 'Default Organization';

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

test('01 - Org admin opens the Blocked launches list from Run costs', async ({ page, baseURL }) => {
  await openRunCostsTab(page, baseURL);

  const blockedCard = page.getByTestId('run-costs-card-blocked');
  await expect(blockedCard).toBeVisible();
  const opensList = page.getByRole('button', { name: /^Blocked: .*View the list/ });

  if (!(await opensList.isVisible().catch(() => false))) {
    await expect(opensList).toHaveCount(0);
    test.skip(true, `${orgName} has no blocked launches this month, so the Blocked card does not open a list`);
  }

  const eventsLoaded = page.waitForResponse(
    (response) => response.url().includes('/usage/list-run-limit-events') && response.url().includes('kind=blocked'),
  );
  await opensList.click();
  expect((await eventsLoaded).status()).toBe(200);

  await expect(page.getByRole('heading', { name: /^Blocked launches/ })).toBeVisible();
  await expect(page.getByTestId('run-limit-event-row').first()).toBeVisible();

  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^Blocked launches/ })).toBeHidden();
});
