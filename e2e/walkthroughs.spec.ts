import { test, expect, type Page } from '@playwright/test';
import { clearStorage, newCampaign, frame, shot, wc, advance, advanceUntil, selectFormation, pickOwnedDestination } from './helpers';

/**
 * W08 country-viability walkthroughs (SPEC "Depth, pacing and acceptance": complete the U.S.,
 * Indonesia and landlocked walkthroughs). Every action goes through the visible UI and the
 * validated command path; time is advanced with the sim host's `step` (the ▸| button's call).
 */

export async function startResearch(page: Page) {
  await page.getByTestId('rail-research').click();
  const avail = page.locator('.tech[data-status="available"]').first();
  await avail.click();
  await page.getByTestId('start-research').click();
  await expect.poll(() => frame<number>(page, 'f => f.view.self.research.length')).toBe(1);
  const r = await frame<{ tech: string; endsAt: number }>(page, 'f => ({ tech: f.view.self.research[0].tech, endsAt: f.view.self.research[0].endsAt })');
  await page.getByTestId('panel-close').click();
  return r;
}

async function selectCity(page: Page, name: string) {
  await page.locator('#map-search-input').fill(name);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('inspector-title')).toHaveText(name);
}

async function saveReloadContinue(page: Page) {
  await page.getByTestId('save-indicator').click();
  await expect(page.getByTestId('save-indicator')).toContainText('Saved', { timeout: 15_000 });
  await page.reload();
  await expect(page.getByTestId('continue-card')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('continue').click();
  await expect(page.getByTestId('game')).toBeVisible({ timeout: 60_000 });
}

test.describe('W08 walkthroughs (desktop)', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop walkthroughs; the mobile variant is in mobile-touch.spec.ts');

  test('W08 U.S.: mobilize, build, offer, move, carrier patrol, verify outcomes; research opens on day 4 and Sealift I adds lift; save/reload', async ({ page }) => {
    test.setTimeout(600_000);
    await clearStorage(page);
    await newCampaign(page, 'USA', 1776);
    const me = await frame<{ name: string; cap: string; ai: number; humans: number; tick: number }>(page, 'f => ({ name: f.view.self.name, cap: f.view.self.capitalCity, ai: f.view.relations.filter(r => r.controller === "ai").length, humans: f.view.relations.filter(r => r.controller !== "ai").length, tick: f.view.tick })');
    expect(me).toEqual({ name: 'United States', cap: 'USA-washington', ai: 119, humans: 0, tick: 0 });
    await expect(page.getByTestId('nation-chip')).toContainText('United States');

    // The opening lead: the force screen separates fielded, ready and committed strength.
    await page.getByTestId('rail-forces').click();
    const fp = page.getByTestId('forces-panel');
    for (const t of ['Fielded strength', 'Ready strength', 'Committed', 'Maintenance']) await expect(fp).toContainText(t);
    const force = await frame<{ fielded: number; ready: number; committed: number }>(page, 'f => f.view.self.force');
    expect(force.fielded).toBeGreaterThan(0);
    expect(force.ready).toBeGreaterThan(0);
    expect(force.ready).toBeLessThanOrEqual(force.fielded);
    await page.getByTestId('panel-close').click();

    // Research on day 1: the U.S. starts with its tier-1 package complete; the next program is
    // time-locked and the tree says exactly when it opens (no silent dead end).
    await page.getByTestId('rail-research').click();
    expect(await page.locator('.tech[data-status="available"]').count()).toBe(0);
    const sealift = page.getByTestId('tech-mob_sealift_1');
    await expect(sealift).toHaveAttribute('data-status', 'time_locked');
    await expect(sealift).toHaveAttribute('aria-label', /Available from day 4/);
    await page.getByTestId('panel-close').click();

    // 1. build in a port city (Norfolk) through the city sheet
    await selectCity(page, 'Norfolk');
    await page.getByTestId('open-city-sheet').click();
    await page.getByTestId('city-tab-build').click();
    const stock0 = await frame<Record<string, number>>(page, 'f => f.view.self.stock');
    await page.locator('[data-testid="build-catalog"] button[data-testid^="build-"]:not([aria-disabled="true"])').first().click();
    await expect.poll(() => frame<number>(page, 'f => f.view.self.jobs.filter(j => j.kind === "construct").length')).toBe(1);
    const build = await frame<{ id: string; building: string; city: string; endsAt: number | null; durationMin: number; enqueuedAt: number }>(page, 'f => f.view.self.jobs.find(j => j.kind === "construct")');
    expect(build.city).toBe('USA-norfolk');
    const lvl0 = await frame<number>(page, `f => (f.view.cities.find(c => c.key === "USA-norfolk").buildings.find(b => b.type === "${build.building}") || { level: 0 }).level`);
    const stock1 = await frame<Record<string, number>>(page, 'f => f.view.self.stock');
    expect(stock1.money).toBeLessThan(stock0.money); // charged at enqueue
    await page.getByTestId('panel-close').click();

    // 2. mobilize a main battle tank unit in Washington
    await selectCity(page, 'Washington');
    await page.getByTestId('inspector-mobilize').click();
    await page.getByTestId('mobilize-arm_mbt').click();
    await expect.poll(() => frame<number>(page, 'f => f.view.self.jobs.filter(j => j.kind === "mobilize" && j.unit === "arm_mbt").length')).toBe(1);
    const mob = await frame<{ id: string; endsAt: number | null; durationMin: number; enqueuedAt: number }>(page, 'f => f.view.self.jobs.find(j => j.kind === "mobilize")');
    const mbt0 = await frame<number>(page, 'f => f.view.stacks.reduce((a, s) => a + s.units.filter(u => u.type === "arm_mbt").length, 0)');
    await page.getByTestId('panel-close').click();
    await shot(page, 'w08-usa-01-orders');

    // 3. diplomacy: request right of way from Canada
    await page.getByTestId('rail-diplomacy').click();
    await page.getByTestId('nation-CAN').click();
    await expect(page.getByTestId('country-detail')).toContainText('Canada');
    await page.getByTestId('propose-offer').click();
    await page.getByTestId('send-offer').click();
    await expect(page.getByTestId('country-detail').locator('[data-testid^="offer-"]').first()).toContainText('pending');
    await page.getByTestId('panel-close').click();

    // 4. a move order inside the homeland with route preview
    const armor = await frame<{ id: string; node: number }>(page, 'f => { const s = f.view.stacks.find(s => s.name === "1st Armored Division"); return { id: s.id, node: s.pos.node }; }');
    await selectFormation(page, armor.id);
    await page.getByTestId('action-move').click();
    await expect(page.getByTestId('move-panel')).toBeVisible();
    const dest = await pickOwnedDestination(page, 'USA', armor.node);
    await expect(page.getByTestId('move-eta')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('war-warning')).toHaveCount(0); // own territory: no border consequence
    await page.getByTestId('confirm-move').click();
    await expect(page.getByTestId('active-order')).toContainText('Moving to');
    const eta = await frame<number>(page, `f => f.view.stacks.find(s => s.id === "${armor.id}").eta`);
    expect(eta).toBeGreaterThan(0);

    // 5. carrier aviation in ordinary play: a carrier air wing ferries onto its carrier (rebase)
    const wing = await frame<{ id: string; node: number }>(page, 'f => { const s = f.view.stacks.find(s => s.name === "Carrier Air Wing 1 Fighter Squadrons"); return { id: s.id, node: s.pos.node }; }');
    const carrier = await frame<string>(page, `f => f.view.stacks.find(s => s.moveClass === "naval" && s.pos.kind === "node" && s.pos.node === ${wing.node} && s.units.some(u => u.type === "nav_carrier")).id`);
    const carrierName = await frame<string>(page, `f => f.view.stacks.find(s => s.id === "${carrier}").name`);
    await selectFormation(page, wing.id);
    await expect(page.getByTestId('aircraft-panel')).toBeVisible();
    await page.getByTestId('action-rebase').click();
    const base = page.getByTestId('rebase-base');
    await expect(base.locator('option', { hasText: `${carrierName} (carrier)` })).toBeAttached({ timeout: 15_000 });
    await base.selectOption({ label: `${carrierName} (carrier)` });
    await expect(page.getByTestId('rebase')).toContainText('Landing', { timeout: 15_000 });
    await page.getByTestId('rebase-confirm').click();
    await expect.poll(() => frame<string>(page, `f => f.view.stacks.find(s => s.id === "${wing.id}").air.state`)).toBe('rebasing');
    expect(await frame<number>(page, 'f => f.view.tick')).toBe(0); // ordering consumed no time

    // 6. advance: one visible hour, then until every day-1 order has had time to finish
    await page.getByTestId('step-hour').click();
    await expect(page.getByTestId('game-clock')).toContainText('D1 07:00');
    const target = Math.max(eta, mob.endsAt ?? mob.enqueuedAt + mob.durationMin, build.endsAt ?? build.enqueuedAt + build.durationMin);
    expect(target, 'the day-1 orders complete before day 4').toBeLessThan(3 * 1440);
    await advance(page, target - 60 + 15);
    await shot(page, 'w08-usa-02-after');
    const out = await frame<{ pos: { kind: string; node?: number }; order: unknown; jobs: string[]; mbt: number; bld: number }>(
      page,
      `f => { const s = f.view.stacks.find(s => s.id === "${armor.id}"); const c = f.view.cities.find(c => c.key === "USA-norfolk"); return { pos: s.pos, order: s.order, jobs: f.view.self.jobs.map(j => j.id), mbt: f.view.stacks.reduce((a, s) => a + s.units.filter(u => u.type === "arm_mbt").length, 0), bld: (c.buildings.find(b => b.type === "${build.building}") || { level: 0 }).level }; }`,
    );
    expect(out.pos).toEqual({ kind: 'node', node: dest });
    expect(out.order).toBeNull();
    expect(out.jobs).not.toContain(build.id);
    expect(out.jobs).not.toContain(mob.id);
    expect(out.mbt).toBe(mbt0 + 1);
    expect(out.bld).toBe(lvl0 + 1);
    // the air wing now lives on the carrier and flies a patrol from it
    expect(await frame<unknown>(page, `f => f.view.stacks.find(s => s.id === "${wing.id}").air.home`)).toEqual({ stack: carrier });
    await selectFormation(page, wing.id);
    await page.getByTestId('action-patrol').click();
    const pnode = page.getByTestId('patrol-node-select');
    await expect(pnode.locator('option').nth(1)).toBeAttached({ timeout: 15_000 });
    await pnode.selectOption((await pnode.locator('option:not([disabled])').nth(1).getAttribute('value'))!);
    await expect(page.getByTestId('patrol-preview')).toContainText('Time on station', { timeout: 15_000 });
    await page.getByTestId('patrol-confirm').click();
    await expect.poll(() => frame<string>(page, `f => f.view.stacks.find(s => s.id === "${wing.id}").air.state`)).not.toBe('landed');
    await advance(page, 60);
    await expect(page.getByTestId('air-state')).not.toContainText('Landed');
    // the inspector shows the arrived formation holding at its destination
    await selectFormation(page, armor.id);
    await expect(page.getByTestId('active-order')).toContainText('no orders');
    // the offer has been answered by the bot (within 48 h)
    await advanceUntil(page, 'f => f.view.offers.find(o => o.to === "CAN").status !== "pending"', 48 * 60, 120);
    expect(['accepted', 'declined', 'expired']).toContain(await frame<string>(page, 'f => f.view.offers.find(o => o.to === "CAN").status'));

    // 7. day 4: Sealift I opens; research it through the tree and watch the lift capacity grow
    await advance(page, 3 * 1440 - (await frame<number>(page, 'f => f.view.tick')));
    await expect(page.getByTestId('game-clock')).toContainText('D4');
    const lift0 = await frame<number>(page, 'f => f.view.self.lift');
    expect(lift0).toBeGreaterThan(0);
    await page.getByTestId('rail-research').click();
    await expect(sealift).toHaveAttribute('data-status', 'available');
    await sealift.click();
    await page.getByTestId('start-research').click();
    await expect.poll(() => frame<number>(page, 'f => f.view.self.research.length')).toBe(1);
    const res = await frame<{ tech: string; endsAt: number }>(page, 'f => f.view.self.research[0]');
    expect(res.tech).toBe('mob_sealift_1');
    await page.getByTestId('panel-close').click();
    // the engine runs in fixed 15-minute steps: completion lands on the first step at or after endsAt
    await advance(page, res.endsAt - (await frame<number>(page, 'f => f.view.tick')) + 15);
    expect(await frame<string[]>(page, 'f => f.view.self.techs')).toContain('mob_sealift_1');
    expect(await frame<number>(page, 'f => f.view.self.lift')).toBe(lift0 + 4);
    await page.getByTestId('rail-journal').click();
    await page.getByTestId('journal-filter-research').click();
    await expect(page.getByTestId('journal-panel')).toContainText('Sealift I');
    await page.getByTestId('panel-close').click();

    // 8. save → reload → continue: same clock, balances, techs, formations and offer state
    const snap = 'f => ({ tick: f.view.tick, stock: f.view.self.stock, techs: f.view.self.techs.length, stacks: f.view.stacks.length, offer: f.view.offers.find(o => o.to === "CAN").status, lift: f.view.self.lift })';
    const before = await frame<Record<string, unknown>>(page, snap);
    await saveReloadContinue(page);
    expect(await frame<Record<string, unknown>>(page, snap)).toEqual(before);
  });

  test('W08 landlocked Bolivia over five days: economy, market, diplomacy both ways, coalition application, no naval options anywhere', async ({ page }) => {
    test.setTimeout(600_000);
    await clearStorage(page);
    await newCampaign(page, 'BOL', 2024);
    const me = await frame<{ name: string; cap: string; ai: number; naval: number; coastal: number }>(page, 'f => ({ name: f.view.self.name, cap: f.view.self.capitalCity, ai: f.view.relations.filter(r => r.controller === "ai").length, naval: f.view.stacks.filter(s => s.moveClass === "naval").length, coastal: f.view.cities.filter(c => c.port).length })');
    expect(me).toMatchObject({ name: 'Bolivia', cap: 'BOL-la-paz', ai: 119, naval: 0 });

    // ── no naval options: bulk projects, city catalogs (even with locked items shown), embark ──
    await page.getByTestId('rail-cities').click();
    const projects = await page.getByTestId('bulk-project').locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    expect(projects).toContain('u:inf_motorized');
    expect(projects.filter((v) => /naval_base|u:nav_|u:sub_|u:off_naval/.test(v))).toEqual([]);
    await page.getByTestId('panel-close').click();
    await selectCity(page, 'La Paz');
    await page.getByTestId('inspector-mobilize').click();
    await expect(page.getByTestId('no-naval-note')).toContainText('not on the coast');
    await page.getByLabel('Show units still locked by research').check();
    const units = await page.getByTestId('unit-catalog').locator('button[data-testid^="mobilize-"]').evaluateAll((bs) => bs.map((b) => (b as HTMLElement).dataset.testid));
    expect(units.length).toBeGreaterThan(5);
    expect(units.filter((t) => /mobilize-(nav_|sub_|off_naval)/.test(t ?? ''))).toEqual([]);
    // a homeland mobilization (motorized infantry) — through the validated path
    await page.getByTestId('mobilize-inf_motorized').click();
    await expect.poll(() => frame<number>(page, 'f => f.view.self.jobs.filter(j => j.kind === "mobilize").length')).toBe(1);
    const mob = await frame<{ id: string; endsAt: number }>(page, 'f => f.view.self.jobs.find(j => j.kind === "mobilize")');
    await page.getByTestId('city-tab-build').click();
    await expect(page.getByTestId('no-naval-note')).toContainText('naval base is not offered');
    await expect(page.getByTestId('build-naval_base')).toHaveCount(0);
    await expect(page.getByTestId('build-army_base')).toBeVisible();
    await page.getByTestId('panel-close').click();
    const ground = await frame<{ id: string; node: number }>(page, 'f => { const s = f.view.stacks.find(s => s.moveClass === "ground"); return { id: s.id, node: s.pos.node }; }');
    await selectFormation(page, ground.id);
    await expect(page.getByTestId('action-embark')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('inspector')).toContainText('Embarking requires a coastal province.');
    // a move inside Bolivia
    await page.getByTestId('action-move').click();
    const dest = await pickOwnedDestination(page, 'BOL', ground.node);
    await expect(page.getByTestId('move-eta')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('confirm-move').click();
    await expect(page.getByTestId('active-order')).toContainText('Moving to');

    // ── economy day 1: the first report names a Bolivia-specific choice; forecasts are shown ──
    await page.getByTestId('rail-economy').click();
    await expect(page.getByTestId('economic-report')).toContainText('Bolivia');
    await expect(page.getByTestId('balance-table')).toContainText('In 24 h');
    const fc = await frame<Record<string, number>>(page, 'f => Object.fromEntries(f.view.self.resources.map(r => [r.resource, r.forecast24h]))');
    await page.getByTestId('panel-close').click();

    // ── diplomacy: send a request to a neighbour ──
    await page.getByTestId('rail-diplomacy').click();
    await page.getByTestId('nation-PER').click();
    await page.getByTestId('propose-offer').click();
    await page.getByTestId('send-offer').click();
    await expect(page.getByTestId('country-detail').locator('[data-testid^="offer-"]').first()).toContainText('pending');
    await page.getByTestId('panel-close').click();

    // ── day 2 ──
    await advance(page, 1440);
    await expect(page.getByTestId('game-clock')).toContainText('D2');
    // the 24 h forecast matched what actually happened to money (no other money flows were ordered)
    const money = await frame<number>(page, 'f => f.view.self.resources.find(r => r.resource === "money").onHand');
    expect(Math.abs(money - fc.money)).toBeLessThanOrEqual(Math.max(1000, Math.abs(fc.money) * 0.02));
    // the motorized unit is fielded; the move arrived
    expect(await frame<string[]>(page, 'f => f.view.self.jobs.map(j => j.id)')).not.toContain(mob.id);
    expect(await frame<{ kind: string; node?: number }>(page, `f => f.view.stacks.find(s => s.id === "${ground.id}").pos`)).toEqual({ kind: 'node', node: dest });

    // ── market: buy against a computer country's ask (crosses now → filled immediately) ──
    const ask = await frame<{ r: string; price: number; qty: number } | null>(page, 'f => { for (const [r, b] of Object.entries(f.view.market.books)) if (b.asks.length) return { r, price: b.asks[0].price, qty: b.asks[0].qty }; return null; }');
    expect(ask, 'computer countries post sell offers by day 2').not.toBeNull();
    const qty = Math.min(10, ask!.qty);
    await page.getByTestId('rail-market').click();
    const form = page.getByTestId('order-form');
    await form.getByLabel('Buy').check();
    await form.getByLabel('Resource').selectOption(ask!.r);
    await page.getByTestId('order-qty').fill(String(qty));
    await page.getByTestId('order-price').fill((ask!.price / 1000).toFixed(3));
    await expect(form).toContainText(`${qty} units for`);
    const b0 = await frame<Record<string, number>>(page, 'f => f.view.self.stock');
    await page.getByTestId('place-order').click();
    await expect.poll(() => frame<number>(page, 'f => f.view.market.myFills.length')).toBeGreaterThan(0);
    const b1 = await frame<Record<string, number>>(page, 'f => f.view.self.stock');
    expect(b1[ask!.r] - b0[ask!.r]).toBe(qty * 1000);
    expect(b0.money - b1.money).toBe(qty * ask!.price);
    await page.getByRole('tab', { name: 'My trades' }).click();
    await expect(page.getByTestId('market-panel')).toContainText('bought from');
    await page.getByTestId('panel-close').click();

    // ── answer a computer country's offer (explicit accept/decline controls for the recipient) ──
    const incoming = await advanceUntil(page, `f => f.view.offers.some(o => o.to === "BOL" && o.status === "pending")`, 3 * 1440, 360);
    expect(incoming, 'a computer country sends Bolivia an offer within three days').toBeGreaterThanOrEqual(0);
    const offer = await frame<{ id: string; from: string }>(page, 'f => f.view.offers.find(o => o.to === "BOL" && o.status === "pending")');
    await page.getByTestId('rail-diplomacy').click();
    await page.getByTestId(`nation-${offer.from}`).click();
    const card = page.getByTestId(`offer-${offer.id}`);
    await expect(card).toContainText('pending');
    await card.getByRole('button', { name: 'Accept' }).click();
    await expect(card).toContainText('accepted');
    await expect(card.getByRole('button', { name: 'Accept' })).toHaveCount(0); // no second acceptance
    await page.getByTestId('panel-close').click();

    // ── coalitions by day 5: apply to one ──
    await advanceUntil(page, 'f => f.view.coalitions.some(c => !c.dissolvedAt && c.members.length < 5)', 3 * 1440, 720);
    const co = await frame<{ id: string; name: string } | null>(page, 'f => { const c = f.view.coalitions.find(c => !c.dissolvedAt && c.members.length < 5); return c ? { id: c.id, name: c.name } : null; }');
    expect(co, 'computer countries form an open coalition').not.toBeNull();
    await page.getByTestId('rail-coalition').click();
    const cp = page.getByTestId('coalition-panel');
    await cp.getByRole('row', { name: new RegExp(co!.name) }).getByRole('button', { name: 'Details' }).click();
    await cp.getByRole('button', { name: 'Apply to join' }).click();
    await expect(page.getByTestId('toasts')).toContainText(`Applied to ${co!.name}`);
    await page.getByTestId('panel-close').click();
    await shot(page, 'w08-bol-coalition');

    // ── day 5 status: score, journal and a clean save/reload ──
    const day = await frame<number>(page, 'f => f.view.day');
    if (day < 5) await advance(page, (5 - day) * 1440);
    await expect(page.getByTestId('game-clock')).toContainText('D5');
    await page.getByTestId('score-button').click();
    await expect(page.getByTestId('standings')).toContainText('Bolivia');
    await page.getByTestId('panel-close').click();
    expect(await frame<number>(page, 'f => f.view.stacks.filter(s => s.moveClass === "naval").length')).toBe(0);
    const snap = 'f => JSON.stringify({ tick: f.view.tick, stock: f.view.self.stock, stacks: f.view.stacks.map(s => s.id), offers: f.view.offers.map(o => [o.id, o.status]), co: f.view.myCoalition })';
    const before = await frame<string>(page, snap);
    await saveReloadContinue(page);
    expect(await frame<string>(page, snap)).toBe(before);
  });

  test('W08 Indonesia over three days: archipelago build-up, fleet to sea, 24/72 h forecasts, newspaper editions, save/reload', async ({ page }) => {
    test.setTimeout(600_000);
    await clearStorage(page);
    await newCampaign(page, 'IDN', 3003);
    // research and a naval base in a port
    const res = await startResearch(page);
    await selectCity(page, 'Surabaya');
    await page.getByTestId('open-city-sheet').click();
    await page.getByTestId('city-tab-build').click();
    await expect(page.getByTestId('no-naval-note')).toHaveCount(0); // coastal: naval options exist
    await page.getByTestId('build-naval_base').click();
    await expect.poll(() => frame<number>(page, 'f => f.view.self.jobs.filter(j => j.kind === "construct" && j.building === "naval_base").length')).toBe(1);
    const nb = await frame<{ id: string; endsAt: number | null; enqueuedAt: number; durationMin: number }>(page, 'f => f.view.self.jobs.find(j => j.building === "naval_base")');
    await page.getByTestId('panel-close').click();
    // a fleet sails to an adjacent sea zone
    const fleet = await frame<{ id: string; node: number }>(page, 'f => { const s = f.view.stacks.find(s => s.moveClass === "naval" && s.pos.kind === "node"); return { id: s.id, node: s.pos.node }; }');
    await selectFormation(page, fleet.id);
    await page.getByTestId('action-move').click();
    const sel = page.getByTestId('dest-select');
    await expect(sel.locator('option', { hasText: '(sea)' }).first()).toBeAttached();
    const seaVal = await sel.locator('option', { hasText: '(sea)' }).first().getAttribute('value');
    await sel.selectOption(seaVal!);
    await expect(page.getByTestId('move-eta')).toBeVisible({ timeout: 20_000 });
    if (await page.getByTestId('war-warning').isVisible().catch(() => false)) await page.getByTestId('cancel-move').click();
    else await page.getByTestId('confirm-move').click();
    const fleetEta = await frame<number | null>(page, `f => f.view.stacks.find(s => s.id === "${fleet.id}").eta ?? null`);
    // forecasts for 24 h and 72 h before any time passes
    const fc = await frame<{ f24: number; f72: number }>(page, 'f => { const r = f.view.self.resources.find(r => r.resource === "money"); return { f24: r.forecast24h, f72: r.forecast72h }; }');
    await advance(page, 1440);
    const m24 = await frame<number>(page, 'f => f.view.self.resources.find(r => r.resource === "money").onHand');
    expect(Math.abs(m24 - fc.f24)).toBeLessThanOrEqual(Math.max(1000, Math.abs(fc.f24) * 0.02));
    await advance(page, 2 * 1440);
    await expect(page.getByTestId('game-clock')).toContainText('D4');
    const out = await frame<{ techs: string[]; jobs: string[]; lvl: number; pos: { kind: string; node?: number }; order: unknown }>(page, `f => { const c = f.view.cities.find(c => c.name === "Surabaya"); const s = f.view.stacks.find(s => s.id === "${fleet.id}"); return { techs: f.view.self.techs, jobs: f.view.self.jobs.map(j => j.id), lvl: (c.buildings.find(b => b.type === "naval_base") || { level: 0 }).level, pos: s ? s.pos : null, order: s ? s.order : null }; }`);
    if (res.endsAt <= 4 * 1440 - 1440) expect(out.techs).toContain(res.tech);
    if ((nb.endsAt ?? nb.enqueuedAt + nb.durationMin) <= 3 * 1440) {
      expect(out.jobs).not.toContain(nb.id);
      expect(out.lvl).toBeGreaterThan(0);
    }
    if (fleetEta !== null) {
      expect(out.order).toBeNull();
      expect(out.pos).toEqual({ kind: 'node', node: Number(seaVal) });
    }
    // three editions exist, the fourth (today) is the newest
    await page.getByTestId('rail-news').click();
    const np = page.getByTestId('news-panel');
    await expect(np).toContainText('Day 4');
    await expect(np.getByRole('button', { name: 'Next edition' })).toBeDisabled();
    for (const d of [3, 2, 1]) {
      await np.getByRole('button', { name: 'Previous edition' }).click();
      await expect(np).toContainText(`Day ${d}`);
    }
    await expect(np.getByRole('button', { name: 'Previous edition' })).toBeDisabled();
    await page.getByTestId('panel-close').click();
    const snap = 'f => JSON.stringify({ tick: f.view.tick, stock: f.view.self.stock, techs: f.view.self.techs, stacks: f.view.stacks.map(s => [s.id, s.pos]) })';
    const before = await frame<string>(page, snap);
    await saveReloadContinue(page);
    expect(await frame<string>(page, snap)).toBe(before);
  });
});
