import { test, expect, type Page } from '@playwright/test';
import { clearStorage, newCampaign, frame, wc, advance, advanceUntil, selectFormation, pickOwnedDestination, openTargetList } from './helpers';

/**
 * Verification pass 2: UI rows that had no end-to-end test (COVERAGE "awaiting verification").
 * Every state change goes through the validated command path (UI buttons → exec → worker →
 * submitCommand). Test-only worker ops (`?e2e=1`) are named where used.
 */

type MapHit = { kind: string; ids: string[]; label: string; locate?: boolean; x: number; y: number; w: number; h: number; cx: number; cy: number };

/** Current renderer hit boxes (after the next painted frames) in page coordinates, filtered. */
async function mapHits(page: Page, keep: (h: MapHit) => boolean, settleMs = 500): Promise<MapHit[]> {
  if (settleMs) await page.waitForTimeout(settleMs);
  const all = await wc<MapHit[]>(page, `(() => { const m = wc.map(); const b = m.canvas.getBoundingClientRect(); return m.hits.map(h => ({ ...h, cx: b.left + h.x + h.w / 2, cy: b.top + h.y + h.h / 2 })); })()`);
  return all.filter(keep);
}

type Res = { resource: string; spendable: number; reserved: number; netPerDay: number; insufficientStock: boolean; negativeNet: boolean; hoursToDepletion: number | null };

