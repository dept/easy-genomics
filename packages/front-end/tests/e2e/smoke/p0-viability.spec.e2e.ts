import { test, expect } from '@playwright/test';
import { getEnvironmentConfig } from '../helpers/env';
import { loginAs } from '../helpers/login';
import { dismissAnalyticsBannerIfPresent, logoutViaUi } from '../helpers/session';

/**
 * P0 — Application viability smoke
 * Plan: specs/smoke-plan/initial-smoke-plan.md
 */
test.describe('Smoke P0 — application viability', () => {
  test('P0-01 unauthenticated user cannot open the app shell', async ({ page }) => {
    await page.goto('/labs', { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(/\/signin\/?$/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Email' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Password' })).toBeVisible();
  });

  test('P0-02 SystemAdmin can sign in and use the admin organizations path', async ({ page }) => {
    const { baseURL } = getEnvironmentConfig();

    await loginAs(page, 'sys-admin');
    await dismissAnalyticsBannerIfPresent(page);

    await expect(page).toHaveURL(/\/admin\/orgs\/?/);
    expect(page.url()).toContain(new URL(baseURL).host);

    const primaryNav = page.getByRole('navigation', { name: 'Primary' });
    await expect(primaryNav.getByRole('link', { name: 'Organizations' })).toBeVisible();
    await expect(primaryNav.getByRole('link', { name: /^Labs/ })).toHaveCount(0);

    await page.getByRole('button', { name: 'Account menu' }).click();
    await expect(page.getByRole('button', { name: 'Sign Out' })).toBeVisible();
    // Profile entry is a button only for non-superusers
    await expect(page.getByRole('button', { name: /Profile/i })).toHaveCount(0);
  });

  test('P0-03 OrganizationAdmin can sign in and reach the labs experience', async ({ page }) => {
    const { baseURL } = getEnvironmentConfig();

    await loginAs(page, 'org-admin');
    await dismissAnalyticsBannerIfPresent(page);

    await expect(page).not.toHaveURL(/\/signin\/?$/);
    expect(page.url()).toMatch(/\/labs(\/|$|\?)/);
    expect(page.url()).toContain(new URL(baseURL).host);

    const primaryNav = page.getByRole('navigation', { name: 'Primary' });
    await expect(primaryNav.getByRole('link', { name: /^Labs/ })).toBeVisible();
    await expect(primaryNav.getByRole('link', { name: 'Organizations' })).toBeVisible();
  });

  test('P0-04 user can sign out', async ({ page }) => {
    await loginAs(page, 'org-admin');
    await dismissAnalyticsBannerIfPresent(page);
    await logoutViaUi(page);
  });
});
