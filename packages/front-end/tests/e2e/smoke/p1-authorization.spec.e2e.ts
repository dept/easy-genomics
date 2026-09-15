import { test, expect } from '@playwright/test';
import { loginAs } from '../helpers/login';
import {
  openLabTab,
  resolveManagerLabId,
  resolveOrgAdminLabId,
  resolveTechnicianOnlyLabId,
} from '../helpers/labs';
import { dismissAnalyticsBannerIfPresent } from '../helpers/session';

/**
 * P1-A — Authorization & affordance smoke (no shared-data mutation)
 * Plan: specs/smoke-plan/initial-smoke-plan.md
 *
 * Each test logs in independently (no order dependency).
 */
test.describe('Smoke P1-A — authorization boundaries', () => {
  test('P1-A01 Non-SystemAdmin cannot remain on /admin routes', async ({ page }) => {
    await loginAs(page, 'org-admin');
    await dismissAnalyticsBannerIfPresent(page);

    await page.goto('/admin/orgs', { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/\/admin\//);
    await expect(page).toHaveURL(/\/orgs\/?/);
  });

  test('P1-A02 OrganizationAdmin can open Organizations', async ({ page }) => {
    await loginAs(page, 'org-admin');
    await dismissAnalyticsBannerIfPresent(page);

    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Organizations' }).click();
    await expect(page).toHaveURL(/\/orgs\/?/);
    await expect(page).not.toHaveURL(/\/signin\/?$/);
  });

  test('P1-A03 LabManager cannot open Organizations', async ({ page }) => {
    await loginAs(page, 'lab-manager');
    await dismissAnalyticsBannerIfPresent(page);

    const primaryNav = page.getByRole('navigation', { name: 'Primary' });
    await expect(primaryNav.getByRole('link', { name: 'Organizations' })).toHaveCount(0);

    await page.goto('/orgs', { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/\/orgs\/?$/);
    await expect(page).toHaveURL(/\/labs/);
  });

  test('P1-A04 OrganizationAdmin can open Create Lab', async ({ page }) => {
    await loginAs(page, 'org-admin');
    await dismissAnalyticsBannerIfPresent(page);

    await page.goto('/labs', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Create a new Lab' })).toBeVisible();

    await page.goto('/labs/create', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/labs\/create\/?/);
    await expect(page.getByText(/Create Lab/i).first()).toBeVisible();
  });

  test('P1-A05 LabManager is denied Create Lab', async ({ page }) => {
    await loginAs(page, 'lab-manager');
    await dismissAnalyticsBannerIfPresent(page);

    await page.goto('/labs/create', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/labs\/?$/);
    await expect(page).not.toHaveURL(/\/labs\/create/);
  });

  test('P1-A06 OrganizationAdmin sees Lab Settings', async ({ page }) => {
    await loginAs(page, 'org-admin');
    await dismissAnalyticsBannerIfPresent(page);

    const labId = await resolveOrgAdminLabId(page);
    await openLabTab(page, labId, 'Settings');

    await expect(page.getByRole('tab', { name: 'Settings', exact: true })).toBeVisible();
    // Configuration surface: look for common settings labels without requiring every field
    await expect(
      page.getByText(/HealthOmics|S3|Bucket|Laboratory|Lab name|Description|Notification/i).first(),
    ).toBeVisible({ timeout: 30_000 });
  });

  test('P1-A07 LabManager does not see Lab Settings', async ({ page }) => {
    await loginAs(page, 'lab-manager');
    await dismissAnalyticsBannerIfPresent(page);

    const labId = await resolveManagerLabId(page);
    await page.goto(`/labs/${labId}`, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(new RegExp(`/labs/${labId}`));

    await expect(page.getByRole('tab', { name: 'Settings', exact: true })).toHaveCount(0);
  });

  test('P1-A08 LabManager can manage lab users (Add Lab Users enabled)', async ({ page }) => {
    await loginAs(page, 'lab-manager');
    await dismissAnalyticsBannerIfPresent(page);

    const labId = await resolveManagerLabId(page);
    await openLabTab(page, labId, 'Users');

    const addUsers = page.getByRole('button', { name: 'Add Lab Users' });
    await expect(addUsers).toBeVisible();
    await expect(addUsers).toBeEnabled();
  });

  test('P1-A09 LabTechnician is restricted on a technician-only lab', async ({ page }) => {
    await loginAs(page, 'lab-technician');
    await dismissAnalyticsBannerIfPresent(page);

    const labId = await resolveTechnicianOnlyLabId(page);
    await page.goto(`/labs/${labId}`, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(new RegExp(`/labs/${labId}`));

    await expect(page.getByRole('tab', { name: 'Settings', exact: true })).toHaveCount(0);

    await page.goto(`/labs/${labId}/create-workflow`, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/labs\/?$/);
    await expect(page).not.toHaveURL(/create-workflow/);

    await openLabTab(page, labId, 'Users');
    const addUsers = page.getByRole('button', { name: 'Add Lab Users' });
    if (await addUsers.count()) {
      await expect(addUsers).toBeDisabled();
    }
  });

  test('P1-A10 SystemAdmin can open Create Organization', async ({ page }) => {
    await loginAs(page, 'sys-admin');
    await dismissAnalyticsBannerIfPresent(page);

    await page.goto('/admin/orgs', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/admin\/orgs\/?/);

    await page.getByRole('link', { name: /Create a new Organization/i }).click();
    await expect(page).toHaveURL(/\/admin\/orgs\/create\/?/);
    await expect(page.getByText(/ADMIN VIEW|Create/i).first()).toBeVisible();
  });
});
