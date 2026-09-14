import { test, expect } from 'playwright/test';

/*
 * Test preconditions:
 * - 'Playwright test lab' has a run with Status 'Failed' and no AI provider
 *   configured (HealthOmicsLlmProvider/HealthOmicsLlmModelId unset) — the default
 *   fixture state, so the "Run AI analysis" button must not render for it.
 * - 'Automated Lab - Updated' has a run with Status 'Failed' and a working AI
 *   provider configured, so the "Run AI analysis" button must render for it.
 *   Neither this suite nor the org-admin suite persists a working LLM config
 *   (the org-admin invalid-model-ID test is rejected by design), so this second
 *   precondition must be arranged separately before this test can pass for real.
 */

const labName = 'Playwright test lab';
const labNameUpdated = 'Automated Lab - Updated';

test('01 - A failed run with no AI provider configured offers no analysis button', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/labs`);
  await page.waitForLoadState('networkidle');

  let hasTestLab = false;
  try {
    hasTestLab = await page.getByRole('row', { name: labName }).isVisible();
  } catch (error) {
    console.log(labName + ' test lab not found', error);
  }

  if (hasTestLab) {
    await page.getByRole('row', { name: labName }).locator('button').click();
    await page.getByRole('menuitem', { name: 'View / Edit' }).click();
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: 'Pipeline Runs' }).click();
    await page.waitForLoadState('networkidle');

    let hasFailedRun = false;
    try {
      hasFailedRun = await page.getByRole('row', { name: 'Failed' }).first().isVisible();
    } catch (error) {
      console.log('No failed run found in ' + labName, error);
    }

    if (hasFailedRun) {
      await page
        .getByRole('row', { name: 'Failed' })
        .first()
        .filter({ has: page.locator('button') })
        .locator('button')
        .click();
      await page.getByRole('menuitem', { name: 'View Details' }).click();
      await page.waitForLoadState('networkidle');

      await expect(page.getByRole('button', { name: /AI analysis/i })).toHaveCount(0);
    }
  }
});

test('02 - A failed run in an AI-configured lab offers the analysis button', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/labs`);
  await page.waitForLoadState('networkidle');

  let hasUpdatedTestLab = false;
  try {
    hasUpdatedTestLab = await page.getByRole('row', { name: labNameUpdated }).isVisible();
  } catch (error) {
    console.log(labNameUpdated + ' test lab not found', error);
  }

  if (hasUpdatedTestLab) {
    await page.getByRole('row', { name: labNameUpdated }).locator('button').click();
    await page.getByRole('menuitem', { name: 'View / Edit' }).click();
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: 'Pipeline Runs' }).click();
    await page.waitForLoadState('networkidle');

    let hasFailedRun = false;
    try {
      hasFailedRun = await page.getByRole('row', { name: 'Failed' }).first().isVisible();
    } catch (error) {
      console.log('No failed run found in ' + labNameUpdated, error);
    }

    if (hasFailedRun) {
      await page
        .getByRole('row', { name: 'Failed' })
        .first()
        .filter({ has: page.locator('button') })
        .locator('button')
        .click();
      await page.getByRole('menuitem', { name: 'View Details' }).click();
      await page.waitForLoadState('networkidle');

      await expect(page.getByRole('button', { name: /AI analysis/i })).toBeVisible();
    }
  }
});
