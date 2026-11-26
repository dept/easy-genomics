import { test, expect } from 'playwright/test';
import { envConfig } from '../../../config/env-config';

const firstName = 'Lab';
const lastName = 'Technician';
const fullName = `${firstName} ${lastName}`;
const initials = firstName.charAt(0) + lastName.charAt(0);
const email = envConfig.labTechnicianEmail || '';

test('01 - Update names', async ({ page, baseURL }) => {
  // Check if the user has been added already to a Lab
  await page.goto(`${baseURL}/profile`);
  await page.waitForLoadState('networkidle');

  const firstNameField = page.getByRole('textbox', { name: 'First name' });
  const lastNameField = page.getByRole('textbox', { name: 'Last name' });

  const saveButton = page.getByRole('button', { name: 'Save changes' });

  // check initial page state
  await expect(firstNameField).toHaveValue(firstName);
  await expect(lastNameField).toHaveValue(lastName);

  await expect(page.getByText(fullName)).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText(initials, { exact: true })).toHaveCount(2); // in header dropdown button and identity row

  await expect(saveButton).toBeDisabled();

  // enter new values
  await firstNameField.fill('FirstNameNew');
  await lastNameField.fill('LastNameNew');
  await expect(page.getByText('Unsaved changes')).toBeVisible();

  // submit
  await expect(saveButton).toBeEnabled();
  await saveButton.click();

  // verify successful update
  await page.waitForTimeout(3000);
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();

  await expect(page.getByText('FirstNameNew LastNameNew')).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText('FL')).toHaveCount(2);

  await expect(saveButton).toBeDisabled();

  // change names back
  await firstNameField.fill(firstName);
  await lastNameField.fill(lastName);
  await saveButton.click();

  await page.waitForTimeout(3000);
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();

  // check everything is back to original values
  await expect(firstNameField).toHaveValue(firstName);
  await expect(lastNameField).toHaveValue(lastName);

  await expect(page.getByText(fullName)).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText(initials, { exact: true })).toHaveCount(2);

  await expect(saveButton).toBeDisabled();
});

test('02 - Reset Password', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/profile`);
  await page.waitForLoadState('networkidle');

  const sendResetLink = page.getByRole('button', { name: 'Send reset link' });
  await expect(sendResetLink).toBeVisible();
  await sendResetLink.click();

  await expect(page.getByText(`Link sent to ${email}. Check your inbox.`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send again' })).toBeVisible();
  await expect(page).toHaveURL(`${baseURL}/profile`);
});
