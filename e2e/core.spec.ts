import { test, expect } from '@playwright/test';
import { clearStorage, newCampaign, frame, shot } from './helpers';

test.describe('core loop (desktop)', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop flow; mobile covered by a12');

  test('title → Indonesia → research, build, recruit, move, advance, save, reload, continue', async ({ page }) => {
    test.setTimeout(240_000);
    await clearStorage(page);
    await newCampaign(page, 'IDN', 12345);
    await shot(page, 'core-01-map');

    // map opens centred on the Jakarta region, paused
    const cam = await page.evaluate(() => (window as unknown as { __wc: { camera: () => { cx: number; cy: number; z: number } } }).__wc.camera());
    expect(cam.cx).toBeGreaterThan(95);
    expect(cam.cx).toBeLessThan(120);
    expect(-cam.cy).toBeGreaterThan(-15);
    expect(-cam.cy).toBeLessThan(5);
    await expect(page.getByTestId('pause-toggle')).toHaveAttribute('aria-pressed', 'false');
    const t0 = await frame<number>(page, 'f => f.view.tick');
    expect(t0).toBe(0);

    // select a city
    await page.locator('#map-search-input').fill('Surabaya');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('inspector-title')).toHaveText('Surabaya');

    // start research
    await page.getByTestId('rail-research').click();
    const avail = page.locator('.tech[data-status="available"]').first();
    await avail.click();
    await page.getByTestId('start-research').click();
    await expect.poll(() => frame<number>(page, 'f => f.view.self.research.length')).toBe(1);
    await shot(page, 'core-02-research');
    await page.getByTestId('panel-close').click();

    // order a building in Surabaya (city sheet → build)
    await page.getByTestId('open-city-sheet').click();
    await page.getByTestId('city-tab-build').click();
    const buildBtn = page.locator('[data-testid="build-catalog"] button[data-testid^="build-"]:not([aria-disabled="true"])').first();
    await buildBtn.click();
    await expect.poll(() => frame<number>(page, 'f => f.view.self.jobs.filter(j => j.kind === "construct").length')).toBeGreaterThan(0);
    await shot(page, 'core-03-build');

    // recruit in another city (Jakarta)
    await page.getByTestId('panel-close').click();
    await page.locator('#map-search-input').fill('Jakarta');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('inspector-title')).toHaveText('Jakarta');
    await page.getByTestId('inspector-mobilize').click();
    const mob = page.locator('[data-testid="unit-catalog"] button[data-testid^="mobilize-"]:not([aria-disabled="true"])').first();
    await mob.click();
    await expect.poll(() => frame<number>(page, 'f => f.view.self.jobs.filter(j => j.kind === "mobilize").length')).toBeGreaterThan(0);
    await page.getByTestId('panel-close').click();

    // move a unit with preview & confirm (roster → Move → destination list → preview → confirm)
    await page.getByRole('button', { name: 'Roster' }).click();
    await page.locator('[data-testid="roster"] [data-roster-id^="S:"]').first().click();
    await page.getByTestId('action-move').click();
    await expect(page.getByTestId('move-panel')).toBeVisible();
    const sel = page.getByTestId('dest-select');
    const opt = await sel.locator('option').nth(4).getAttribute('value');
    await sel.selectOption(opt!);
    await expect(page.getByTestId('move-eta')).toBeVisible({ timeout: 20_000 });
    await shot(page, 'core-04-move-preview');
    if (await page.getByTestId('war-warning').isVisible().catch(() => false)) await page.getByTestId('confirm-war').check();
    await page.getByTestId('confirm-move').click();
    await expect(page.getByTestId('active-order')).toContainText('Moving to');
    expect(await frame<number>(page, 'f => f.view.tick')).toBe(0); // no time consumed by ordering

    // advance one hour
    await page.getByTestId('step-hour').click();
    await expect(page.getByTestId('game-clock')).toContainText('D1 07:00');
    await shot(page, 'core-05-after-hour');

    // save
    await page.getByTestId('save-indicator').click();
    await expect(page.getByTestId('save-indicator')).toContainText('Saved', { timeout: 10_000 });

    // reload → Continue shows the save
    await page.reload();
    await expect(page.getByTestId('continue-card')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('continue-card')).toContainText('Indonesia');
    await expect(page.getByTestId('continue-day')).toContainText('Day 1 · 07:00');
    await shot(page, 'core-06-continue');
    await page.getByTestId('continue').click();
    await expect(page.getByTestId('game')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('game-clock')).toContainText('D1 07:00');
    expect(await frame<number>(page, 'f => f.view.self.research.length')).toBe(1);
    expect(await frame<number>(page, 'f => f.view.stacks.filter(s => s.order).length')).toBeGreaterThan(0);
  });
});
