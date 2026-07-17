import { test, expect } from 'playwright/test';
import { randomUUID } from 'node:crypto';
import { envConfig } from '../../../config/env-config';

const orgName = 'Automated Org';
const orgNameSelector = 'Automated Org This is a';
const orgNameUpdated = 'Automated Org - Updated';
const orgNameUpdatedSelector = 'Automated Org - Updated This';
const existingOrgName = 'Default Organization';
const labNameUpdated = 'Automated Lab - Updated';
const labManagerName = 'Lab Manager';

test('01 - Remove an Organization Successfully', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/orgs`);
  await page.waitForLoadState('networkidle');

  // Check if the org exists
  const org1Exists = await page.getByRole('cell', { name: orgName, exact: true }).isVisible();
  const org2Exists = await page.getByRole('cell', { name: orgNameUpdated, exact: true }).isVisible();

  if (!org1Exists && !org2Exists) {
    throw new Error('No Organizations found to remove');
  }

  if (org1Exists) {
    console.log(orgName + ' exists');
    // This will remove the org if it exists
    await page.getByRole('row', { name: orgNameSelector }).locator('button').click();
    await page.getByRole('menuitem', { name: 'Remove' }).click();
    await page.getByRole('button', { name: 'Remove Organization' }).click();
    await page.waitForTimeout(2000);
    await expect(page.getByText('Organization deleted').nth(0)).toBeVisible();
  }
  if (org2Exists) {
    console.log(orgNameUpdated + ' exists');
    // This will remove the org if it exists
    await page.getByRole('row', { name: orgNameUpdatedSelector }).locator('button').click();
    await page.getByRole('menuitem', { name: 'Remove' }).click();
    await page.getByRole('button', { name: 'Remove Organization' }).click();
    await page.waitForTimeout(2000);
    await expect(page.getByText('Organization deleted').nth(0)).toBeVisible();
  }
});

test('02 - Create a new Organization Successfully', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/orgs`);
  await page.waitForLoadState('networkidle');

  // Check if the org exists
  let orgExists = true;
  try {
    orgExists = await page.getByRole('row', { name: orgName }).isHidden();
  } catch (error) {
    console.log('Org already exists!', error);
  }

  if (orgExists) {
    // Create new organization as it does not exist
    await page.getByRole('link', { name: 'Create a new Organization' }).click();
    await page.waitForTimeout(2000);
    await page.getByPlaceholder('Enter organization name').fill(orgName);
    await page.getByPlaceholder('Describe your organization').fill('This is a description of the automated Org');
    await page.getByLabel('Organization name*').dblclick();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.waitForTimeout(2000);
    await expect(page.getByText('Organization created').nth(0)).toBeVisible();
  }
});

test('03 - Invite a user to an Org Successfully', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/orgs`);
  await page.waitForLoadState('networkidle');
  await page.getByRole('row', { name: orgName }).locator('button').click();
  await page.getByRole('menuitem', { name: 'View / Edit' }).click();

  // Check if the Org user exists
  let userExists = true;
  try {
    userExists = await page.getByRole('row', { name: envConfig.testInviteEmail }).isHidden();
  } catch (error) {
    console.log('User already exists!', error);
  }

  if (userExists) {
    // Invite the user as they do not exist
    await page.getByRole('tab', { name: 'All users' }).click();
    await page.getByRole('button', { name: 'Invite users' }).click();
    await page.waitForTimeout(2000);
    await page.getByPlaceholder('Enter Email').click();
    await page.keyboard.type(`${envConfig.testInviteEmail}`);
    await page.getByRole('button', { name: 'Invite', exact: true }).click();

    // Confirm
    await expect(page.getByText(`${envConfig.testInviteEmail} has been sent an invite`).nth(0)).toBeVisible();

    await page.waitForTimeout(2000);
    const cell = page.getByRole('cell', {
      name: envConfig.testInviteEmail,
    });
    await expect(cell).toBeVisible();
  }
});

test("04 - Change a user's Organization Admin access", async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/orgs`);
  await page.waitForLoadState('networkidle');
  await page.getByRole('row', { name: orgName }).locator('button').click();
  await page.getByRole('menuitem', { name: 'View / Edit' }).click();
  await page.waitForTimeout(2000);

  // Check if the Org user exists
  let userExists = true;
  try {
    userExists = await page.getByRole('row', { name: envConfig.testInviteEmail }).isVisible();
  } catch (error) {
    console.log('User does not exist!', error);
  }

  if (userExists) {
    // Change user's organization admin access
    await page.getByRole('row', { name: envConfig.testInviteEmail }).locator('button').nth(1).click();
    await page.getByRole('menuitem', { name: 'Edit User Access' }).click();
    await page.waitForLoadState('networkidle');
    await page.locator('span').filter({ hasText: 'Organization Admin' }).click();
    await page.getByRole('status').locator('div').nth(1).click();
    const toastMessage = await page.locator('.test-toast-success').innerText();
    expect(toastMessage).toContain(`${envConfig.testInviteEmail}’s Lab Access has been successfully updated`);
  }
});

