import { test, expect, type Page } from '@playwright/test';
import { clearStorage, newCampaign, frame, shot } from './helpers';

const wc = (page: Page, expr: string) => page.evaluate(`(() => { const wc = window.__wc; return ${expr}; })()`);

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

  test('SPEC worked interaction: Indonesia → Surabaya → maritime formation → private route idea survives Economy → +1 h, no orders → dated report stays put', async ({ page }) => {
    test.setTimeout(240_000);
    await clearStorage(page);
    await newCampaign(page, 'IDN', 1040);
    // centre on Surabaya
    await page.locator('#map-search-input').fill('Surabaya');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('inspector-title')).toHaveText('Surabaya');
    const cam = (await wc(page, 'wc.camera()')) as { cx: number; cy: number };
    expect(Math.abs(cam.cx - 112.7)).toBeLessThan(3);
    // a known friendly maritime formation (prefer one in Surabaya)
    const fleet = await frame<{ id: string; node: number | null }>(page, `f => { const sur = f.view.cities.find(c => c.name === 'Surabaya').node; const n = f.view.stacks.filter(s => s.moveClass === 'naval'); const s = n.find(s => s.pos.kind === 'node' && s.pos.node === sur) || n[0]; return { id: s.id, node: s.pos.kind === 'node' ? s.pos.node : null }; }`);
    await page.getByRole('button', { name: 'Roster' }).click();
    await page.locator(`[data-roster-id="S:${fleet.id}"]`).click();
    // the map selects the same object and the inspector names its current port
    expect(await wc(page, 'wc.ui().selection')).toEqual({ kind: 'stack', id: fleet.id });
    const portName = fleet.node !== null ? ((await wc(page, `wc.frame().view.cities.find(c => c.node === ${fleet.node})?.name ?? null`)) as string | null) : null;
    if (portName) await expect(page.getByTestId('stack-position')).toContainText(portName);
    else await expect(page.getByTestId('stack-position')).not.toBeEmpty();
    const h0 = (await wc(page, 'wc.host().hash()')) as { hash: string };
    // draw a private route idea
    await page.getByTestId('rail-planning').click();
    await page.getByTestId('draw-route').click();
    const a = (await wc(page, 'wc.project(112.75, -7.25)')) as { x: number; y: number };
    const b = (await wc(page, 'wc.project(115.2, -8.6)')) as { x: number; y: number };
    await page.mouse.click(a.x, a.y + 25);
    await page.mouse.click(b.x, b.y + 25);
    await page.getByTestId('finish-draw').click();
    await expect.poll(() => frame<number>(page, 'f => f.drawings.length')).toBe(1);
    expect(((await wc(page, 'wc.host().hash()')) as { hash: string }).hash).toBe(h0.hash);
    // switch to Economy and back: the drawing (and the selection) are preserved
    await page.getByTestId('rail-economy').click();
    await expect(page.getByTestId('panel-economy')).toBeVisible();
    await page.getByTestId('panel-close').click();
    expect(await frame<number>(page, 'f => f.drawings.length')).toBe(1);
    expect(await wc(page, 'wc.ui().selection')).toEqual({ kind: 'stack', id: fleet.id });
    await shot(page, 'wf-worked-route-idea');
    // a separate dated contact report (intelligence purchase)
    await page.getByTestId('rail-intel').click();
    const sel = page.locator('#intel-target');
    const v = await sel.locator('option').nth(1).getAttribute('value');
    await sel.selectOption(v!);
    await page.getByRole('button', { name: 'Assign agent' }).click();
    await expect.poll(() => frame<number>(page, 'f => f.view.agents.length')).toBe(1);
    await page.getByTestId('buy-report').click();
    await expect.poll(() => frame<number>(page, 'f => f.view.reports.length')).toBeGreaterThan(0);
    const rep0 = await frame<string>(page, 'f => JSON.stringify(f.view.reports.map(r => ({ id: r.id, at: r.observedAt, pos: r.stacks.map(s => s.node) })))');
    await page.getByTestId('panel-close').click();
    // advance one hour: drawing a line gave the formation no orders; the report is frozen
    await page.getByTestId('step-hour').click();
    await expect(page.getByTestId('game-clock')).toContainText('D1 07:00');
    expect(await frame<boolean>(page, `f => { const s = f.view.stacks.find(s => s.id === "${fleet.id}"); return !!(s && s.order); }`)).toBe(false);
    const rep1 = await frame<string>(page, 'f => JSON.stringify(f.view.reports.map(r => ({ id: r.id, at: r.observedAt, pos: r.stacks.map(s => s.node) })))');
    expect(rep1).toBe(rep0);
  });
});
