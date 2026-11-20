/**
 * Switching organization and lab from the Organizations and labs page (EGV-403).
 *
 * Preconditions:
 * - 'Default Organization' has at least one lab the org-admin user can open.
 * - The org-admin user also belongs to 'Playwright Second Organization', which has a lab named
 *   'Playwright second org lab' that the user can open. This is a one-off setup in the environment.
 *
 * The test always switches back to 'Default Organization', even when an assertion fails,
 * because the switch changes the user's saved default organization for the rest of the suite.
 */
import { test, expect, type Page } from 'playwright/test';
import { labActionButton, openLab } from '../helpers/labs';

const defaultOrgName = 'Default Organization';
const secondOrgName = 'Playwright Second Organization';
const secondOrgLabName = 'Playwright second org lab';

function orgButton(page: Page, orgName: string) {
  return page
    .getByRole('navigation', { name: 'Organizations' })
    .getByRole('button', { name: new RegExp(`^${orgName}`) });
}

function chip(page: Page) {
  return page.getByRole('link', { name: /Switch organization or lab/ });
}

async function switchBackToDefaultOrg(page: Page, baseURL: string | undefined): Promise<void> {
  await page.goto(`${baseURL}/labs`);
  await page.waitForLoadState('networkidle');
  await orgButton(page, defaultOrgName).click();
  // Labs_Org_Admin renames and recreates its lab, so open whichever lab the default org has
  await page
    .getByRole('button', { name: /^(Select|Open) / })
    .first()
    .click();
  await page.waitForURL(/\/labs\/[^/?#]+/);
  await expect(chip(page)).toContainText(defaultOrgName);
}

test('01 - Switch org and lab from the Organizations and labs page, then switch back', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/labs`);
  await page.waitForLoadState('networkidle');
  test.skip(
    !(await orgButton(page, secondOrgName)
      .isVisible()
      .catch(() => false)),
    `${secondOrgName} not set up for this user`,
  );

  try {
    // Previewing another organization's labs doesn't switch the working organization
    await orgButton(page, secondOrgName).click();
    await expect(labActionButton(page, secondOrgLabName)).toBeVisible();
    await expect(chip(page)).toContainText(defaultOrgName);

    await openLab(page, secondOrgLabName);
    await expect(page.getByText(`Now working in ${secondOrgLabName}, ${secondOrgName}`)).toBeVisible();
    await expect(chip(page)).toContainText(secondOrgName);
    await expect(chip(page)).toContainText(secondOrgLabName);
  } finally {
    await switchBackToDefaultOrg(page, baseURL);
  }
});
