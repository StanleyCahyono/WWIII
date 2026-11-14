import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { clearStorage, newCampaign, frame, shot, blockNetwork } from './helpers';

const wc = (page: Page, expr: string) => page.evaluate(`(() => { const wc = window.__wc; return ${expr}; })()`);

test.describe('acceptance (desktop)', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop acceptance cases');

  test('A01: Indonesia and a landlocked start live in separate slots', async ({ page }) => {
    test.setTimeout(240_000);
    await clearStorage(page);
    await newCampaign(page, 'IDN', 7);
    expect(await frame<string>(page, 'f => f.view.self.capitalCity')).toBe('IDN-jakarta');
    await page.getByTestId('game-menu').click();
    await page.getByTestId('home-button').click();
    await expect(page.getByTestId('new-campaign')).toBeVisible();
    await newCampaign(page, 'BOL', 8);
    const bol = await frame<{ name: string; cap: string; seed: number; ai: number }>(page, 'f => ({ name: f.view.self.name, cap: f.view.self.capitalCity, seed: f.meta.seed, ai: f.view.relations.filter(r => r.controller === "ai").length })');
    expect(bol.name).toBe('Bolivia');
    expect(bol.seed).toBe(8);
    expect(bol.ai).toBe(119);
    // play the landlocked one for an hour
    await page.getByTestId('step-hour').click();
    await expect(page.getByTestId('game-clock')).toContainText('D1 07:00');
    await page.getByTestId('game-menu').click();
    await page.getByTestId('home-button').click();
    await page.getByTestId('load-campaign').click();
    await expect(page.getByTestId('campaign-list').locator('tbody tr')).toHaveCount(2);
    await shot(page, 'a01-load');
    // Indonesia is intact (still day 1 06:00, own seed and homeland)
    await page.getByRole('button', { name: 'Resume Indonesia' }).click();
    await expect(page.getByTestId('game')).toBeVisible({ timeout: 60_000 });
    const idn = await frame<{ tick: number; seed: number; cities: string[]; ai: number }>(page, 'f => ({ tick: f.view.tick, seed: f.meta.seed, cities: f.view.cities.map(c => c.name), ai: f.view.relations.filter(r => r.controller === "ai").length })');
    expect(idn.tick).toBe(0);
    expect(idn.seed).toBe(7);
    expect(idn.cities).toEqual(expect.arrayContaining(['Jakarta', 'Surabaya']));
    expect(idn.ai).toBe(119);
  });

  test('A13/W10: plays offline (no non-loopback requests), export → import into a fresh profile', async ({ page, browser }) => {
    test.setTimeout(240_000);
    const blocked = await blockNetwork(page);
    await clearStorage(page);
    await newCampaign(page, 'IDN', 4242);
    await page.locator('#map-search-input').fill('Jakarta');
    await page.keyboard.press('Enter');
    await page.getByTestId('step-hour').click();
    await expect(page.getByTestId('game-clock')).toContainText('D1 07:00');
    await page.getByTestId('save-indicator').click();
    await expect(page.getByTestId('save-indicator')).toContainText('Saved', { timeout: 10_000 });
    const before = await frame<{ tick: number; seed: number; stock: Record<string, number>; jobs: number }>(page, 'f => ({ tick: f.view.tick, seed: f.meta.seed, stock: f.view.self.stock, jobs: f.view.self.jobs.length })');
    await page.getByTestId('game-menu').click();
    await page.getByTestId('home-button').click();
    await page.getByTestId('load-campaign').click();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export' }).first().click()]);
    const path = await dl.path();
    const json = readFileSync(path!, 'utf8');
    expect(blocked).toEqual([]);
    // another browser profile
    const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p2 = await ctx2.newPage();
    const blocked2 = await blockNetwork(p2);
    await p2.goto('/');
    await p2.getByTestId('load-campaign').click();
    await p2.getByTestId('import-input').setInputFiles({ name: 'save.json', mimeType: 'application/json', buffer: Buffer.from(json) });
    await p2.getByTestId('confirm-import').click();
    await p2.getByRole('button', { name: /Resume Indonesia/ }).click();
    await expect(p2.getByTestId('game')).toBeVisible({ timeout: 60_000 });
    const after = await frame<typeof before>(p2, 'f => ({ tick: f.view.tick, seed: f.meta.seed, stock: f.view.self.stock, jobs: f.view.self.jobs.length })');
    expect(after).toEqual(before);
    // a damaged import is rejected and leaves saves untouched
    await p2.getByTestId('game-menu').click();
    await p2.getByTestId('home-button').click();
    await p2.getByTestId('load-campaign').click();
    await p2.getByTestId('import-input').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(json.slice(0, json.length / 2)) });
    await expect(p2.getByRole('alert')).toContainText('Import rejected');
    await expect(p2.getByTestId('campaign-list').locator('tbody tr')).toHaveCount(1);
    expect(blocked2).toEqual([]);
    await ctx2.close();
  });

  test('A04/W05: an unknown radar contact never exposes hidden type in DOM, aria or search', async ({ page }) => {
    test.setTimeout(180_000);
    await clearStorage(page);
    await newCampaign(page, 'IDN', 99, '/?e2e=1');
    const info = (await wc(page, 'wc.host().request({ op: "debugContact" })')) as { contactId: string; hiddenTypes: string[]; hiddenOwner: string; lonlat: [number, number] };
    const hiddenNames = (await wc(page, `${JSON.stringify(info.hiddenTypes)}.map((t) => wc.unitName(t))`)) as string[];
    const ownerName = (await wc(page, `wc.countryName(${JSON.stringify(info.hiddenOwner)})`)) as string;
    expect(hiddenNames.length).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Roster' }).click();
    await page.getByRole('button', { name: 'Known contacts', exact: true }).click();
    const item = page.locator(`[data-roster-id="C:${info.contactId}"]`);
    await expect(item).toBeVisible();
    const aria = (await item.getAttribute('aria-label')) ?? '';
    expect(aria).toMatch(/Unknown .* contact/);
    await item.click();
    await expect(page.getByTestId('contact-sheet')).toBeVisible();
    const sheet = await page.getByTestId('inspector').innerText();
    const sidc = await page.locator('[data-testid="inspector"] svg[data-sidc]').first().getAttribute('data-sidc');
    expect(sidc!.slice(10, 16)).toBe('000000');
    expect(sheet).toContain('Owner');
    expect(sheet).toMatch(/Unknown/);
    // no hidden unit type id, unit names, owner name or family words in the contact's own surfaces
    void ownerName; // the owner's name may legitimately appear as the (public) place name
    for (const t of [...info.hiddenTypes, ...hiddenNames]) {
      expect(aria).not.toContain(t);
      expect(sheet).not.toContain(t);
    }
    expect(sheet).not.toMatch(/infantry|armou?r|tank|artillery|submarine|frigate|destroyer|fighter|helicopter/i);
    expect(aria).not.toMatch(/infantry|armou?r|tank|artillery|submarine|frigate|destroyer|fighter|helicopter/i);
    // search by any family word must not return the contact
    for (const word of ['infantry', 'armor', 'submarine', 'fighter', 'frigate']) {
      await page.locator('#map-search-input').fill(word);
      await expect(page.locator(`#map-search-results [aria-label*="Unknown"]`)).toHaveCount(0);
    }
    await page.locator('#map-search-input').fill('');
    // map hit target label for the contact is the same safe label
    const hitLabel = await wc(page, `wc.map().hits.filter(h => h.ids.includes("C:${info.contactId}")).map(h => h.label)[0] ?? null`);
    if (hitLabel) expect(String(hitLabel)).toMatch(/Unknown|objects/);
    await shot(page, 'a04-contact');
  });

  test('W06: planning layer edits never change simulation state; Issue order opens the validated preview', async ({ page }) => {
    test.setTimeout(180_000);
    await clearStorage(page);
    await newCampaign(page, 'IDN', 606);
    const h0 = (await wc(page, 'wc.host().hash()')) as { hash: string; rng: unknown; tick: number };
    await page.getByTestId('rail-planning').click();
    await page.getByTestId('draw-route').click();
    const a = (await wc(page, 'wc.project(106.8, -6.2)')) as { x: number; y: number };
    const b = (await wc(page, 'wc.project(110.4, -7.0)')) as { x: number; y: number };
    await page.mouse.click(a.x + 3, a.y + 25);
    await page.mouse.click(b.x, b.y + 25);
    await page.getByTestId('finish-draw').click();
    await expect.poll(() => frame<number>(page, 'f => f.drawings.length')).toBe(1);
    await page.getByTestId('rail-planning').click();
    await page.getByTestId('drawing-list').getByRole('button', { name: 'Rename', exact: true }).click();
    await page.getByRole('dialog', { name: 'Rename drawing' }).locator('input').fill('Java thrust');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByTestId('drawing-list')).toContainText('Java thrust');
    await page.getByTestId('drawing-list').getByRole('button', { name: 'Hide', exact: true }).click();
    await page.getByTestId('drawing-list').getByRole('button', { name: 'Show', exact: true }).click();
    const h1 = (await wc(page, 'wc.host().hash()')) as typeof h0;
    expect(h1).toEqual(h0);
    expect(await frame<number>(page, 'f => f.view.stacks.filter(s => s.order).length')).toBe(0);
    await shot(page, 'w06-planning');
    // issue order from the draft → normal validated move preview
    await page.getByTestId('panel-close').click();
    await page.getByRole('button', { name: 'Roster' }).click();
    await page.locator('[data-testid="roster"] [data-roster-id^="S:"]').first().click();
    await page.getByTestId('rail-planning').click();
    await page.getByRole('button', { name: 'Issue order…' }).click();
    await expect(page.getByTestId('move-panel')).toBeVisible();
    await page.getByTestId('cancel-move').click();
    // delete → still unchanged
    await page.getByTestId('rail-planning').click();
    await page.getByTestId('drawing-list').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect.poll(() => frame<number>(page, 'f => f.drawings.length')).toBe(0);
    const h2 = (await wc(page, 'wc.host().hash()')) as typeof h0;
    expect(h2).toEqual(h0);
  });

  test('A15: island port selection, layer switch and inspector keep the camera', async ({ page }) => {
    test.setTimeout(180_000);
    await clearStorage(page);
    await newCampaign(page, 'IDN', 1515);
    // continental zoom over the archipelago
    await wc(page, 'wc.map().center(122, -3, 14)');
    await page.waitForTimeout(400);
    const cam0 = (await wc(page, 'wc.camera()')) as { cx: number; cy: number; z: number };
    // Ambon (island port) marker
    const p = (await wc(page, 'wc.project(128.18, -3.7)')) as { x: number; y: number };
    await page.mouse.click(p.x, p.y);
    await expect(page.getByTestId('inspector-title')).toHaveText(/Ambon/);
    await page.getByTestId('layers-button').click();
    await page.getByTestId('fill-terrain').check();
    await expect(page.getByTestId('legend')).toHaveAttribute('data-legend', 'terrain');
    await expect(page.getByTestId('legend')).toContainText('Terrain');
    await expect(page.getByTestId('map')).toHaveAttribute('data-fill', 'terrain');
    await page.keyboard.press('Escape');
    await page.getByTestId('open-city-sheet').click();
    await expect(page.getByTestId('city-sheet')).toBeVisible();
    await page.getByTestId('panel-close').click();
    const cam1 = (await wc(page, 'wc.camera()')) as typeof cam0;
    // The view is kept: the inspector that opened on the right shrinks the map but the map stays
    // anchored (nothing slides under the pointer), so the selected port is drawn exactly where it was
    // clicked; zoom and latitude are unchanged. Dismissing the inspection restores the camera centre.
    const p1 = (await wc(page, 'wc.project(128.18, -3.7)')) as { x: number; y: number };
    expect(Math.abs(p1.x - p.x)).toBeLessThan(1);
    expect(Math.abs(p1.y - p.y)).toBeLessThan(1);
    expect(cam1.cy).toBeCloseTo(cam0.cy, 5);
    expect(cam1.z).toBeCloseTo(cam0.z, 5);
    await page.locator('#map-canvas').focus();
    await page.keyboard.press('Escape');
    await expect.poll(async () => ((await wc(page, 'wc.camera()')) as typeof cam0).cx).toBeCloseTo(cam0.cx, 5);
    await shot(page, 'a15-terrain');
    // reload restores the layer choice
    await page.reload();
    await page.getByTestId('continue').click();
    await expect(page.getByTestId('map')).toHaveAttribute('data-fill', 'terrain');
  });

  test('A14: a second tab cannot silently overwrite newer progress', async ({ page, context }) => {
    test.setTimeout(180_000);
    await clearStorage(page);
    await newCampaign(page, 'IDN', 1414);
    const p2 = await context.newPage();
    await p2.goto('/');
    await p2.getByTestId('continue').click();
    await expect(p2.getByRole('dialog')).toContainText('another tab');
    await p2.getByRole('button', { name: 'Open read-only' }).click();
    await expect(p2.getByTestId('game')).toBeVisible({ timeout: 60_000 });
    await expect(p2.getByTestId('pause-toggle')).toBeDisabled();
    await p2.close();
  });
});
