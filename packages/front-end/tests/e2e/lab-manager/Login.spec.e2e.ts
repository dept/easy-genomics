import { test, expect } from '@playwright/test';
import { getEnvironmentConfig, getRoleCredentials } from '../helpers/env';
import { loginAs } from '../helpers/login';

const role = 'lab-manager' as const;

test.describe(`Login — ${role}`, () => {
  test(`can sign in as ${role}`, async ({ page }) => {
    const { name, baseURL } = getEnvironmentConfig();
    const { email } = getRoleCredentials(role);

    await loginAs(page, role);

    await expect(page).not.toHaveURL(/\/signin\/?$/);
    expect(page.url()).toContain(new URL(baseURL).host);
    console.log(`Signed in as ${email} on ${name} (${baseURL}) → ${page.url()}`);
  });
});
