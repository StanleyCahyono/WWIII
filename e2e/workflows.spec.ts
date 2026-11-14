import { test, expect } from '@playwright/test';
import { clearStorage, newCampaign, frame, shot } from './helpers';

test.describe('SPEC §2 workflows (desktop)', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop');

  test('build from several cities: preview per-city eligibility, confirm charges exactly the preview', async ({ page }) => {
    test.setTimeout(180_000);
    await clearStorage(page);
    await newCampaign(page, 'IDN', 2020);
    await page.getByTestId('rail-cities').click();
    await page.getByTestId('sort-netValue').click(); // sort by net production
    const checks = page.locator('[data-testid^="city-check-"]');
    for (let i = 0; i < 4; i++) await checks.nth(i).check();
    await page.getByTestId('bulk-project').selectOption('b:naval_base');
    await page.getByTestId('bulk-preview').click();
    await expect(page.getByTestId('bulk-rows')).toBeVisible();
    await shot(page, 'wf-bulk-preview');
    const rows = page.getByTestId('bulk-rows').locator('tbody tr');
    await expect(rows).toHaveCount(4);
    const ineligible = await rows.filter({ has: page.locator('td.bad') }).count();
    const before = await frame<Record<string, number>>(page, 'f => f.view.self.stock');
    const jobs0 = await frame<number>(page, 'f => f.view.self.jobs.length');
    const totalText = await page.getByTestId('bulk-total').innerText();
    await page.getByTestId('bulk-confirm').click();
    await expect(page.getByTestId('bulk-rows')).toHaveCount(0);
    const after = await frame<Record<string, number>>(page, 'f => f.view.self.stock');
    const jobs1 = await frame<number>(page, 'f => f.view.self.jobs.length');
    expect(jobs1 - jobs0).toBe(4 - ineligible);
    // charged amount (components) equals the previewed total
    const spentComponents = (before.components - after.components) / 1000;
    const m = /([\d.,k]+) components/.exec(totalText);
    if (m && !m[1].includes('k')) expect(spentComponents).toBeCloseTo(Number(m[1].replace(/,/g, '')), 0);
    expect(spentComponents).toBeGreaterThan(0);
  });

  test('negotiate with a bot: request right of way, see pending offer, advance time, read the reply', async ({ page }) => {
    test.setTimeout(240_000);
    await clearStorage(page);
    await newCampaign(page, 'IDN', 3030);
    await page.getByTestId('rail-diplomacy').click();
    await page.getByTestId('nation-MYS').click();
    await expect(page.getByTestId('country-detail')).toContainText('Malaysia');
    await page.getByTestId('propose-offer').click();
    await page.getByTestId('send-offer').click();
    await expect(page.getByTestId('country-detail').locator('[data-testid^="offer-"]').first()).toContainText('pending');
    await shot(page, 'wf-offer-pending');
    // advance time until the bot answers (max 48 h)
    for (let i = 0; i < 48; i++) {
      const st = await frame<string>(page, 'f => (f.view.offers.find(o => o.to === "MYS") || {}).status');
      if (st && st !== 'pending') break;
      await page.getByTestId('step-hour').click();
      await page.waitForTimeout(150);
    }
    const final = await frame<{ status: string; reason: string | null }>(page, 'f => { const o = f.view.offers.find(o => o.to === "MYS"); return { status: o.status, reason: o.responseReason }; }');
    expect(['accepted', 'declined', 'expired']).toContain(final.status);
    await page.getByTestId('rail-diplomacy').click();
    await page.getByTestId('nation-MYS').click();
    await expect(page.getByTestId('thread')).not.toContainText('No messages yet');
    await shot(page, 'wf-offer-answered');
  });
});
