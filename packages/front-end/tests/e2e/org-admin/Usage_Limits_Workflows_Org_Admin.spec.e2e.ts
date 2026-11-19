import { test, expect, type Locator, type Page } from 'playwright/test';

/*
 * Test preconditions:
 * - the org admin can manage 'Default Organization'
 * - that organization has a lab named 'Playwright test lab'
 * - no workflow in that lab has its own limits yet
 *
 * The lab is shared and a workflow's block amount stops launches, so the amount is far above any
 * E2E run and the test always clears it, even when an assertion fails.
 */

const orgName = 'Default Organization';
const labName = 'Playwright test lab';
const BLOCK_AMOUNT = '200000';
const COUNT_TEXT = '1 workflow with its own limits';

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
  return page.getByRole('row', { name: new RegExp(labName) }).first();
}

async function expandWorkflows(page: Page): Promise<void> {
  const showButton = page.getByRole('button', { name: `Show workflows for ${labName}` });
  if (await showButton.isVisible().catch(() => false)) {
    await showButton.click();
  }
}

function blockInput(page: Page, workflowName: string): Locator {
  return page.getByLabel(`Cost block above for ${workflowName}`, { exact: true });
}

async function clearBlockAmount(page: Page, workflowName: string): Promise<void> {
  await expandWorkflows(page);
  const input = blockInput(page, workflowName);
  await expect(input).toBeVisible({ timeout: 30000 });
  if ((await input.inputValue()) !== '') {
    await input.fill('');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
  }
  await expect(labRow(page).getByText(COUNT_TEXT, { exact: true })).toHaveCount(0);
}

test("01 - Set, reload and clear a workflow's cost block amount", async ({ page, baseURL }) => {
  await openUsageLimitsTab(page, baseURL);
  test.skip(
    !(await labRow(page)
      .isVisible({ timeout: 30000 })
      .catch(() => false)),
    `${labName} not found`,
  );

  await expandWorkflows(page);
  const firstBlockInput = page.getByLabel(/^Cost block above for /).first();
  const noWorkflows = page.getByText("This lab hasn't run any workflows yet", { exact: false });
  await expect(firstBlockInput.or(noWorkflows)).toBeVisible({ timeout: 30000 });
  test.skip(await noWorkflows.isVisible(), 'lab has no workflow runs');

  const label = (await firstBlockInput.getAttribute('aria-label')) ?? '';
  const workflowName = label.replace('Cost block above for ', '');

  try {
    await blockInput(page, workflowName).fill(BLOCK_AMOUNT);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();

    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: 'Usage limits' }).click();
    await expect(labRow(page).getByText(COUNT_TEXT, { exact: true })).toBeVisible({ timeout: 30000 });
    await expandWorkflows(page);
    await expect(blockInput(page, workflowName)).toHaveValue(BLOCK_AMOUNT, { timeout: 30000 });
  } finally {
    await clearBlockAmount(page, workflowName);
  }
});