test('05 - Remove Invited user from an Org Successfully', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/orgs`);
  await page.waitForLoadState('networkidle');
  await page.getByRole('row', { name: orgName }).locator('button').click();
  await page.getByRole('menuitem', { name: 'View / Edit' }).click();
  await page.waitForTimeout(2000);

  // Check if the Org user exists
  let userExists = true;
  try {
    userExists = await page.getByRole('row', { name: envConfig.testInviteEmail }).isVisible();
  } catch (error) {
    console.log('Org already exists!', error);
  }

  if (userExists) {
    // Remove the user from the organization
    await page.getByRole('row', { name: envConfig.testInviteEmail }).locator('button').nth(1).click();
    await page.getByRole('menuitem', { name: 'Revoke invite' }).click();
    await page.getByRole('button', { name: 'Revoke Invite' }).nth(1).click();

    // Confirm revocation
    await expect(page.getByText(`Invitation for ${envConfig.testInviteEmail} has been revoked`).nth(0)).toBeVisible();
    const cell = page.getByRole('cell', {
      name: envConfig.testInviteEmail,
      exact: true,
    });
    await expect(cell).toBeHidden();
  }
});

test('06 - Update an Org Successfully', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/orgs`);
  await page.waitForTimeout(2000);

  // Check if the 'updated' test org already exists then update it back to the original value
  let autoOrgExists = true;
  try {
    autoOrgExists = await page.getByRole('row', { name: orgName }).isVisible();
  } catch (error) {
    console.log('Updated Organization not found', error);
  }

  if (autoOrgExists) {
    const uuid = randomUUID();
    await page.getByRole('row', { name: orgName }).locator('button').click();
    await page.getByRole('menuitem', { name: 'View / Edit' }).click();
    await page.getByRole('tab', { name: 'Settings' }).click();
    await page.getByText('Organization name*').isVisible();
    await page.getByLabel('Organization name*').fill(orgNameUpdated);
    await page.getByPlaceholder('Describe your organization').fill(`This is an ORG created by Playwright ${uuid}`);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.getByText('Organization updated', { exact: true }).isVisible();
    await page.waitForTimeout(2000);
    await expect(page.getByText('Organization updated').nth(0)).toBeVisible();

    await page.reload();
    await page.waitForTimeout(2000);
    await expect(page.getByText(orgNameUpdated).nth(0)).toBeVisible();
    await expect(page.getByText(`This is an ORG created by Playwright ${uuid}`).nth(0)).toBeVisible();
  } else {
    console.log('Updated Organization not found');
  }
});

test('07 - View All labs tab', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/orgs`);
  await page.waitForLoadState('networkidle');

  // Check if the 'updated' test org already exists then update it back to the original value
  let autoOrgExists = true;
  try {
    autoOrgExists = await page.getByRole('row', { name: existingOrgName }).isVisible();
  } catch (error) {
    console.log(existingOrgName + ' not found', error);
  }

  if (autoOrgExists) {
    await page.getByRole('row', { name: existingOrgName }).locator('button').click();
    await page.getByRole('menuitem', { name: 'View / Edit' }).click();
    await page.getByRole('tab', { name: 'All Labs' }).click();
    await page.waitForTimeout(2000);

    let emptyOrg = false;
    try {
      emptyOrg = await page.getByText("You don't have any Labs set up yet.", { exact: true }).isVisible();
    } catch (error) {
      console.log(existingOrgName + ' not found', error);
    }

    if (emptyOrg) {
      console.log('No existing Labs found for ' + existingOrgName);
    } else {
      // Check if the 'labNameUpdated' value exists
      let hasTestLab = false;
      try {
        hasTestLab = await page.getByRole('row', { name: labNameUpdated }).isVisible();
      } catch (error) {
        console.log('Playwright test lab not found', error);
      }

      if (hasTestLab) {
        await page.getByRole('row', { name: labNameUpdated }).click();
        await page.waitForTimeout(2000);

        //Users tab
        await expect(page.getByRole('tab', { name: 'Users' })).toBeVisible();
        await expect(page.getByRole('tab', { name: 'Settings' })).toBeVisible();
        await page.waitForTimeout(2000);
        await expect(page.getByRole('row', { name: labManagerName })).toBeVisible();

        //Settings tab
        await page.getByRole('tab', { name: 'Settings' }).click();
        await expect(page.getByText(labNameUpdated).nth(0)).toBeVisible();
        await expect(page.getByRole('button', { name: 'Edit' })).toBeDisabled();
      }
    }
  } else {
    console.log('Existing organization not found');
  }
});

//TO DO
//Check if Remove options exists
//check if Labs menu appears
//check if create a new lab button appears
