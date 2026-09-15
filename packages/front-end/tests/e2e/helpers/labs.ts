import { expect, type Page } from '@playwright/test';
import { getSmokeLabIds } from './env';

type LabFlags = { LabManager?: boolean; LabTechnician?: boolean; Status?: string };

/**
 * Reads laboratory role flags from the Cognito id token in localStorage.
 * Does not return emails or raw tokens.
 */
export async function readLabRoleMap(page: Page): Promise<Record<string, LabFlags>> {
  return page.evaluate(() => {
    const idKey = Object.keys(localStorage).find((k) => k.endsWith('.idToken'));
    if (!idKey) return {};
    const token = localStorage.getItem(idKey);
    if (!token) return {};
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded));
    let orgAccess = payload.OrganizationAccess;
    if (typeof orgAccess === 'string') {
      orgAccess = JSON.parse(orgAccess);
    }
    const labs: Record<string, LabFlags> = {};
    for (const org of Object.values(orgAccess || {}) as Array<{ LaboratoryAccess?: Record<string, LabFlags> }>) {
      for (const [labId, flags] of Object.entries(org.LaboratoryAccess || {})) {
        labs[labId] = flags;
      }
    }
    return labs;
  });
}

export async function resolveManagerLabId(page: Page): Promise<string> {
  const configured = getSmokeLabIds().managerLabId;
  if (configured) return configured;

  const labs = await readLabRoleMap(page);
  const match = Object.entries(labs).find(([, flags]) => flags.LabManager === true);
  if (!match) {
    throw new Error('No lab with LabManager=true found in session JWT (set E2E_LAB_MANAGER_LAB_ID).');
  }
  return match[0];
}

export async function resolveTechnicianOnlyLabId(page: Page): Promise<string> {
  const configured = getSmokeLabIds().technicianOnlyLabId;
  if (configured) return configured;

  const labs = await readLabRoleMap(page);
  const match = Object.entries(labs).find(
    ([, flags]) => flags.LabTechnician === true && flags.LabManager !== true,
  );
  if (!match) {
    throw new Error(
      'No technician-only lab found in session JWT (LabTechnician=true, LabManager≠true). Set E2E_LAB_TECHNICIAN_LAB_ID.',
    );
  }
  return match[0];
}

export async function resolveOrgAdminLabId(page: Page): Promise<string> {
  const configured = getSmokeLabIds().orgAdminLabId;
  if (configured) return configured;

  // Prefer JWT memberships when present (org admins often also have lab access rows).
  const labs = await readLabRoleMap(page);
  const fromJwt = Object.keys(labs)[0];
  if (fromJwt) return fromJwt;

  // Fall back to first lab row action target on /labs list.
  await page.goto('/labs', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/\/signin\/?$/);
  await expect(page.getByRole('heading', { name: 'Labs' })).toBeVisible({ timeout: 30_000 });

  const href = await page.evaluate(() => {
    const anchor = [...document.querySelectorAll('a[href*="/labs/"]')].find((a) =>
      /\/labs\/[0-9a-f-]{36}/i.test(a.getAttribute('href') || ''),
    );
    return anchor?.getAttribute('href') || null;
  });

  if (href) {
    const m = href.match(/\/labs\/([0-9a-f-]{36})/i);
    if (m) return m[1];
  }

  throw new Error('Could not resolve an OrgAdmin-accessible lab id (set E2E_ORG_ADMIN_LAB_ID).');
}

export async function openLabTab(page: Page, labId: string, tabLabel: string): Promise<void> {
  await page.goto(`/labs/${labId}?tab=${encodeURIComponent(tabLabel)}`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page).toHaveURL(new RegExp(`/labs/${labId}`));
  // EGSidebarNav exposes section items as ARIA tabs
  const tab = page.getByRole('tab', { name: tabLabel, exact: true });
  await expect(tab).toBeVisible({ timeout: 30_000 });
  await tab.click();
}
