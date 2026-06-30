import { FullConfig, chromium } from '@playwright/test';
import { envConfig } from '../../config/env-config';
import * as fs from 'fs';
import * as path from 'path';

type UserType = 'sys-admin' | 'org-admin' | 'lab-manager' | 'lab-technician';

interface Credentials {
  email: string;
  password: string;
}

const authFileMap: Record<UserType, string> = {
  'sys-admin': './tests/e2e/.auth/sys-admin.json',
  'org-admin': './tests/e2e/.auth/org-admin.json',
  'lab-manager': './tests/e2e/.auth/lab-manager.json',
  'lab-technician': './tests/e2e/.auth/lab-technician.json',
};

const getCredentials = (email: string | undefined, password: string | undefined): Credentials => {
  if (!email || !password) {
    throw new Error('Email and password must not be null or empty.');
  }

  return {
    email,
    password,
  };
};

const credentialsMap: Record<UserType, Credentials> = {
  'sys-admin': getCredentials(envConfig.sysAdminEmail, envConfig.sysAdminPassword),
  'org-admin': getCredentials(envConfig.orgAdminEmail, envConfig.orgAdminPassword),
  'lab-manager': getCredentials(envConfig.labManagerEmail, envConfig.labManagerPassword),
  'lab-technician': getCredentials(envConfig.labTechnicianEmail, envConfig.labTechnicianPassword),
};

/**
 * Ensures that the .auth directory exists.
 * @param authFile The path to the auth file.
 */
function ensureAuthDirectoryExists(authFile: string) {
  const authDir = path.dirname(authFile);
  if (!fs.existsSync(authDir)) {
    console.log(`Creating directory: ${authDir}`);
    fs.mkdirSync(authDir, { recursive: true });
  } else {
    console.log(`Directory already exists: ${authDir}`);
  }
}

/**
 * Perform the sign-in process and save the storage state.
 * @param page The Playwright page object.
 * @param baseURL The base URL for the application.
 * @param credentials The user credentials.
 * @param authFile The path to save the storage state.
 * @param userType The type of user (sys-admin or org-admin).
 */
async function signInAndSaveState(
  page: any,
  baseURL: string,
  credentials: Credentials,
  authFile: string,
  userType: UserType,
) {
  console.log(`Navigating to Sign In page @ ${baseURL}/signin`);

  await page.goto(`${baseURL}/signin`);
  await page.getByLabel('Email').click();
  await page.keyboard.type(credentials.email);
  await page.getByLabel('Password', { exact: true }).click();
  await page.keyboard.type(credentials.password);

  console.log('Clicking Sign In as ' + userType + '...');
  await page.getByRole('button', { name: 'Sign In' }).click();

  console.log('Waiting for navigation to complete...');
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch((err: any) => {
    console.log('Load state error:', err);
    throw new Error('Failed to sign in.');
  });

  console.log('Sign-in process completed.');
  console.log(`Saving storage state to: ${authFile}`);

  await page.context().storageState({ path: authFile });
  console.log('Browser closed.');
}

/**
 * Global setup for all Playwright tests.
 * @param config Full Playwright test configuration.
 */
async function globalSetup(config: FullConfig) {
  const userType = process.env.USER_TYPE as UserType;

  if (!userType || !['sys-admin', 'org-admin', 'lab-manager', 'lab-technician'].includes(userType)) {
    throw new Error(`Invalid or missing USER_TYPE environment variable: ${userType}`);
  }

  const credentials = credentialsMap[userType];
  if (!credentials) {
    throw new Error(`Invalid user type in credentialsMap: ${userType}`);
  }

  const authFile = authFileMap[userType];
  ensureAuthDirectoryExists(authFile);

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  const projectConfig = config.projects.find(
    (project) => project.name === process.argv.find((arg) => arg.startsWith('--project='))?.split('=')[1],
  )?.use;
  const baseURL = projectConfig?.baseURL || `https://${envConfig.appDomainName}`;
  await signInAndSaveState(page, baseURL, credentials, authFile, userType);

  await browser.close();
}

export default globalSetup;
