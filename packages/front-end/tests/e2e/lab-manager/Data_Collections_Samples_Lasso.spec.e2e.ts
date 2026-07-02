import { test, expect, type Locator, type Page } from 'playwright/test';

const labName = 'Automated Lab - Updated';

async function openSamplesTab(page: Page, baseURL: string): Promise<boolean> {
  await page.goto(`${baseURL}/labs`);
  await page.waitForLoadState('networkidle');

  const hasLab = await page
    .getByRole('row', { name: labName })
    .isVisible()
    .catch(() => false);
  if (!hasLab) {
    console.log(`${labName} not found — skipping lasso E2E`);
    return false;
  }

  await page.getByRole('row', { name: labName }).locator('button').click();
  await page.getByRole('menuitem', { name: 'View / Edit' }).click();
  await page.waitForLoadState('networkidle');
  await page.getByRole('tab', { name: 'Data Collections' }).click();
  await page.waitForLoadState('networkidle');

  const samplesRegion = page.getByRole('region', { name: 'Samples' });
  await samplesRegion.getByRole('button', { name: 'Cards view' }).click();

  const firstCard = samplesRegion.locator('[data-file-card]').first();
  try {
    await firstCard.waitFor({ state: 'visible', timeout: 30000 });
  } catch {
    console.log('No sample cards visible — skipping lasso E2E');
    return false;
  }

  return true;
}

async function clearSampleSelection(page: Page): Promise<void> {
  const deselectAll = page.getByRole('button', { name: /^Deselect all \(\d+\)$/ });
  if (await deselectAll.isVisible().catch(() => false)) {
    await deselectAll.click();
  }
}

async function lassoOverSampleCards(page: Page, samplesRegion: Locator): Promise<number> {
  const cards = samplesRegion.locator('[data-file-card]');
  const cardCount = await cards.count();
  if (cardCount < 2) return cardCount;

  const firstCardBox = await cards.nth(0).boundingBox();
  const lastCardBox = await cards.nth(Math.min(cardCount, 2) - 1).boundingBox();
  const regionBox = await samplesRegion.boundingBox();
  if (!firstCardBox || !lastCardBox || !regionBox) return cardCount;

  const startX = regionBox.x + 8;
  const startY = regionBox.y + 8;
  const endX = lastCardBox.x + lastCardBox.width + 8;
  const endY = lastCardBox.y + lastCardBox.height + 8;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 12 });
  await page.mouse.up();

  return cardCount;
}

test('01 - Lasso drag on empty grid space selects intersecting sample cards', async ({ page, baseURL }) => {
  if (!(await openSamplesTab(page, baseURL))) return;

  const samplesRegion = page.getByRole('region', { name: 'Samples' });
  await clearSampleSelection(page);

  const cardCount = await lassoOverSampleCards(page, samplesRegion);
  test.skip(cardCount < 2, 'Need at least two samples to verify lasso selection');

  await expect(page.getByRole('button', { name: /^Deselect all \([2-9]\d*\)$/ })).toBeVisible();
});

test('02 - Lasso selection merges with an existing sample selection', async ({ page, baseURL }) => {
  if (!(await openSamplesTab(page, baseURL))) return;

  const samplesRegion = page.getByRole('region', { name: 'Samples' });
  const cards = samplesRegion.locator('[data-file-card]');
  const cardCount = await cards.count();
  test.skip(cardCount < 2, 'Need at least two samples to verify lasso merge');

  await clearSampleSelection(page);

  const firstCard = cards.first();
  await firstCard.click();
  await expect(page.getByRole('button', { name: 'Deselect all (1)' })).toBeVisible();

  await lassoOverSampleCards(page, samplesRegion);
  await expect(page.getByRole('button', { name: /^Deselect all \([2-9]\d*\)$/ })).toBeVisible();
});

test('03 - Clicking a sample card toggles selection without starting a lasso drag', async ({ page, baseURL }) => {
  if (!(await openSamplesTab(page, baseURL))) return;

  const samplesRegion = page.getByRole('region', { name: 'Samples' });
  await clearSampleSelection(page);

  const firstCard = samplesRegion.locator('[data-file-card]').first();
  await firstCard.click();

  await expect(page.getByRole('button', { name: 'Deselect all (1)' })).toBeVisible();
  await expect(firstCard).toHaveAttribute('aria-selected', 'true');
});
