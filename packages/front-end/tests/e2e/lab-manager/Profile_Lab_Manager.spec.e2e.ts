import { test, expect } from 'playwright/test';
import { envConfig } from '../../../config/env-config';

const email = envConfig.labManagerEmail || '';

test('01 - Reset Password', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/profile`);
  await page.waitForLoadState('networkidle');

  await expect(page.getByText('Lab manager', { exact: true })).toBeVisible();

  const sendResetLink = page.getByRole('button', { name: 'Send reset link' });
  await expect(sendResetLink).toBeVisible();
  await sendResetLink.click();

  await expect(page.getByText(`Link sent to ${email}. Check your inbox.`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send again' })).toBeVisible();
  await expect(page).toHaveURL(`${baseURL}/profile`);
});
