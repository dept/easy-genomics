import type { Locator, Page } from 'playwright/test';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A lab's Select lab / Open button on the Organizations and labs page; one per lab row. */
export function labActionButton(page: Page, labName: string): Locator {
  return page.getByRole('button', { name: new RegExp(`^(Select|Open) ${escapeRegExp(labName)}$`) });
}

/** Opens a lab from the Organizations and labs page and waits until the lab page is showing. */
export async function openLab(page: Page, labName: string): Promise<void> {
  await labActionButton(page, labName).click();
  await page.waitForURL(/\/labs\/[^/?#]+/);
  await page.waitForLoadState('networkidle');
}