test.describe('verification pass 2 (desktop)', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop');

  test('resource strip: stock and net per good, negative net vs insufficient stock, shortage ledger row, tooltip breakdown, opens the market; time strip previews without advancing', async ({ page }) => {
    test.setTimeout(240_000);
    await clearStorage(page);
    // Singapore starts with a small negative net on supplies (upkeep above production).
    await newCampaign(page, 'SGP', 2121);
    const strip = page.getByTestId('resource-strip');
    await expect(strip.locator('[data-testid^="res-"]')).toHaveCount(7);
    const res0 = await frame<Res[]>(page, 'f => f.view.self.resources');
    const sup0 = res0.find((r) => r.resource === 'supplies')!;
    expect(sup0.negativeNet).toBe(true);
    expect(sup0.insufficientStock).toBe(false);
    // every good shows its spendable stock and its signed daily net, as in the frame
    for (const r of res0) {
      const b = page.getByTestId(`res-${r.resource}`);
      await expect(b).toHaveAttribute('aria-label', /spendable, net [+−-]?[\d,.]+ per day/);
      await expect(b.locator('.rnet')).toHaveText(/\/d$/);
      await expect(b.locator('.rnet')).toHaveClass(r.netPerDay < 0 ? /bad/ : /ok/);
    }
    // negative net (stock still available): marked, labelled, but not "short"
    const sup = page.getByTestId('res-supplies');
    await expect(sup).toHaveClass(/negative/);
    await expect(sup).not.toHaveClass(/short/);
    await expect(sup).toHaveAttribute('aria-label', /negative net/);
    await expect(sup.locator('.tag.bad')).toHaveCount(0);
    // tooltip: the full breakdown and the negative-net (not insufficient) message
    await sup.hover();
    const tip = page.locator('#res-tip');
    await expect(tip).toBeVisible();
    for (const t of ['On hand', 'Spendable', 'Reserved (market escrow)', 'Committed to queued jobs', 'Gross production', 'Consumption (upkeep)', 'Net change', 'Forecast', 'Depleted in']) await expect(tip).toContainText(t);
    await expect(tip).toContainText('Negative net production (stock still available).');
    await expect(tip).not.toContainText('Insufficient stock');
    // shortage ledger row: city-by-city users and time to depletion, with a market link
    await page.getByTestId('ledger-supplies').click();
    const row = page.getByTestId('ledger-row');
    await expect(row).toContainText('Supplies — city-by-city');
    await expect(row).toContainText('depleted in');
    await expect(row.locator('tbody tr').first()).toBeVisible();
    await row.getByRole('button', { name: 'Market' }).click();
    await expect(page.getByTestId('panel-market')).toBeVisible();
    await expect(page.getByTestId('market-resource')).toHaveValue('supplies');
    await page.getByTestId('panel-close').click();
    await page.getByRole('button', { name: 'Close ledger row' }).click();
    await expect(row).toHaveCount(0);
    // clicking a good opens the market on that good
    await page.getByTestId('res-fuel').click();
    await expect(page.getByTestId('panel-market')).toBeVisible();
    await expect(page.getByTestId('market-resource')).toHaveValue('fuel');
    // put every whole unit of supplies in escrow (a resting sell order far above market) → upkeep goes unpaid
    const whole = Math.floor(sup0.spendable / 1000);
    const form = page.getByTestId('order-form');
    await form.getByLabel('Sell').check();
    await form.getByLabel('Resource').selectOption('supplies');
    await page.getByTestId('order-qty').fill(String(whole));
    await page.getByTestId('order-price').fill('999.000');
    await page.getByTestId('place-order').click();
    await expect.poll(() => frame<number>(page, 'f => f.view.market.myOrders.filter(o => o.status === "open").length')).toBe(1);
    await page.getByTestId('panel-close').click();
    await advance(page, 60);
    const sup1 = await frame<Res>(page, 'f => f.view.self.resources.find(r => r.resource === "supplies")');
    expect(sup1.insufficientStock).toBe(true);
    expect(sup1.reserved).toBe(whole * 1000);
    await expect(sup).toHaveClass(/short/);
    await expect(sup.locator('.tag.bad')).toHaveText('short');
    await expect(sup).toHaveAttribute('aria-label', /shortage/);
    await sup.hover();
    await expect(tip).toContainText('Insufficient stock: upkeep went unpaid in the last hour.');
    await expect(tip).not.toContainText('Negative net production (stock still available).');
    await page.mouse.move(5, 500);

    // ── time strip: research deadline + preview without advancing ──
    await page.getByTestId('rail-research').click();
    await page.locator('.tech[data-status="available"]').first().click();
    const techName = (await page.getByTestId('tech-detail').locator('h3').textContent())!;
    await page.getByTestId('start-research').click();
    await expect.poll(() => frame<number>(page, 'f => f.view.self.research.length')).toBe(1);
    await page.getByTestId('panel-close').click();
    const ts = page.getByTestId('timestrip');
    const item = ts.locator('.titem', { hasText: `Research: ${techName}`.slice(0, 33) });
    await expect(item).toBeVisible();
    await expect(ts.locator('.titem', { hasText: 'Score settlement' })).toBeVisible();
    const tick0 = await frame<number>(page, 'f => f.view.tick');
    await ts.getByRole('button', { name: '▸ Timeline' }).click();
    const table = ts.locator('.tlist table');
    await expect(table).toContainText(`Research: ${techName}`);
    await expect(table).toContainText('Expected completion');
    // a dated item with a place previews a marker; nothing advances
    // queue a construction job (validated build command) so a dated item with a place exists
    const cityKey = await frame<string>(page, 'f => f.view.cities[0].key');
    const bj = await wc<{ ok: boolean; reason?: string }>(page, `wc.host().command({ type: 'build', building: 'research_lab', targets: [${JSON.stringify(cityKey)}] })`);
    expect(bj.ok, bj.reason).toBe(true);
    await expect(table).toContainText('Build: Research Laboratory');
    await table.locator('tr', { hasText: 'Build: Research Laboratory' }).first().getByRole('button').click();
    await expect.poll(() => wc<{ label: string } | null>(page, 'wc.ui().previewMarker')).not.toBeNull();
    expect((await wc<{ label: string }>(page, 'wc.ui().previewMarker')).label).toMatch(/^Build: Research Laboratory @ .+ · Day \d+ \d\d:\d\d UTC$/);
    expect(await frame<number>(page, 'f => f.view.tick')).toBe(tick0);
    await ts.getByRole('button', { name: 'Clear preview' }).click();
    expect(await wc(page, 'wc.ui().previewMarker')).toBeNull();
    // a research item has no place: selecting it previews nothing and still does not advance
    await table.locator('tr', { hasText: `Research: ${techName}` }).getByRole('button').click();
    expect(await wc(page, 'wc.ui().previewMarker')).toBeNull();
    expect(await frame<number>(page, 'f => f.view.tick')).toBe(tick0);
    // arrivals, refits and dated reports join the same strip (all through validated commands)
    const mover = await wc<{ id: string; dest: number } | null>(page, `(async () => {
      const f = wc.frame();
      for (const s of f.view.stacks.filter(s => s.pos.kind === 'node')) {
        for (const n of f.view.observedNodes) {
          if (n === s.pos.node) continue;
          const v = await wc.host().preview({ type: 'move', stack: s.id, dest: n });
          if (v.ok) return { id: s.id, dest: n };
        }
      }
      return null;
    })()`);
    expect(mover, 'a formation with a legal nearby move').not.toBeNull();
    expect((await wc<{ ok: boolean }>(page, `wc.host().command({ type: 'move', stack: ${JSON.stringify(mover!.id)}, dest: ${mover!.dest} })`)).ok).toBe(true);
    await expect(table.locator('tr', { hasText: 'Arrival:' }).first()).toContainText('Expected arrival (recomputed each step)');
    const refitStack = await frame<string>(page, `f => f.view.stacks.find(s => s.id !== ${JSON.stringify(mover!.id)} && s.pos.kind === 'node').id`);
    expect((await wc<{ ok: boolean }>(page, `wc.host().command({ type: 'setRefit', stack: ${JSON.stringify(refitStack)}, refit: true })`)).ok).toBe(true);
    await expect(table).toContainText('Refit in progress:');
    const foreign = await frame<{ key: string; node: number }>(page, `f => { const c = f.view.publicCities.find(c => c.owner && c.owner !== f.view.viewer && c.owner === 'MYS') || f.view.publicCities.find(c => c.owner && c.owner !== f.view.viewer); return { key: c.key, node: c.node }; }`);
    expect((await wc<{ ok: boolean; reason?: string }>(page, `wc.host().command({ type: 'assignAgent', city: ${JSON.stringify(foreign.key)}, mission: 'information' })`)).ok).toBe(true);
    const rep = await wc<{ ok: boolean; reason?: string }>(page, `wc.host().command({ type: 'buyIntelReport', node: ${foreign.node} })`);
    expect(rep.ok, rep.reason).toBe(true);
    const repRow = table.locator('tr', { hasText: 'Report expires:' }).first();
    await expect(repRow).toContainText('Dated report (observed)');
    await expect(ts.locator('.titem.obs').first()).toBeVisible();
    await repRow.getByRole('button').click();
    await expect.poll(() => wc<{ label: string } | null>(page, 'wc.ui().previewMarker')).not.toBeNull();
    // rows are sorted by time and nothing advanced
    const whens = await table.locator('tbody tr td:nth-child(2)').allTextContents();
    expect(whens.length).toBeGreaterThanOrEqual(5);
    expect(await frame<number>(page, 'f => f.view.tick')).toBe(tick0);
  });
  test('interrupt-and-pause: a declaration of war on me pauses the running clock in the worker and alerts; with the preference off the clock keeps running', async ({ page }) => {
    test.setTimeout(240_000);
    await clearStorage(page);
    await newCampaign(page, 'IDN', 3131, '/?e2e=1');
    const atWar = (c: string) => frame<boolean>(page, `f => !!f.view.relations.find(r => r.country === ${JSON.stringify(c)} && r.war)`);
    expect(await atWar('MYS')).toBe(false);
    // Malaysia (a computer country) will submit an ordinary declareWar 120 game minutes from now.
    const plan = await wc<{ at: number; by: string }>(page, 'wc.host().request({ op: "debugScheduleWar", by: "MYS", inMinutes: 120 })');
    await page.getByRole('group', { name: 'Game speed' }).getByRole('button', { name: '64×' }).click();
    await page.getByTestId('pause-toggle').click();
    await expect.poll(() => frame<boolean>(page, 'f => f.clock.paused')).toBe(false);
    const dlg = page.getByRole('dialog', { name: 'The clock was paused' });
    await expect(dlg).toBeVisible({ timeout: 90_000 });
    await expect(dlg.getByRole('alert')).toContainText(/war/i);
    await expect(dlg).toContainText('Interruptions can be changed in Settings.');
    // the worker paused itself at the event (within one 15-minute chunk), not the UI
    const c1 = await frame<{ paused: boolean; tick: number }>(page, 'f => ({ paused: f.clock.paused, tick: f.view.tick })');
    expect(c1.paused).toBe(true);
    expect(c1.tick).toBeGreaterThanOrEqual(plan.at);
    expect(c1.tick - plan.at).toBeLessThanOrEqual(15);
    expect(await atWar('MYS')).toBe(true);
    await expect(page.getByTestId('pause-toggle')).toHaveAttribute('aria-label', 'Resume game clock');
    // "Stay paused" keeps the clock stopped
    await dlg.getByRole('button', { name: 'Stay paused' }).click();
    await expect(dlg).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(await frame<number>(page, 'f => f.view.tick')).toBe(c1.tick);
    // the declaration is in the journal as a diplomacy event
    expect(await frame<number>(page, 'f => f.view.journal.filter(e => e.kind === "war_declared").length')).toBeGreaterThan(0);

    // turn the war interruption off in Settings → the next declaration does not stop the clock
    await page.getByTestId('game-menu').click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Settings' });
    const warBox = settings.getByLabel('War declared on me');
    await expect(warBox).toBeChecked();
    await warBox.uncheck();
    await expect(settings.getByLabel('My capital changes hands')).toBeChecked();
    await expect(settings.getByLabel('Campaign end / elimination')).toBeChecked();
    await settings.getByRole('button', { name: 'Close dialog' }).click();
    expect(await atWar('PHL')).toBe(false);
    const plan2 = await wc<{ at: number }>(page, 'wc.host().request({ op: "debugScheduleWar", by: "PHL", inMinutes: 60 })');
    await page.getByTestId('pause-toggle').click();
    await expect.poll(() => atWar('PHL'), { timeout: 90_000 }).toBe(true);
    // keeps running past the event
    await expect.poll(() => frame<number>(page, 'f => f.view.tick'), { timeout: 60_000 }).toBeGreaterThan(plan2.at + 60);
    expect(await frame<boolean>(page, 'f => f.clock.paused')).toBe(false);
    await expect(dlg).toHaveCount(0);
    await page.getByTestId('pause-toggle').click();
    await expect.poll(() => frame<boolean>(page, 'f => f.clock.paused')).toBe(true);
  });
  test('order dialogs: embark with arrival and mode-change preview, delay holds the order, disembark at sea, attack offers only visible targets and needs explicit war confirmation', async ({ page }) => {
    test.setTimeout(300_000);
    await clearStorage(page);
    await newCampaign(page, 'IDN', 4242, '/?e2e=1');
    type Opt = { land: boolean; coastal: boolean; adjacent: { node: number; kind: string; name: string }[] };
    // a ground formation standing in a coastal province of Indonesia
    const pick = await wc<{ id: string; name: string; sea: number } | null>(page, `(async () => {
      const f = wc.frame();
      for (const s of f.view.stacks.filter(s => s.moveClass === 'ground' && s.pos.kind === 'node' && !s.order)) {
        const o = await wc.host().query('stackOptions', s.id);
        const sea = o && o.coastal ? o.adjacent.find(a => a.kind === 'coast') : null;
        if (sea) {
          const v = await wc.host().preview({ type: 'embark', stack: s.id, sea: sea.node });
          if (v.ok) return { id: s.id, name: s.name, sea: sea.node };
        }
      }
      return null;
    })()`);
    expect(pick, 'a coastal ground formation').not.toBeNull();
    await selectFormation(page, pick!.id);
    await expect(page.getByTestId('action-delay')).toHaveAttribute('aria-disabled', 'true');
    await page.getByTestId('action-embark').click();
    const emb = page.getByRole('dialog', { name: `Embark ${pick!.name}` });
    await expect(emb).toBeVisible();
    await expect(emb.getByTestId('embark-confirm')).toHaveAttribute('aria-disabled', 'true');
    await openTargetList(page);
    await emb.getByTestId('embark-node').selectOption(String(pick!.sea));
    await expect(emb).toContainText('Arrival');
    await expect(emb).toContainText(/Mode change.*Land → Sea|Ground → Naval|→/);
    await emb.getByTestId('embark-confirm').click();
    await expect(emb).toHaveCount(0);
    await expect.poll(() => frame<number | null>(page, `f => { const s = f.view.stacks.find(s => s.id === ${JSON.stringify(pick!.id)}); return s && s.order && s.order.kind === 'move' ? s.order.dest : null; }`)).toBe(pick!.sea);
    const eta0 = await frame<number>(page, `f => f.view.stacks.find(s => s.id === ${JSON.stringify(pick!.id)}).eta`);
    // delay: now enabled; preview names the hold time; the arrival moves back by the delay
    await expect(page.getByTestId('action-delay')).not.toHaveAttribute('aria-disabled', 'true');
    await page.getByTestId('action-delay').click();
    const del = page.getByRole('dialog', { name: `Delay ${pick!.name}` });
    await del.getByLabel('Hold for (game hours)').fill('3');
    const tick = await frame<number>(page, 'f => f.view.tick');
    await expect(del).toContainText('Holds its current order until');
    await del.getByTestId('delay-confirm').click();
    await expect(del).toHaveCount(0);
    const after = await frame<{ delayUntil: number; eta: number }>(page, `f => { const s = f.view.stacks.find(s => s.id === ${JSON.stringify(pick!.id)}); return { delayUntil: s.delayUntil, eta: s.eta }; }`);
    expect(after.delayUntil).toBe(tick + 180);
    expect(after.eta).toBeGreaterThan(eta0);
    // nothing moved while delayed
    const pos0 = await frame<string>(page, `f => JSON.stringify(f.view.stacks.find(s => s.id === ${JSON.stringify(pick!.id)}).pos)`);
    await advance(page, 120);
    expect(await frame<string>(page, `f => JSON.stringify(f.view.stacks.find(s => s.id === ${JSON.stringify(pick!.id)}).pos)`)).toBe(pos0);
    // at sea: the same button now disembarks onto an adjacent coast
    const atSea = await advanceUntil(page, `f => { const s = f.view.stacks.find(s => s.id === ${JSON.stringify(pick!.id)}); return !!s && s.pos.kind === 'node' && s.pos.node === ${pick!.sea} && !s.order; }`, 72 * 60, 60);
    expect(atSea, 'arrived at sea').toBeGreaterThanOrEqual(0);
    await expect(page.getByTestId('action-embark')).toHaveText('Disembark…');
    await page.getByTestId('action-embark').click();
    const dis = page.getByRole('dialog', { name: `Disembark ${pick!.name}` });
    await expect(dis).toContainText('Adjacent coast');
    const coasts = await dis.getByTestId('embark-node').locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
    const home = await frame<string | null>(page, `f => { const vals = ${JSON.stringify(coasts)}; return vals.find(v => f.view.owners[Number(v)] === f.view.viewer) ?? null; }`);
    expect(home, 'an Indonesian coast next to this sea zone').not.toBeNull();
    await openTargetList(page);
    await dis.getByTestId('embark-node').selectOption(home!);
    await expect(dis).toContainText('Mode change');
    await dis.getByRole('button', { name: 'Confirm landing' }).click();
    await expect(dis).toHaveCount(0);
    await expect.poll(() => frame<number | null>(page, `f => { const s = f.view.stacks.find(s => s.id === ${JSON.stringify(pick!.id)}); return s && s.order && s.order.kind === 'move' ? s.order.dest : null; }`)).toBe(Number(home));

    // ── attack: visible targets only; a foreign province needs explicit war confirmation ──
    const dbg = await wc<{ hiddenTypes: string[]; hiddenOwner: string }>(page, 'wc.host().request({ op: "debugContact" })');
    const atk = await frame<{ id: string; name: string }>(page, `f => { const s = f.view.stacks.find(s => s.moveClass === 'ground' && s.pos.kind === 'node' && !s.order && s.id !== ${JSON.stringify(pick!.id)}); return { id: s.id, name: s.name }; }`);
    await selectFormation(page, atk.id);
    await page.getByTestId('action-attack').click();
    const ad = page.getByRole('dialog', { name: `Attack with ${atk.name}` });
    await expect(ad).toBeVisible();
    const visible = await frame<number>(page, `f => f.view.contacts.filter(c => c.level !== 'stale' && c.domain !== 'air').length`);
    if (visible > 0) await expect(ad.getByTestId('attack-contact').locator('option')).toHaveCount(Math.min(40, visible) + 1);
    else await expect(ad).toContainText('No current contacts. You can still attack a province.');
    // stale and hidden objects are never offered; the unknown contact never reveals its type
    const optText = visible > 0 ? (await ad.getByTestId('attack-contact').locator('option').allTextContents()).join('|') : '';
    for (const t of dbg.hiddenTypes) expect(optText).not.toContain(await wc<string>(page, `wc.unitName(${JSON.stringify(t)})`));
    if (visible > 0) expect(optText).toContain('Unknown');
    const options = await ad.getByTestId('attack-node-select').locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
    const target = await frame<{ node: number; owner: string } | null>(page, `f => { const vals = ${JSON.stringify(options)}; const v = vals.find(v => { const o = f.view.owners[Number(v)]; return o && o !== f.view.viewer && !f.view.relations.find(r => r.country === o && r.war); }); return v ? { node: Number(v), owner: f.view.owners[Number(v)] } : null; }`);
    expect(target, 'a foreign province in range').not.toBeNull();
    await openTargetList(page);
    await ad.getByTestId('attack-node-select').selectOption(String(target!.node));
    await expect(ad.getByRole('alert').filter({ hasText: 'Act of war' })).toBeVisible();
    await expect(ad.getByTestId('attack-confirm')).toHaveAttribute('aria-disabled', 'true');
    await expect(ad.getByTestId('attack-confirm')).toHaveAttribute('title', /Confirm the declaration of war first/);
    expect(await frame<boolean>(page, `f => !!f.view.relations.find(r => r.country === ${JSON.stringify(target!.owner)} && r.war)`)).toBe(false);
    await ad.getByTestId('attack-war').check();
    await expect(ad).toContainText('Target sector');
    await expect(ad).toContainText('Distance');
    await expect(ad.getByTestId('attack-confirm')).not.toHaveAttribute('aria-disabled', 'true');
    await ad.getByTestId('attack-confirm').click();
    await expect(ad).toHaveCount(0);
    await expect.poll(() => frame<string | null>(page, `f => { const s = f.view.stacks.find(s => s.id === ${JSON.stringify(atk.id)}); return s && s.order ? s.order.kind : null; }`)).not.toBeNull();
    // the confirmation travels with the order: war starts on entry (assault route) or at once (ranged / same sector)
    const ord = await frame<{ kind: string; warConfirmed: string[] }>(page, `f => f.view.stacks.find(s => s.id === ${JSON.stringify(atk.id)}).order`);
    expect(ord.warConfirmed).toContain(target!.owner);
    if (ord.kind === 'move') await expect(page.getByTestId('active-order').locator('dt:has-text("War accepted with") + dd')).toHaveText(await wc<string>(page, `wc.countryName(${JSON.stringify(target!.owner)})`));
    else expect(await frame<boolean>(page, `f => !!f.view.relations.find(r => r.country === ${JSON.stringify(target!.owner)} && r.war)`)).toBe(true);
  });
  test('map input chart: Shift/Ctrl-click multi-selection with common actions, cluster chooser, right-drag lasso, context menu by right-click and Shift+F10, right-click cancels targeting, ocean/province clicks, zoom buttons, scale bar, locator arrow, layer toggles', async ({ page }) => {
    test.setTimeout(240_000);
    await clearStorage(page);
    await newCampaign(page, 'IDN', 5151);
    await wc(page, 'wc.map().center(106.8, -6.2, 30)');
    const hits = await mapHits(page, (h) => h.kind === 'object' && h.ids[0].startsWith('S:'));
    const clusters = await mapHits(page, (h) => h.kind === 'cluster' && h.ids.every((i) => i.startsWith('S:')));
    expect(hits.length, 'two separate friendly symbols').toBeGreaterThanOrEqual(2);
    expect(clusters.length, 'a crowded sector').toBeGreaterThanOrEqual(1);
    const [A, B] = hits;
    const idA = A.ids[0].slice(2), idB = B.ids[0].slice(2);
    // the canvas resizes when the inspector opens: always re-read the current hit box of an object
    const at = async (id: string) => (await mapHits(page, (h) => h.ids.includes(id) && !h.locate))[0];
    const sel = () => wc<{ kind: string; id?: string; ids?: string[] } | null>(page, 'wc.ui().selection');

    // plain click selects one; Shift-click adds; Ctrl-click toggles off
    { const h = await at(A.ids[0]); await page.mouse.click(h.cx, h.cy); }
    expect(await sel()).toEqual({ kind: 'stack', id: idA });
    await page.keyboard.down('Shift');
    { const h = await at(B.ids[0]); await page.mouse.click(h.cx, h.cy); }
    await page.keyboard.up('Shift');
    expect(await sel()).toEqual({ kind: 'multi', ids: [A.ids[0], B.ids[0]] });
    await expect(page.getByTestId('inspector-title')).toHaveText('2 formations selected');
    const ins = page.getByTestId('inspector');
    await expect(ins).toContainText('Common actions');
    // exceptions are explained on the common actions
    const posA = await frame<number>(page, `f => f.view.stacks.find(s => s.id === ${JSON.stringify(idA)}).pos.node`);
    const posB = await frame<number>(page, `f => f.view.stacks.find(s => s.id === ${JSON.stringify(idB)}).pos.node`);
    const merge = ins.getByRole('button', { name: 'Merge', exact: true });
    if (posA !== posB) await expect(merge).toHaveAttribute('title', 'Formations must be in the same province to merge.');
    await expect(ins.getByRole('button', { name: 'Stop all' })).toHaveAttribute('title', 'None of these formations has an order.');
    // Move all… → one destination for both, each validated separately
    await ins.getByRole('button', { name: 'Move all…' }).click();
    await expect(page.getByTestId('move-panel')).toContainText('Move 2 formations');
    const dest = await pickOwnedDestination(page, 'IDN', posA);
    await expect(page.getByTestId('move-eta')).toBeVisible();
    await page.getByTestId('confirm-move').click();
    await expect(page.getByTestId('move-panel')).toHaveCount(0);
    await expect.poll(() => frame<number[]>(page, `f => [${JSON.stringify(idA)}, ${JSON.stringify(idB)}].map(id => { const s = f.view.stacks.find(s => s.id === id); return s.order && s.order.kind === 'move' ? s.order.dest : -1; })`)).toEqual([dest, dest]);
    expect(await sel()).toEqual({ kind: 'multi', ids: [A.ids[0], B.ids[0]] });
    await expect(ins.getByRole('button', { name: 'Stop all' })).not.toHaveAttribute('aria-disabled', 'true');
    await ins.getByRole('button', { name: 'Stop all' }).click();
    await expect.poll(() => frame<number>(page, `f => [${JSON.stringify(idA)}, ${JSON.stringify(idB)}].filter(id => f.view.stacks.find(s => s.id === id).order).length`)).toBe(0);
    await page.keyboard.down('Control');
    { const h = await at(A.ids[0]); await page.mouse.click(h.cx, h.cy); }
    await page.keyboard.up('Control');
    expect(await sel()).toEqual({ kind: 'stack', id: idB });

    // cluster: a two-step chooser lists every object in the sector
    const C = clusters[0];
    { const h = await at(C.ids[0]); await page.mouse.click(h.cx, h.cy); }
    const chooser = page.getByRole('listbox', { name: 'Choose an object at this location' });
    await expect(chooser).toBeVisible();
    await expect(chooser).toContainText(`${C.ids.length} objects here — pick one`);
    await expect(chooser.getByRole('option')).toHaveCount(C.ids.length);
    await expect(chooser.getByRole('option').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(chooser).toHaveCount(0);
    { const h = await at(C.ids[0]); await page.mouse.click(h.cx, h.cy); }
    await chooser.getByRole('option').nth(1).click();
    await expect(chooser).toHaveCount(0);
    expect(await sel()).toEqual({ kind: 'stack', id: C.ids[1].slice(2) });
    // Shift-click on a cluster adds all of its formations
    await page.keyboard.down('Shift');
    { const h = await at(A.ids[0]); await page.mouse.click(h.cx, h.cy); }
    await page.keyboard.up('Shift');
    const multi = await sel();
    expect(multi!.kind).toBe('multi');
    expect(multi!.ids).toEqual(expect.arrayContaining([C.ids[1], A.ids[0]]));

    // right-drag lasso: every friendly formation symbol inside the rectangle
    const [hA, hB] = [await at(A.ids[0]), await at(B.ids[0])];
    const x0 = Math.min(hA.cx, hB.cx) - 12, x1 = Math.max(hA.cx, hB.cx) + 12, y0 = Math.min(hA.cy, hB.cy) - 12, y1 = Math.max(hA.cy, hB.cy) + 12;
    const inRect = await wc<string[]>(page, `(() => { const m = wc.map(); const b = m.canvas.getBoundingClientRect(); return [...new Set(m.hits.filter(h => (h.kind === 'object' || h.kind === 'cluster') && !h.locate).filter(h => { const cx = b.left + h.x + h.w / 2, cy = b.top + h.y + h.h / 2; return cx >= ${x0} && cx <= ${x1} && cy >= ${y0} && cy <= ${y1}; }).flatMap(h => h.ids).filter(i => i.startsWith('S:')))]; })()`);
    expect(inRect).toEqual(expect.arrayContaining([A.ids[0], B.ids[0]]));
    await page.mouse.move(x0, y0);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 });
    await page.mouse.move(x1, y1, { steps: 4 });
    await page.mouse.up({ button: 'right' });
    const lasso = await sel();
    expect(lasso!.kind).toBe('multi');
    expect([...lasso!.ids!].sort()).toEqual([...inRect].sort());
    await expect(page.locator('.ctxmenu')).toHaveCount(0);

    // right-click on a formation: context menu with keyboard navigation
    { const h = await at(A.ids[0]); await page.mouse.click(h.cx, h.cy, { button: 'right' }); }
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    expect(await sel()).toEqual({ kind: 'stack', id: idA });
    await expect(menu.getByRole('menuitem')).toHaveText(['Inspect', 'Locate in roster', 'Orders: Move…']);
    await expect(menu.getByRole('menuitem', { name: 'Inspect' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: 'Locate in roster' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(menu).toHaveCount(0);
    await expect(page.locator(`[data-roster-id="S:${idA}"]`)).toBeFocused();
    // Shift+F10 on the focused map opens the same menu for the selection; Escape closes it and returns focus
    await page.locator('#map-canvas').focus();
    await page.keyboard.press('Shift+F10');
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute('aria-label', /^Actions for /);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(page.locator('#map-canvas')).toBeFocused();
    // Orders: Move… enters targeting; a right-click cancels it without ordering anything
    { const h = await at(A.ids[0]); await page.mouse.click(h.cx, h.cy, { button: 'right' }); }
    await menu.getByRole('menuitem', { name: 'Orders: Move…' }).click();
    await expect(page.getByTestId('move-panel')).toBeVisible();
    expect(await wc<string>(page, 'wc.ui().mode.kind')).toBe('move');
    const sea = await wc<{ x: number; y: number }>(page, 'wc.project(108.0, -5.2)');
    await page.mouse.click(sea.x, sea.y, { button: 'right' });
    await expect(page.getByTestId('move-panel')).toHaveCount(0);
    expect(await wc<string>(page, 'wc.ui().mode.kind')).toBe('idle');
    expect(await frame<boolean>(page, `f => !!f.view.stacks.find(s => s.id === ${JSON.stringify(idA)}).order`)).toBe(false);

    // ocean click clears the selection; an empty land click selects that province (or its city)
    await page.mouse.click(sea.x, sea.y);
    expect(await sel()).toBeNull();
    const land = await wc<{ x: number; y: number; node: number } | null>(page, `(() => {
      const m = wc.map(), b = m.canvas.getBoundingClientRect(), f = wc.frame();
      for (let lat = -6.6; lat > -8.2; lat -= 0.15) for (let lon = 106; lon < 112; lon += 0.2) {
        const p = wc.project(lon, lat), x = p.x - b.left, y = p.y - b.top;
        if (x < 40 || y < 40 || x > m.w - 40 || y > m.h - 40 || m.hitAt(x, y, 14)) continue;
        const n = m.nodeAt(lon, lat);
        // well inside the coastline: every point 0.15° around it is in the same province
        const inland = [[0.15, 0], [-0.15, 0], [0, 0.15], [0, -0.15]].every(([dx, dy]) => m.nodeAt(lon + dx, lat + dy) === n);
        if (n !== null && inland && f.view.owners[n] === f.view.viewer) return { x: p.x, y: p.y, node: n };
      }
      return null;
    })()`);
    expect(land, 'an empty Indonesian land point').not.toBeNull();
    await page.mouse.click(land!.x, land!.y);
    const ls = await sel() as { kind: string; node: number };
    expect(['province', 'city']).toContain(ls.kind);
    expect(ls.node).toBe(land!.node);

    // zoom buttons and the scale bar
    const z0 = await wc<number>(page, 'wc.camera().z');
    const scale = page.locator('.scalebar');
    const s0 = await scale.getAttribute('aria-label');
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await expect.poll(() => wc<number>(page, 'wc.camera().z')).toBeLessThan(z0);
    await expect.poll(() => scale.getAttribute('aria-label')).not.toBe(s0);
    await expect(scale).toHaveAttribute('aria-label', /^Scale: \d[\d,]* k?m$/);
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect.poll(() => wc<number>(page, 'wc.camera().z')).toBeCloseTo(z0, 3);

    // locator arrow: an off-screen selection gets an edge arrow that brings it back into view
    await selectFormation(page, idB);
    expect(await sel()).toEqual({ kind: 'stack', id: idB });
    await wc(page, 'wc.map().center(40, 20, 30)');
    const loc = await mapHits(page, (h) => !!h.locate);
    expect(loc).toHaveLength(1);
    expect(loc[0].ids).toEqual([B.ids[0]]);
    await page.mouse.click(loc[0].cx, loc[0].cy);
    const ll = await frame<[number, number]>(page, `f => f.view.stacks.find(s => s.id === ${JSON.stringify(idB)}).lonlat`);
    await expect.poll(async () => { const c = await wc<{ cx: number; cy: number }>(page, 'wc.camera()'); return Math.hypot(c.cx - ll[0], -c.cy - ll[1]); }).toBeLessThan(0.5);
    expect(await sel()).toEqual({ kind: 'stack', id: idB });
    expect(await mapHits(page, (h) => !!h.locate, 0)).toHaveLength(0);

    // independent layer toggles
    await page.getByTestId('layers-button').click();
    const pop = page.getByRole('dialog', { name: 'Map layers' });
    const prefsMap = () => page.evaluate(() => JSON.parse(localStorage.getItem('wc.prefs.v1') ?? '{}').map as Record<string, unknown>);
    const before = await prefsMap();
    await pop.getByLabel('Unit symbols').uncheck();
    await expect.poll(async () => (await prefsMap()).symbols).toBe(false);
    const after = await prefsMap();
    for (const k of ['borders', 'names', 'routes', 'sensors', 'dim', 'fill']) expect(after[k], k).toEqual(before[k]);
    // with symbols off only the selected formation stays drawn (and clickable)
    expect((await mapHits(page, (h) => h.kind === 'object' || h.kind === 'cluster')).map((h) => h.ids)).toEqual([[B.ids[0]]]);
    await pop.getByLabel('Names').uncheck();
    await pop.getByLabel('Sensor coverage').check();
    await expect.poll(async () => { const p = await prefsMap(); return [p.symbols, p.names, p.sensors, p.borders, p.routes]; }).toEqual([false, false, true, before.borders, before.routes]);
    await pop.getByLabel('Unit symbols').check();
    expect((await mapHits(page, (h) => h.kind === 'object' || h.kind === 'cluster')).length).toBeGreaterThan(0);
    await pop.getByRole('button', { name: 'Close' }).click();
    await expect(pop).toHaveCount(0);
  });
  test('journal: an event opened after its formation was destroyed keeps time, place and outcome; the inspector explains the lost selection; survives save/reload', async ({ page }) => {
    test.setTimeout(300_000);
    await clearStorage(page);
    await newCampaign(page, 'IDN', 6161, '/?e2e=1');
    // my weakest ground formation that stands alone in its province
    const weak = await frame<string>(page, `f => { const g = f.view.stacks.filter(s => s.moveClass === 'ground' && s.pos.kind === 'node'); const alone = g.filter(s => !f.view.stacks.some(o => o.id !== s.id && o.pos.kind === 'node' && o.pos.node === s.pos.node)); return alone.sort((a, b) => a.units.length - b.units.length || (a.id < b.id ? -1 : 1))[0].id; }`);
    // test-only: the largest foreign ground formation enters that province after declaring war
    const eng = await wc<{ stack: string; foeOwner: string; node: number; name: string }>(page, `wc.host().request({ op: "debugEngage", stack: ${JSON.stringify(weak)}, strongest: true })`);
    expect(eng.stack).toBe(weak);
    const mine = await frame<{ name: string }>(page, `f => ({ name: f.view.stacks.find(s => s.id === ${JSON.stringify(eng.stack)}).name })`);
    // hold fire (validated fire-control order) so this formation is the one that is lost
    expect((await wc<{ ok: boolean }>(page, `wc.host().command({ type: 'setFirePolicy', stack: ${JSON.stringify(eng.stack)}, policy: 'hold' })`)).ok).toBe(true);
    await selectFormation(page, eng.stack);
    await expect(page.getByTestId('inspector-title')).toHaveText(mine.name);
    const spent = await advanceUntil(page, `f => !f.view.stacks.some(s => s.id === ${JSON.stringify(eng.stack)})`, 96 * 60, 60);
    expect(spent, 'the formation is destroyed').toBeGreaterThanOrEqual(0);
    // the inspector explains what happened instead of showing stale data
    const lost = page.getByTestId('lost-selection');
    await expect(lost).toBeVisible();
    await expect(lost).toContainText('Selection lost');
    await expect(lost).toContainText(`${mine.name} no longer exists — it may have been destroyed, merged or split. Check the journal for the event.`);
    expect(await wc(page, 'wc.ui().selection')).toBeNull();
    await lost.getByRole('button', { name: 'Open journal' }).click();
    const jp = page.getByTestId('journal-panel');
    await expect(jp).toBeVisible();
    const ev = await frame<{ id: string; at: number; node: number; text: string }>(page, `f => f.view.journal.find(e => e.kind === 'stack_destroyed' && e.data && e.data.stack === ${JSON.stringify(eng.stack)})`);
    expect(ev.text).toBe(`${mine.name} was destroyed.`);
    const openEvent = async () => {
      await jp.getByTestId('journal-filter-combat').click();
      const row = jp.getByRole('button', { name: ev.text, exact: true });
      await expect(row).toBeVisible();
      await row.click();
      await expect(row).toHaveAttribute('aria-expanded', 'true');
      const card = row.locator('xpath=ancestor::li[1]').locator('.card');
      await expect(card.locator('dt:has-text("Recorded") + dd')).toHaveText(new RegExp(`^Day \\d+ \\d\\d:\\d\\d UTC$`));
      await expect(card.locator('dt:has-text("Place") + dd')).toHaveText(eng.name);
      await expect(card.locator('dt:has-text("Kind") + dd')).toHaveText('stack destroyed');
      await expect(card.locator('dt:has-text("Stack") + dd')).toHaveText(eng.stack);
      await expect(card).toContainText('This record keeps its place, time and outcome even after the units involved are gone.');
      return row;
    };
    const row = await openEvent();
    // the losses that led to it are recorded too
    expect(await frame<number>(page, `f => f.view.journal.filter(e => e.kind === 'units_lost' && e.node === ${eng.node}).length`)).toBeGreaterThan(0);
    // Go: jumps to the recorded place (the formation itself is gone)
    await row.locator('xpath=ancestor::li[1]').getByRole('button', { name: `Go to ${eng.name}` }).click();
    await expect(jp).toHaveCount(0);
    const s = await wc<{ kind: string; node: number }>(page, 'wc.ui().selection');
    expect(s.node).toBe(eng.node);
    // persists across save and reload
    await page.getByTestId('save-indicator').click();
    await expect(page.getByTestId('save-indicator')).toContainText('Saved', { timeout: 15_000 });
    await page.reload();
    await page.getByTestId('continue').click();
    await expect(page.getByTestId('game')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('rail-journal').click();
    await expect(jp).toBeVisible();
    await openEvent();
  });
  test('recovery copies: a revision conflict keeps this tab’s progress as a recovery copy, listed on the load screen, restorable as a new campaign and deletable', async ({ page }) => {
    test.setTimeout(240_000);
    await clearStorage(page);
    await newCampaign(page, 'IDN', 7171);
    await page.getByTestId('step-hour').click();
    await expect(page.getByTestId('game-clock')).toContainText('D1 07:00');
    const ind = page.getByTestId('save-indicator');
    await ind.click();
    await expect(ind).toContainText('Saved', { timeout: 15_000 });
    const snap = 'f => JSON.stringify({ tick: f.view.tick, seed: f.meta.seed, stock: f.view.self.stock, stacks: f.view.stacks.map(s => s.id) })';
    const cid = await frame<string>(page, 'f => f.meta.campaignId');
    // Another writer (e.g. a browser without Web Locks) stores a newer revision of the same campaign.
    const idb = (body: string) => page.evaluate(`new Promise((res, rej) => { const r = indexedDB.open('world-command'); r.onerror = () => rej(r.error); r.onsuccess = () => { const db = r.result; ${body} }; })`);
    await idb(`const t = db.transaction(['campaigns'], 'readwrite'); const st = t.objectStore('campaigns'); const g = st.get(${JSON.stringify(cid)}); g.onsuccess = () => { const m = g.result; m.revision += 5; st.put(m); }; t.oncomplete = () => res(true);`);
    // this tab's next save (the step's autosave) must not overwrite it: conflict, progress kept as a recovery copy
    await page.getByTestId('step-hour').click();
    await expect(page.getByTestId('game-clock')).toContainText('D1 08:00');
    const conflicted = await frame<string>(page, snap);
    const dlg = page.getByRole('dialog', { name: 'Newer save detected' });
    await expect(dlg).toBeVisible({ timeout: 15_000 });
    await expect(dlg).toContainText(/Another tab or window saved this campaign at revision \d+, newer than this tab's revision \d+\. Nothing was overwritten\. This tab's progress was kept as a recovery copy \(Load Campaign → Recovery copies\)\./);
    await expect(ind).toContainText('Save conflict');
    // the clock is paused by the conflict
    expect(await frame<boolean>(page, 'f => f.clock.paused')).toBe(true);
    const cps = () => idb(`const t = db.transaction(['checkpoints'], 'readonly'); const g = t.objectStore('checkpoints').getAll(); g.onsuccess = () => res(g.result.map(c => ({ id: c.id, campaignId: c.campaignId, reason: c.reason })));`) as Promise<{ id: string; campaignId: string; reason: string }[]>;
    const list0 = await cps();
    expect(list0.length).toBeGreaterThanOrEqual(1);
    expect(list0[0].campaignId).toBe(cid);
    expect(list0[0].reason).toMatch(/^Revision conflict: stored r\d+ > this tab r\d+$/);
    // the stored (newer) campaign was not overwritten
    const storedRev = await idb(`const t = db.transaction(['campaigns'], 'readonly'); const g = t.objectStore('campaigns').get(${JSON.stringify(cid)}); g.onsuccess = () => res(g.result.revision);`);
    expect(storedRev).toBeGreaterThan(0);

    // load screen → Recovery copies
    await dlg.getByRole('button', { name: 'Return to campaigns (load the newer save)' }).click();
    await page.getByTestId('load-campaign').click();
    const n = (await cps()).length;
    const tab = page.getByRole('tab', { name: `Recovery copies (${n})` });
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(page.getByText('Recovery copies are written when a save fails, when another tab saved newer progress (revision conflict)')).toBeVisible();
    const rows = page.locator('table.data tbody tr');
    await expect(rows).toHaveCount(n);
    await expect(rows.first()).toContainText(/Revision conflict: stored r\d+ > this tab r\d+/);
    await rows.first().getByRole('button', { name: 'Restore as new campaign' }).click();
    await expect(page.getByRole('status')).toHaveText('Recovery copy restored as a new campaign.');
    await page.getByRole('tab', { name: 'Active (2)' }).click();
    const rec = page.getByTestId('campaign-list').locator('tbody tr').filter({ hasText: '(recovered' });
    await expect(rec).toHaveCount(1);
    await rec.getByRole('button', { name: 'Resume Indonesia' }).click();
    await expect(page.getByTestId('game')).toBeVisible({ timeout: 60_000 });
    // the recovered campaign holds exactly the progress the conflicting tab had
    expect(await frame<string>(page, snap)).toBe(conflicted);
    expect(await frame<string>(page, 'f => f.meta.campaignId')).not.toBe(cid);
    // delete a recovery copy
    await page.getByTestId('game-menu').click();
    await page.getByTestId('home-button').click();
    await page.getByTestId('load-campaign').click();
    await page.getByRole('tab', { name: `Recovery copies (${n})` }).click();
    await rows.first().getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('tab', { name: `Recovery copies (${n - 1})` })).toBeVisible();
    expect((await cps()).length).toBe(n - 1);
  });
  test('score panel and end of campaign: standings, territories, settlement and history; the final settlement opens the end panel; review mode of the completed save never awards victory twice', async ({ page }) => {
    test.setTimeout(300_000);
    await clearStorage(page);
    // China: the highest score fraction when this save reaches the final settlement, so the victory
    // (and its one-time career award) is exercised for the human side.
    const HUMAN = 'CHN', HUMAN_NAME = 'China';
    await newCampaign(page, HUMAN, 9191);
    await page.getByTestId('score-button').click();
    const sp = page.getByTestId('score-panel');
    await expect(sp).toBeVisible();
    type B = { mine: number; myEntry: { score: number; threshold: number } | null; thresholds: Record<string, number>; standings: { id: string; members: string[]; score: number }[]; territories: { node: number; name: string; vp: number }[]; nextSettlementTick: number };
    const b = await wc<B>(page, 'wc.host().query("scoreBreakdown")');
    await expect(sp.locator('.card').first()).toContainText(`${b.myEntry?.score ?? b.mine} / ${b.myEntry?.threshold ?? b.thresholds.solo} VP`);
    await expect(sp).toContainText('Competing solo');
    await expect(sp).toContainText('One settlement at each day change; day 180 decides by highest fraction');
    await expect(sp).toContainText(`Solo ${b.thresholds.solo}; coalition 2: ${b.thresholds['2']}`);
    // standings: ranked, my row marked; territory contributions sum to my score; fixed city score vs mutable population
    const std = page.getByTestId('standings');
    const myRank = b.standings.findIndex((e) => e.members.includes(HUMAN));
    await expect(std.locator('tr[aria-current="true"] td').first()).toHaveText(String(myRank + 1));
    await expect(std.locator('tr[aria-current="true"]')).toContainText(HUMAN_NAME);
    await expect(sp.getByRole('heading', { name: `Your territories (${b.territories.length})` })).toBeVisible();
    expect(b.territories.reduce((a, t) => a + t.vp, 0)).toBe(b.myEntry?.score ?? b.mine);
    await expect(sp).toContainText("City score is fixed by the city's initial tier; its population (economic, mutable) changes with morale and war but never changes VP.");
    await expect(sp).toContainText('History starts after the first day change.');
    // a territory row jumps to it
    const t0 = b.territories[0];
    await sp.getByRole('button', { name: t0.name, exact: true }).first().click();
    await expect(sp).toHaveCount(0);
    expect((await wc<{ node: number }>(page, 'wc.ui().selection')).node).toBe(t0.node);
    // across two settlements the history gains points (one per day change)
    await advance(page, b.nextSettlementTick - (await frame<number>(page, 'f => f.view.tick')) + 1440 + 15);
    expect((await wc<{ history: unknown[] }>(page, 'wc.host().query("scoreBreakdown")')).history).toHaveLength(2);
    await page.getByTestId('score-button').click();
    await expect(sp.getByRole('img', { name: /^Score history: \d+, \d+/ })).toBeVisible();
    await page.getByTestId('panel-close').click();

    // ── end of campaign: the same save moved to one hour before the final settlement (export → edit clock → import) ──
    const json = await wc<string>(page, 'wc.host().exportJson()');
    const env = JSON.parse(json);
    const FINAL = 180 * 1440 - 360;
    env.state.clock.tick = FINAL - 60;
    env.state.clock.lastStep = FINAL - 60;
    await page.getByTestId('game-menu').click();
    await page.getByTestId('home-button').click();
    await page.getByTestId('load-campaign').click();
    await page.getByTestId('import-input').setInputFiles({ name: 'late.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(env)) });
    await page.getByTestId('confirm-import').click();
    const row = page.getByTestId('campaign-list').locator('tbody tr').filter({ hasText: '(imported)' });
    await row.getByRole('button', { name: `Resume ${HUMAN_NAME}` }).click();
    await expect(page.getByTestId('game')).toBeVisible({ timeout: 60_000 });
    expect(await frame<number>(page, 'f => f.view.day')).toBe(180);
    const xp0 = await wc<{ entries: { kind: string }[] }>(page, 'wc.host().query("career")');
    expect(xp0.entries.filter((e) => e.kind === 'victory')).toHaveLength(0);
    // the final settlement runs through the normal clock (one hour)
    await page.getByTestId('step-hour').click();
    const end = page.getByTestId('end-panel');
    await expect(end).toBeVisible({ timeout: 60_000 });
    const res = await frame<{ reason: string; day: number; winner: { id: string; members: string[]; score: number; threshold: number }; standings: unknown[] }>(page, 'f => f.view.result');
    expect(res.reason).toBe('final_day');
    expect(res.day).toBe(180);
    const won = res.winner.members.includes(HUMAN);
    // eslint-disable-next-line no-console
    console.log(`[E-v-score] final settlement winner ${res.winner.id} (${res.winner.score}/${res.winner.threshold} VP); human won: ${won}`);
    expect(won, 'the human side wins this final settlement (highest fraction)').toBe(true);
    await expect(end.getByRole('heading', { level: 3 })).toHaveText(won ? 'Victory' : 'Campaign concluded');
    await expect(end).toContainText(`Winner: ${await wc<string>(page, `wc.countryName(${JSON.stringify(res.winner.id)})`)} with ${res.winner.score} of ${res.winner.threshold} VP (highest fraction at day 180)`);
    await expect(end).toContainText('Results are frozen. Reloading this save opens review mode and never awards victory twice.');
    for (const h of ['Your final score', 'Research', 'Losses', 'Territory changes', 'Score history']) await expect(end).toContainText(h);
    await expect(end.locator('table.data tbody tr')).toHaveCount(Math.min(15, res.standings.length));
    // the campaign-end interruption paused the clock and said so
    await expect(page.getByRole('dialog', { name: 'The clock was paused' })).toContainText(won ? 'Victory! Your side won the campaign.' : 'Campaign over — winner:');
    await page.getByRole('dialog', { name: 'The clock was paused' }).getByRole('button', { name: 'Stay paused' }).click();
    const victories = async () => (await wc<{ entries: { kind: string }[] }>(page, 'wc.host().query("career")')).entries.filter((e) => e.kind === 'victory').length;
    expect(await victories()).toBe(won ? 1 : 0);
    const endTick = await frame<number>(page, 'f => f.view.tick');
    const ends = await frame<number>(page, 'f => f.view.journal.filter(e => e.kind === "campaign_end").length');
    expect(ends).toBe(1);
    // review mode: clock controls disabled, stepping is a no-op, reopening never re-awards
    await expect(page.getByTestId('pause-toggle')).toBeDisabled();
    await expect(page.getByTestId('step-hour')).toBeDisabled();
    await expect(page.getByTestId('save-indicator')).toBeDisabled();
    await page.getByTestId('game-menu').click();
    await page.getByTestId('home-button').click();
    await page.getByTestId('load-campaign').click();
    const done = page.getByTestId('campaign-list').locator('tbody tr').filter({ hasText: '(imported)' });
    await expect(done).toContainText('completed');
    await done.getByRole('button', { name: `Resume ${HUMAN_NAME}` }).click();
    await expect(page.getByTestId('game')).toBeVisible({ timeout: 60_000 });
    expect(await frame<boolean>(page, 'f => f.meta.reviewMode')).toBe(true);
    await expect(page.getByTestId('pause-toggle')).toBeDisabled();
    await wc(page, 'wc.host().step(1440)');
    expect(await frame<number>(page, 'f => f.view.tick')).toBe(endTick);
    expect(await victories()).toBe(won ? 1 : 0);
    expect(await frame<number>(page, 'f => f.view.journal.filter(e => e.kind === "campaign_end").length')).toBe(1);
    await expect(page.getByRole('dialog', { name: 'The clock was paused' })).toHaveCount(0);
  });
  test('choose-country region filters (22/34/18/22/21/3) and preview fields; map ≥ 70 % of 1440×900; previous/next formation and city by arrows and buttons; WASD not stolen while typing; advisor with keyboard chart and current-save examples', async ({ page }) => {
    test.setTimeout(240_000);
    await clearStorage(page);
    await page.goto('/');
    await page.getByTestId('new-campaign').click();
    await expect(page.getByTestId('preview-capital')).toHaveText('Jakarta', { timeout: 120_000 });
    const filters = page.getByRole('group', { name: 'Region filter' }).getByRole('button');
    await expect(filters).toHaveText(['All · 120', 'Americas · 22', 'Europe · 34', 'Africa · 18', 'West and Central Asia · 22', 'South, East and Southeast Asia · 21', 'Oceania · 3']);
    const items = page.getByRole('listbox', { name: 'Countries' }).locator('[data-testid^="country-"]');
    await expect(items).toHaveCount(120);
    // Indonesia is featured first
    await expect(items.first()).toHaveAttribute('data-testid', 'country-IDN');
    for (const [label, n] of [['Americas', 22], ['Europe', 34], ['Africa', 18], ['West and Central Asia', 22], ['South, East and Southeast Asia', 21], ['Oceania', 3]] as const) {
      await filters.filter({ hasText: `${label} · ${n}` }).click();
      await expect(items).toHaveCount(n);
    }
    await filters.filter({ hasText: 'All · 120' }).click();
    await expect(items).toHaveCount(120);
    // preview: capital, doctrine, region, cities/ports, coastline, neighbours, difficulty, resources, opening power
    const pv = page.getByTestId('country-preview');
    const dd = (t: string) => pv.locator(`dt:text-is("${t}") + dd`);
    await expect(dd('Doctrine')).not.toBeEmpty();
    await expect(dd('Region')).toHaveText(/Asia/);
    await expect(dd('Provinces / cities')).toHaveText(/^\d+ \/ \d+ \(\d+ ports\)$/);
    await expect(dd('Coastline')).toHaveText('Coastal');
    await expect(dd('Neighbours (land)')).toContainText(/Malaysia|Papua New Guinea|Timor/);
    await expect(pv.locator('.tag', { hasText: / start$/ })).toBeVisible();
    await expect(pv.getByRole('heading', { name: 'Starting cities' })).toBeVisible();
    const resTable = pv.getByRole('heading', { name: 'Resources — stockpile · daily output' }).locator('xpath=following-sibling::table[1]');
    await expect(resTable.locator('tbody tr')).toHaveCount(7);
    await expect(resTable.locator('tbody tr').first()).toContainText(/\/day$/);
    await expect(pv).toContainText(/Composite \d+\.\d · rank \d+ of 120 · leader United States/);
    await page.getByTestId('country-search').fill('Bolivia');
    await page.getByTestId('country-BOL').click();
    await expect(dd('Coastline')).toHaveText('Landlocked');
    await expect(dd('Neighbours (land)')).toContainText('Brazil');
    await page.getByTestId('country-search').fill('');
    await page.getByTestId('country-IDN').click();
    await page.getByTestId('seed-input').fill('1212');
    await page.getByTestId('start-campaign').click();
    await expect(page.getByTestId('game')).toBeVisible({ timeout: 120_000 });
    await page.getByTestId('close-briefing').click();

    // map share with drawers closed
    await expect(page.getByTestId('inspector')).toHaveCount(0);
    const mb = (await page.locator('#map-canvas').boundingBox())!;
    expect((mb.width * mb.height) / (1440 * 900)).toBeGreaterThanOrEqual(0.7);

    // previous/next formation: arrow keys on the map and the inspector buttons follow the roster order
    const ids = await frame<string[]>(page, 'f => f.view.stacks.map(s => s.id)');
    await selectFormation(page, ids[0]);
    await page.locator('#map-canvas').focus();
    await page.keyboard.press('ArrowRight');
    expect(await wc(page, 'wc.ui().selection')).toEqual({ kind: 'stack', id: ids[1] });
    await page.getByRole('button', { name: 'Next formation' }).click();
    expect(await wc(page, 'wc.ui().selection')).toEqual({ kind: 'stack', id: ids[2] });
    await page.getByRole('button', { name: 'Previous formation' }).click();
    expect(await wc(page, 'wc.ui().selection')).toEqual({ kind: 'stack', id: ids[1] });
    await page.locator('#map-canvas').focus();
    await page.keyboard.press('ArrowLeft');
    expect(await wc(page, 'wc.ui().selection')).toEqual({ kind: 'stack', id: ids[0] });
    // … and cities (alphabetical)
    const cities = await frame<{ key: string; name: string }[]>(page, 'f => [...f.view.cities].sort((a, b) => a.name.localeCompare(b.name)).map(c => ({ key: c.key, name: c.name }))');
    await page.locator('#map-search-input').fill(cities[0].name);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('inspector-title')).toHaveText(cities[0].name);
    await page.getByRole('button', { name: 'Next city' }).click();
    await expect(page.getByTestId('inspector-title')).toHaveText(cities[1].name);
    await page.locator('#map-canvas').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('inspector-title')).toHaveText(cities[2].name);
    await page.getByRole('button', { name: 'Previous city' }).click();
    await expect(page.getByTestId('inspector-title')).toHaveText(cities[1].name);

    // WASD: typed into a field, never pans; on the map, pans
    const camA = await wc<{ cx: number; cy: number }>(page, 'wc.camera()');
    await page.locator('#map-search-input').click();
    await page.keyboard.type('wasd');
    await expect(page.locator('#map-search-input')).toHaveValue('wasd');
    await page.waitForTimeout(300);
    expect(await wc(page, 'wc.camera()')).toMatchObject({ cx: camA.cx, cy: camA.cy });
    await page.locator('#map-search-input').fill('');
    await page.locator('#map-canvas').focus();
    await page.keyboard.down('d');
    await page.waitForTimeout(300);
    await page.keyboard.up('d');
    expect((await wc<{ cx: number }>(page, 'wc.camera()')).cx).toBeGreaterThan(camA.cx);

    // advisor: keyboard chart plus examples from this save (the selected city, the capital)
    await page.getByTestId('help-button').click();
    const help = page.getByTestId('help-panel');
    await expect(help).toBeVisible();
    await expect(page.getByTestId('keyboard-chart').locator('tbody tr')).toHaveCount(13);
    for (const k of ['W A S D / ↑ ↓', 'Right-drag', 'Shift/Ctrl-click', 'Right-click unit / Shift+F10 / Menu key', 'Space']) await expect(page.getByTestId('keyboard-chart')).toContainText(k);
    await expect(help).toContainText(`${cities[1].name} — open the city sheet`);
    await help.getByRole('button', { name: 'Open city sheet' }).click();
    await expect(page.getByTestId('city-sheet-name')).toHaveText(cities[1].name);
    await page.getByTestId('panel-close').click();
    // with nothing selected the first lesson names this save's capital
    await page.getByRole('button', { name: 'Clear selection' }).click();
    await page.getByTestId('help-button').click();
    await expect(help).toContainText('Click Jakarta on the map or use search.');
  });
  test('rural province sheet: its own construction catalog, deposit shown, zero-output warning for a deposit improvement without a deposit; the order is still validated and queued', async ({ page }) => {
    test.setTimeout(240_000);
    await clearStorage(page);
    await newCampaign(page, 'IDN', 1313);
    await wc(page, 'wc.map().center(118, -2.5, 14)');
    await page.waitForTimeout(600);
    const spot = await wc<{ x: number; y: number; node: number; warn: string; id: string } | null>(page, `(async () => {
      const m = wc.map(), b = m.canvas.getBoundingClientRect(), f = wc.frame();
      const cityNodes = new Set(f.view.cities.map(c => c.node));
      const tried = new Set();
      for (let lat = 5; lat > -10; lat -= 0.2) for (let lon = 95; lon < 141; lon += 0.2) {
        const p = wc.project(lon, lat), x = p.x - b.left, y = p.y - b.top;
        if (x < 40 || y < 40 || x > m.w - 40 || y > m.h - 40 || m.hitAt(x, y, 10)) continue;
        const n = m.nodeAt(lon, lat);
        if (n === null || tried.has(n) || cityNodes.has(n) || f.view.owners[n] !== f.view.viewer) continue;
        tried.add(n);
        const opts = await wc.host().query('buildOptions', n);
        const o = opts.find(o => o.warning && o.ok);
        if (o) return { x: p.x, y: p.y, node: n, warn: o.warning, id: o.id };
      }
      return null;
    })()`);
    expect(spot, 'an Indonesian rural province without a deposit').not.toBeNull();
    await page.mouse.click(spot!.x, spot!.y);
    expect(await wc(page, 'wc.ui().selection')).toEqual({ kind: 'province', node: spot!.node });
    const ps = page.getByTestId('place-sheet');
    await expect(ps.locator('dt:text-is("Deposit") + dd')).toHaveText('None');
    await page.getByTestId('inspector-build').click();
    const panel = page.getByTestId('panel-cities');
    await expect(panel.getByRole('heading', { name: /\(rural province\)$/ })).toBeVisible();
    await expect(panel).toContainText('deposit none');
    await expect(panel).toContainText('Rural improvements that need a deposit produce nothing without one.');
    const cat = panel.getByTestId('build-catalog');
    // the rural catalog differs from a city's (no city-only buildings such as a research laboratory)
    await expect(cat.getByTestId('build-research_lab')).toHaveCount(0);
    const row = cat.locator('tr').filter({ has: page.getByTestId(`build-${spot!.id}`) });
    await expect(row.locator('.warn')).toHaveText('This province has no resource deposit: the improvement will produce nothing.');
    expect(spot!.warn).toBe('This province has no resource deposit: the improvement will produce nothing.');
    // a warning, not a refusal: the validated build is still possible and is queued exactly once
    await row.getByTestId(`build-${spot!.id}`).click();
    await expect.poll(() => frame<number>(page, `f => f.view.self.jobs.filter(j => j.kind === 'construct' && j.node === ${spot!.node} && j.building === ${JSON.stringify(spot!.id)}).length`)).toBe(1);
  });
  test('research detail: a level upgrade compares current vs next level stats; a completed unlock lists the cities eligible to mobilize it and opens one', async ({ page }) => {
    test.setTimeout(180_000);
    await clearStorage(page);
    await newCampaign(page, 'IDN', 1414);
    await page.getByTestId('rail-research').click();
    const rp = page.getByTestId('research-panel');
    await expect(rp).toBeVisible();
    // a unit level tech (<unit>_l2): side-by-side current vs next
    const lvl = rp.locator('button.tech[data-testid$="_l2"]').first();
    await lvl.click();
    const det = page.getByTestId('tech-detail');
    await expect(det).toContainText('(applies to existing and new units)');
    const cmp = det.getByRole('table', { name: 'Current versus next level' });
    await expect(cmp.locator('thead th')).toHaveText(['Stat', 'L1', 'L2']);
    for (const r of ['Hit points', 'Speed (km/h)', 'Sight (km)', 'Range (km)']) await expect(cmp.locator('tbody tr', { hasText: r })).toHaveCount(1);
    const hp = await cmp.locator('tbody tr', { hasText: 'Hit points' }).locator('td.num').allTextContents();
    expect(Number(hp[1].replace(/,/g, ''))).toBeGreaterThanOrEqual(Number(hp[0].replace(/,/g, '')));
    // a completed tech that unlocked a unit: eligible cities, one click to that city's mobilization tab
    const done = rp.locator('button.tech[data-status="completed"]');
    const n = await done.count();
    let found = false;
    for (let i = 0; i < n && !found; i++) {
      await done.nth(i).click();
      const btn = det.getByRole('button', { name: 'Eligible cities' }).first();
      if (await btn.count()) {
        await btn.click();
        found = true;
      }
    }
    expect(found, 'a completed tech that unlocks a unit').toBe(true);
    const dlg = page.getByRole('dialog', { name: 'Cities that can mobilize it' });
    await expect(dlg).toBeVisible();
    const cityCount = await frame<number>(page, 'f => f.view.cities.length');
    await expect(dlg.locator('li')).toHaveCount(cityCount);
    const okCity = dlg.locator('li.ok button').first();
    const cname = (await okCity.textContent())!.trim();
    await okCity.click();
    await expect(page.getByTestId('city-sheet-name')).toHaveText(cname);
    await expect(page.getByTestId('city-tab-mobilize')).toHaveAttribute('aria-selected', 'true');
  });
});

test.describe('verification pass 2 (mobile, touch only)', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch viewport only');

  test('touch: d-pad pans, two-finger pinch zooms around the fingers, a tap on a crowded sector opens the two-step picker', async ({ page }) => {
    test.setTimeout(240_000);
    await clearStorage(page);
    await page.goto('/');
    await page.getByTestId('new-campaign').tap();
    await expect(page.getByTestId('preview-capital')).toHaveText('Jakarta', { timeout: 120_000 });
    await page.getByTestId('seed-input').fill('9292');
    await page.getByTestId('start-campaign').tap();
    await expect(page.getByTestId('game')).toBeVisible({ timeout: 120_000 });
    await page.getByTestId('close-briefing').tap();
    await wc(page, 'wc.map().center(106.8, -6.2, 30)');
    type Cam = { cx: number; cy: number; z: number };
    const cam = () => wc<Cam>(page, 'wc.camera()');

    // d-pad: each arrow pans one step in its direction (camera centre moves; zoom unchanged)
    const dpad = page.getByRole('group', { name: 'Pan the map' });
    await expect(dpad).toBeVisible();
    let c0 = await cam();
    await dpad.getByRole('button', { name: 'Pan up' }).tap();
    let c1 = await cam();
    expect(c1.cy).toBeLessThan(c0.cy); // north (cy = −latitude)
    expect(c1.cx).toBeCloseTo(c0.cx, 6);
    c0 = c1;
    await dpad.getByRole('button', { name: 'Pan down' }).tap();
    c1 = await cam();
    expect(c1.cy).toBeGreaterThan(c0.cy);
    c0 = c1;
    await dpad.getByRole('button', { name: 'Pan left' }).tap();
    c1 = await cam();
    expect(c1.cx).toBeLessThan(c0.cx);
    c0 = c1;
    await dpad.getByRole('button', { name: 'Pan right' }).tap();
    c1 = await cam();
    expect(c1.cx).toBeGreaterThan(c0.cx);
    expect(c1.z).toBe(c0.z);

    // pinch: two touch points spreading apart zoom in; closing zooms out (real touch events via CDP)
    const box = (await page.locator('#map-canvas').boundingBox())!;
    const mx = box.x + box.width / 2, my = box.y + box.height / 2;
    const cdp = await page.context().newCDPSession(page);
    const pinch = async (from: number, to: number) => {
      const pts = (d: number) => [{ x: mx - d / 2, y: my, id: 1 }, { x: mx + d / 2, y: my, id: 2 }];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(from) });
      for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(from + ((to - from) * i) / 6) });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    const p0 = await cam();
    const z0 = p0.z;
    await pinch(80, 240);
    const p1 = await cam();
    const z1 = p1.z;
    expect(z1).toBeGreaterThan(z0 * 1.5);
    // the point between the fingers (the canvas centre here) stays put
    expect(Math.abs(p1.cx - p0.cx)).toBeLessThan(0.2);
    expect(Math.abs(p1.cy - p0.cy)).toBeLessThan(0.2);
    await pinch(240, 80);
    const z2 = (await cam()).z;
    expect(z2).toBeLessThan(z1 / 1.5);
    // a pinch is not a tap: nothing got selected
    expect(await wc(page, 'wc.ui().selection')).toBeNull();

    // crowded sector: one tap opens the picker listing every object there; a second tap selects one
    await wc(page, 'wc.map().center(106.8, -6.2, 30)');
    await page.waitForTimeout(500);
    const cl = await wc<{ cx: number; cy: number; ids: string[] } | null>(page, `(() => { const m = wc.map(); const b = m.canvas.getBoundingClientRect(); const h = m.hits.find(h => h.kind === 'cluster' && h.ids.every(i => i.startsWith('S:')) && h.x > 20 && h.y > 20 && h.x + h.w < m.w - 20 && h.y + h.h < m.h - 20); return h ? { cx: b.left + h.x + h.w / 2, cy: b.top + h.y + h.h / 2, ids: h.ids } : null; })()`);
    expect(cl, 'a crowded sector on screen').not.toBeNull();
    await page.touchscreen.tap(cl!.cx, cl!.cy);
    const chooser = page.getByRole('listbox', { name: 'Choose an object at this location' });
    await expect(chooser).toBeVisible();
    await expect(chooser.getByRole('option')).toHaveCount(cl!.ids.length);
    const pickId = cl!.ids[cl!.ids.length - 1];
    const label = await frame<string>(page, `f => f.view.stacks.find(s => s.id === ${JSON.stringify(pickId.slice(2))}).name`);
    await chooser.getByRole('option').last().tap();
    await expect(chooser).toHaveCount(0);
    expect(await wc(page, 'wc.ui().selection')).toEqual({ kind: 'stack', id: pickId.slice(2) });
    await expect(page.getByTestId('inspector-title')).toHaveText(label);
  });
});

