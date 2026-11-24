import { test, expect } from 'playwright/test';
import { openLab } from '../helpers/labs';

const labName = 'Playwright test lab';
const labNameUpdated = 'Automated Lab - Updated';

test('01 - Hide Create a new Laboratory button', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/labs`);
  await page.waitForTimeout(2000);

  // confirm button if enabled/visible
  await expect(page.getByRole('button', { name: 'Create a new lab' })).toBeHidden();
});

test('02 - Hide Remove a Laboratory option', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/labs`);
  await page.waitForLoadState('networkidle');

  // Removing a lab is only offered to org admins, through each row's More actions menu
  await expect(page.getByRole('button', { name: /^More actions for / })).toHaveCount(0);
});

test('03 - Hide Organization link', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}`);
  await page.waitForLoadState('networkidle');

  // Only system admins get the Organizations link; everyone else switches through the org and lab chip
  await expect(page.getByRole('link', { name: 'Organizations' })).toBeHidden();
  await expect(page.getByRole('link', { name: /Switch organization or lab/ })).toBeVisible();
});

test('04 - Hide Lab Settings tab', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/labs`);
  await page.waitForLoadState('networkidle');

  let hasTestLab = false;
  try {
    hasTestLab = await page.getByRole('row', { name: labName }).isVisible();
  } catch (error) {
    console.log(labName + ' test lab not found', error);
  }

  if (hasTestLab == true) {
    await openLab(page, labName);

    // Lab technicians cannot edit lab details, so the Settings tab is not shown
    await expect(page.getByRole('tab', { name: 'Settings' })).toBeHidden();
  }

  await page.goto(`${baseURL}/labs`);
  await page.waitForLoadState('networkidle');

  let hasUpdatedTestLab = false;
  try {
    hasUpdatedTestLab = await page.getByRole('row', { name: labNameUpdated }).isVisible();
  } catch (error) {
    console.log(labNameUpdated + ' test lab not found', error);
  }

  if (hasUpdatedTestLab == true) {
    await openLab(page, labNameUpdated);

    // Lab technicians cannot edit lab details, so the Settings tab is not shown
    await expect(page.getByRole('tab', { name: 'Settings' })).toBeHidden();
  }
});
