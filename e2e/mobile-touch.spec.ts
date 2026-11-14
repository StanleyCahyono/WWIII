import { test, expect, type Page } from '@playwright/test';
import { clearStorage, frame, shot, wc } from './helpers';

/**
 * W10 touch pass and the mobile variant of the SPEC worked interaction (iPhone 13 profile,
 * hasTouch). Every interaction is a tap (locator.tap / touchscreen.tap) or text entry; no mouse
 * clicks, no keyboard shortcuts.
 */

async function newCampaignTouch(page: Page, seed: number, url = '/') {
  await page.goto(url);
  await page.getByTestId('new-campaign').tap();
  await expect(page.getByTestId('preview-capital')).toHaveText('Jakarta', { timeout: 120_000 });
  await page.getByTestId('seed-input').fill(String(seed));
  await page.getByTestId('start-campaign').tap();
  await expect(page.getByTestId('game')).toBeVisible({ timeout: 120_000 });
  await page.getByTestId('close-briefing').tap();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function tapNav(page: Page, name: string) {
  const direct = page.getByTestId(`mnav-${name}`);
  if (!(await direct.isVisible().catch(() => false))) await page.getByRole('button', { name: 'More…' }).tap();
  await page.getByTestId(`mnav-${name}`).tap();
  await expect(page.getByTestId(`panel-${name}`)).toBeVisible();
}

async function tapSearchResult(page: Page, text: string, name: string | RegExp) {
  await page.locator('#map-search-input').tap();
  await page.locator('#map-search-input').fill(text);
  await page.locator('#map-search-results').getByRole('option', { name }).first().tap();
}

const sidcStatus = (sidc: string | null) => sidc?.charAt(6) ?? null; // APP-6 status digit: 0 present, 1 planned

test.describe('W10 touch (mobile)', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch viewport only');

  test('mobile worked interaction: Indonesia → Surabaya → maritime formation → private route idea survives Economy → +1 h, no orders → dated report stays put', async ({ page }) => {
    test.setTimeout(300_000);
    await clearStorage(page);
    await newCampaignTouch(page, 1040);
    // centre on Surabaya through search (tap the result; no Enter)
    await tapSearchResult(page, 'Surabaya', /Surabaya/);
    await expect(page.getByTestId('inspector-title')).toHaveText('Surabaya');
    const cam = await wc<{ cx: number }>(page, 'wc.camera()');
    expect(Math.abs(cam.cx - 112.7)).toBeLessThan(3);
    // a friendly maritime formation, chosen from the touch Forces list
    const fleet = await frame<{ id: string; node: number | null }>(page, `f => { const sur = f.view.cities.find(c => c.name === 'Surabaya').node; const n = f.view.stacks.filter(s => s.moveClass === 'naval'); const s = n.find(s => s.pos.kind === 'node' && s.pos.node === sur) || n[0]; return { id: s.id, node: s.pos.kind === 'node' ? s.pos.node : null }; }`);
    await tapNav(page, 'forces');
    await page.getByTestId(`formation-${fleet.id}`).tap();
    expect(await wc(page, 'wc.ui().selection')).toEqual({ kind: 'stack', id: fleet.id });
    // the bottom sheet names the current port and has a visible close button
    await expect(page.getByTestId('sheet-close')).toBeVisible();
    const port = fleet.node !== null ? await wc<string | null>(page, `wc.frame().view.cities.find(c => c.node === ${fleet.node})?.name ?? null`) : null;
    await page.getByTestId('inspector').getByRole('button', { name: 'More', exact: true }).tap();
    if (port) await expect(page.getByTestId('stack-position')).toContainText(port);
    await page.getByTestId('inspector').getByRole('button', { name: 'Less', exact: true }).tap();
    const h0 = await wc<{ hash: string }>(page, 'wc.host().hash()');
    // draw a private route idea with two taps on the map (selection kept: the nav stays below the sheet)
    await tapNav(page, 'planning');
    await page.getByTestId('draw-route').tap();
    await expect(page.getByTestId('draw-banner')).toBeVisible();
    const a = await wc<{ x: number; y: number }>(page, 'wc.project(112.75, -7.25)');
    const b = await wc<{ x: number; y: number }>(page, 'wc.project(113.6, -7.6)');
    await page.touchscreen.tap(a.x, a.y);
    await page.touchscreen.tap(b.x, b.y);
    await page.getByTestId('finish-draw').tap();
    await expect.poll(() => frame<number>(page, 'f => f.drawings.length')).toBe(1);
    expect((await wc<{ hash: string }>(page, 'wc.host().hash()')).hash).toBe(h0.hash);
    // open Economy and come back: drawing and selection preserved
    await tapNav(page, 'economy');
    await page.getByTestId('panel-close').tap();
    expect(await frame<number>(page, 'f => f.drawings.length')).toBe(1);
    expect(await wc(page, 'wc.ui().selection')).toEqual({ kind: 'stack', id: fleet.id });
    await shot(page, 'm-worked-route-idea');
    // a separate dated contact report (intelligence purchase) through touch
    await tapNav(page, 'intel');
    const sel = page.locator('#intel-target');
    await sel.selectOption((await sel.locator('option').nth(1).getAttribute('value'))!);
    await page.getByRole('button', { name: 'Assign agent' }).tap();
    await expect.poll(() => frame<number>(page, 'f => f.view.agents.length')).toBe(1);
    await page.getByTestId('buy-report').tap();
    await expect.poll(() => frame<number>(page, 'f => f.view.reports.length')).toBeGreaterThan(0);
    const rep0 = await frame<string>(page, 'f => JSON.stringify(f.view.reports.map(r => ({ id: r.id, at: r.observedAt, pos: r.stacks.map(s => s.node) })))');
    await page.getByTestId('panel-close').tap();
    // +1 h with a tap: the drawing gave the formation no orders; the report is frozen
    await page.getByTestId('step-hour').tap();
    await expect(page.getByTestId('game-clock')).toContainText('D1 07:00');
    expect(await frame<boolean>(page, `f => !!f.view.stacks.find(s => s.id === "${fleet.id}").order`)).toBe(false);
    expect(await frame<string>(page, 'f => JSON.stringify(f.view.reports.map(r => ({ id: r.id, at: r.observedAt, pos: r.stacks.map(s => s.node) })))')).toBe(rep0);
    await shot(page, 'm-worked-after');
  });

  test('W10 touch-only, monochrome: locate a unit by symbol meaning, tell planned from present, inspect a dated contact', async ({ page }) => {
    test.setTimeout(300_000);
    await clearStorage(page);
    // monochrome symbols via Settings (frame shapes, not colour, carry affiliation)
    await page.goto('/?e2e=1');
    await page.getByRole('button', { name: 'Settings' }).tap();
    await page.getByLabel('Monochrome unit symbols (frame shapes carry affiliation)').tap();
    await expect(page.getByLabel('Monochrome unit symbols (frame shapes carry affiliation)')).toBeChecked();
    await page.getByRole('button', { name: '← Back' }).tap();
    await newCampaignTouch(page, 1010, '/?e2e=1');
    expect(await wc<boolean>(page, 'wc.map().mono')).toBe(true);

    // 1. locate a unit by what its symbol means ("friendly surface" = a friendly ship formation)
    await page.locator('#map-search-input').tap();
    await page.locator('#map-search-input').fill('friendly surface');
    const hit = page.locator('#map-search-results').getByRole('option', { name: /^Friendly surface formation/ }).first();
    await expect(hit).toBeVisible();
    const sidc = await hit.locator('svg[data-sidc]').getAttribute('data-sidc');
    expect(sidc!.charAt(3)).toBe('3'); // affiliation: friend
    expect(sidc!.slice(4, 6)).toBe('30'); // symbol set: sea surface
    await hit.tap();
    const selId = await wc<{ kind: string; id: string }>(page, 'wc.ui().selection');
    expect(selId.kind).toBe('stack');
    expect(await frame<string>(page, `f => f.view.stacks.find(s => s.id === "${selId.id}").moveClass`)).toBe('naval');
    await expect(page.getByTestId('inspector').locator('svg[data-sidc]').first()).toHaveAttribute('data-sidc', sidc!);
    await page.getByTestId('sheet-close').tap();

    // 2. planned vs present without colour: queue a mobilization; the queued unit is drawn with the
    //    APP-6 planned status (dashed frame) and named "Planned", the fielded formation is present
    await tapSearchResult(page, 'Jakarta', /Jakarta/);
    await expect(page.getByTestId('inspector-title')).toHaveText('Jakarta');
    await page.getByTestId('inspector-mobilize').tap();
    await page.locator('[data-testid="unit-catalog"] button[data-testid^="mobilize-"]:not([aria-disabled="true"])').first().tap();
    await expect.poll(() => frame<number>(page, 'f => f.view.self.jobs.filter(j => j.kind === "mobilize").length')).toBe(1);
    await page.getByTestId('panel-close').tap();
    await page.getByTestId('inspector').getByRole('button', { name: 'More', exact: true }).tap();
    const planned = page.getByTestId('place-queue').locator('[role="img"]').first();
    await expect(planned).toHaveAttribute('aria-label', /^Planned unit \(not yet fielded\)/);
    expect(sidcStatus(await planned.locator('svg[data-sidc]').getAttribute('data-sidc'))).toBe('1');
    await expect(page.getByTestId('place-queue')).toContainText('Planned:');
    await page.getByTestId('sheet-close').tap();
    await tapNav(page, 'forces');
    const present = page.locator('[data-testid^="formation-"] svg[data-sidc]').first();
    expect(sidcStatus(await present.getAttribute('data-sidc'))).toBe('0');
    await page.getByTestId('panel-close').tap();
    await shot(page, 'm-w10-planned');

    // 3. a dated contact, inspected by touch: age and observation time in words, no hidden type
    const info = await wc<{ contactId: string; hiddenTypes: string[] }>(page, 'wc.host().request({ op: "debugContact" })');
    await tapNav(page, 'roster');
    await page.getByRole('button', { name: 'Known contacts', exact: true }).tap();
    const item = page.locator(`[data-roster-id="C:${info.contactId}"]`);
    await expect(item).toHaveAttribute('aria-label', /Unknown .* contact .*last observed .*\(Day \d+ \d\d:\d\d UTC\)/);
    await item.tap();
    await expect(page.getByTestId('contact-sheet')).toBeVisible();
    const sheet = await page.getByTestId('inspector').innerText();
    expect(sheet).toContain('Last observed');
    expect(sheet).toMatch(/Day 1 \d\d:\d\d UTC/);
    for (const t of info.hiddenTypes) expect(sheet).not.toContain(t);
    await shot(page, 'm-w10-contact');
  });

  test('unit dossier at narrow width: target/terrain selectors with vertically labelled values', async ({ page }) => {
    test.setTimeout(180_000);
    await clearStorage(page);
    await newCampaignTouch(page, 2121);
    await tapNav(page, 'forces');
    await page.locator('[data-testid^="formation-"]').first().tap();
    await page.getByTestId('inspector').getByRole('button', { name: 'More', exact: true }).tap();
    await page.getByTestId('inspector').getByRole('button', { name: /^Open dossier for / }).first().tap();
    const d = page.getByTestId('unit-dossier');
    await expect(d).toBeVisible();
    // narrow layout: one selector for target class, one for terrain
    const target = d.locator('label', { hasText: /^Target class/ }).locator('select');
    const terrain = d.locator('label', { hasText: /^Terrain/ }).locator('select');
    await expect(target).toBeVisible();
    await expect(terrain).toBeVisible();
    await target.selectOption('armored');
    await terrain.selectOption('mountains');
    await expect(d).toContainText('Mountains');
    await d.getByRole('button', { name: '← Previous screen' }).tap();
    await expect(page.getByTestId('unit-dossier')).toHaveCount(0);
  });
});
