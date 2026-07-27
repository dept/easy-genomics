import { expect, type Page } from '@playwright/test';
import { getEnvironmentConfig, getRoleCredentials, type UserRole } from './env';

/**
 * Signs in with the given role against the active E2E environment (E2E_ENV=qa|uat).
 */
export async function loginAs(page: Page, role: UserRole): Promise<void> {
  const { baseURL } = getEnvironmentConfig();
  const { email, password } = getRoleCredentials(role);

  await page.goto(`${baseURL}/signin`, { waitUntil: 'networkidle' });

  const emailInput = page.getByRole('textbox', { name: 'Email' });
  const passwordInput = page.getByRole('textbox', { name: 'Password' });
  const signInButton = page.getByRole('button', { name: 'Sign in' });

  await emailInput.click();
  await emailInput.fill(email);
  await passwordInput.click();
  await passwordInput.fill(password);

  // Ensure Vue validation watchers see the filled values.
  await passwordInput.blur();
  await expect(signInButton).toBeEnabled({ timeout: 10_000 });
  await signInButton.click();

  // Nuxt client-side navigation does not always fire a full document "load".
  await expect(page).not.toHaveURL(/\/signin\/?$/, { timeout: 60_000 });
  expect(page.url()).toContain(new URL(baseURL).host);
}
