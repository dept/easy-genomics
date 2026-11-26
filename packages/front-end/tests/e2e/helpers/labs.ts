import type { Locator, Page } from 'playwright/test';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A lab's Select lab / Open button on the Organizations and labs page; one per lab row. */
export function labActionButton(page: Page, labName: string): Locator {
  return page.getByRole('button', { name: new RegExp(`^(Select|Open) ${escapeRegExp(labName)}$`) });
}

/**
 * An organization in the Organizations and labs page's left-hand list. The accessible name also carries the
 * "N labs · Org admin" detail line, so the organization name is matched as a prefix.
 */
export function orgListButton(page: Page, orgName: string): Locator {
  return page
    .getByRole('navigation', { name: 'Organizations' })
    .getByRole('button', { name: new RegExp(`^${escapeRegExp(orgName)}`) });
}

/** Previews an organization on the Organizations and labs page, then opens its settings from the header. */
export async function openOrgSettings(page: Page, orgName: string): Promise<void> {
  await orgListButton(page, orgName).click();
  await page.getByRole('button', { name: 'Organization settings' }).click();
  await page.waitForURL(/\/orgs\/[^/?#]+/);
  await page.waitForLoadState('networkidle');
}

/** Opens a lab from the Organizations and labs page and waits until the lab page is showing. */
export async function openLab(page: Page, labName: string): Promise<void> {
  await labActionButton(page, labName).click();
  await page.waitForURL(/\/labs\/[^/?#]+/);
  await page.waitForLoadState('networkidle');
}
