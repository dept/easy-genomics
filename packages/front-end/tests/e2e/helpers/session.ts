import { expect, type Page } from '@playwright/test';
import { getEnvironmentConfig } from './env';

/**
 * Signs out via the account menu UI and waits for the sign-in page.
 */
export async function logoutViaUi(page: Page): Promise<void> {
  const { baseURL } = getEnvironmentConfig();

  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('button', { name: 'Sign Out' }).click();

  await expect(page).toHaveURL(/\/signin\/?$/, { timeout: 60_000 });
  expect(page.url()).toContain(new URL(baseURL).host);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
}

/**
 * Dismiss analytics consent banner when present (non-blocking for smoke).
 */
export async function dismissAnalyticsBannerIfPresent(page: Page): Promise<void> {
  const reject = page.getByRole('button', { name: /^Reject$/i });
  if (await reject.isVisible().catch(() => false)) {
    await reject.click();
  }
}
