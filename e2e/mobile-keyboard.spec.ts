import { test, expect, type Page } from '@playwright/test';
import { clearStorage, frame, shot } from './helpers';

async function tabTo(page: Page, selector: string, max = 250) {
  for (let i = 0; i < max; i++) {
    const hit = await page.evaluate((sel) => {
      const a = document.activeElement as HTMLElement | null;
      return !!a && a.matches(sel);
    }, selector);
    if (hit) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Could not reach ${selector} with Tab`);
}

test.describe('A12: keyboard-only on a narrow screen', () => {
  test.skip(({ isMobile }) => !isMobile, 'narrow layout only');

  test('title → new campaign → first orders using only the keyboard', async ({ page }) => {
    test.setTimeout(300_000);
    await clearStorage(page);
    await page.goto('/');
    await expect(page.getByTestId('new-campaign')).toBeVisible({ timeout: 60_000 });
    await tabTo(page, '[data-testid="new-campaign"]');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('preview-capital')).toHaveText('Jakarta', { timeout: 120_000 });
    await shot(page, 'm-01-choose');
    await tabTo(page, '[data-testid="start-campaign"]');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('game')).toBeVisible({ timeout: 120_000 });
    // briefing dialog: Escape closes the top layer
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await shot(page, 'm-02-map');

    // select a city through search (list alternative to precise taps)
    await tabTo(page, '#map-search-input');
    await page.keyboard.type('Jakarta');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('inspector-title')).toHaveText('Jakarta');
    await shot(page, 'm-03-sheet');

    // mobilize from the city sheet; Escape returns focus to the opener
    await tabTo(page, '[data-testid="inspector-mobilize"]');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('unit-catalog')).toBeVisible();
    await tabTo(page, '[data-testid="unit-catalog"] button[data-testid^="mobilize-"]:not([aria-disabled="true"])');
    await page.keyboard.press('Enter');
    await expect.poll(() => frame<number>(page, 'f => f.view.self.jobs.filter(j => j.kind === "mobilize").length')).toBeGreaterThan(0);
    await shot(page, 'm-04-mobilize');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('panel-cities')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.testid ?? null)).toBe('inspector-mobilize');

    // clear selection (Escape) → mobile nav → Forces list → select a formation
    await page.keyboard.press('Escape');
    await tabTo(page, '[data-testid="mnav-forces"]');
    await page.keyboard.press('Enter');
    await tabTo(page, '[data-testid^="formation-"]');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('inspector-title')).toBeVisible();

    // move: destination from the accessible list, preview, confirm
    await tabTo(page, '[data-testid="action-move"]');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('move-panel')).toBeVisible();
    await tabTo(page, '[data-testid="dest-select"]');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('move-eta')).toBeVisible({ timeout: 20_000 });
    if (await page.getByTestId('war-warning').isVisible().catch(() => false)) {
      await tabTo(page, '[data-testid="confirm-war"]');
      await page.keyboard.press('Space');
    }
    await shot(page, 'm-05-move');
    await tabTo(page, '[data-testid="confirm-move"]');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('active-order')).toContainText('Moving to');

    // inspect the order, cancel it (Stop) — quantities readable, disabled actions explain why
    await tabTo(page, '[data-testid="action-stop"]');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('active-order')).toContainText('no orders');
    await expect(page.getByText('No active order to stop.')).toBeVisible();

    // advance an hour with the keyboard
    await tabTo(page, '[data-testid="step-hour"]');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('game-clock')).toContainText('D1 07:00');
    await shot(page, 'm-06-after');
  });
});
