import { test, expect, type Page } from '@playwright/test';
import { clearStorage, newCampaign, frame, shot, wc, advance, advanceUntil, selectFormation } from './helpers';

/**
 * Management screens reached from the map (SPEC Annex A): market, coalitions, journal, newspaper,
 * toasts, unit dossier, split/merge, fire control, tutorial, home & archives, settings, credits
 * and diagnostics. Every state change goes through the validated command path.
 */

type Order = { id: string; side: string; resource: string; qty: number; filled: number; price: number; status: string; cancelledQty: number };

async function saveReloadContinue(page: Page) {
  await page.getByTestId('save-indicator').click();
  await expect(page.getByTestId('save-indicator')).toContainText('Saved', { timeout: 15_000 });
  await page.reload();
  await expect(page.getByTestId('continue-card')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('continue').click();
  await expect(page.getByTestId('game')).toBeVisible({ timeout: 60_000 });
}

test.describe('management screens (desktop)', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop');

  test('Annex A walkthrough 5 — market: inspect upkeep, post a sell order, partial AI fill, cancel the rest, reconcile before and after reload', async ({ page }) => {
    test.setTimeout(240_000);
    await clearStorage(page);
    await newCampaign(page, 'IDN', 5005, '/?e2e=1');
    // resources → economy: upkeep and the reconciling ledger
    await page.getByTestId('rail-economy').click();
    await expect(page.getByTestId('balance-table')).toContainText('Upkeep /day');
    await expect(page.getByTestId('economy-panel')).toContainText('Ledger reconciles exactly to the national stockpile.');
    await page.getByRole('button', { name: 'Open market', exact: true }).click();
    await expect(page.getByTestId('panel-market')).toBeVisible();
    await page.getByTestId('market-resource').selectOption('supplies');
    // the empty book is explained in place
    await expect(page.getByTestId('market-panel')).toContainText('Empty book');
    const form = page.getByTestId('order-form');
    // invalid amount is explained and blocks the order
    await page.getByTestId('order-qty').fill('0');
    await expect(form).toContainText('Amount must be a whole number of at least 1.');
    await expect(page.getByTestId('place-order')).toHaveAttribute('aria-disabled', 'true');
    // post a sell order: 100 supplies at 5.000 money/unit (nothing crosses → rests in the book)
    await form.getByLabel('Sell').check();
    await form.getByLabel('Resource').selectOption('supplies');
    await page.getByTestId('order-qty').fill('100');
    await page.getByTestId('order-price').fill('5.000');
    await expect(form).toContainText('Rests in book');
    await expect(form.locator('dd').filter({ hasText: /^100 units$/ })).toBeVisible();
    const s0 = await frame<{ stock: Record<string, number>; escrow: Record<string, number> }>(page, 'f => ({ stock: f.view.self.stock, escrow: f.view.self.escrow })');
    await page.getByTestId('place-order').click();
    await expect.poll(() => frame<number>(page, 'f => f.view.market.myOrders.filter(o => o.status === "open").length')).toBe(1);
    const s1 = await frame<typeof s0>(page, 'f => ({ stock: f.view.self.stock, escrow: f.view.self.escrow })');
    // posting reserves exactly the offered goods
    expect(s0.stock.supplies - s1.stock.supplies).toBe(100_000);
    expect((s1.escrow.supplies ?? 0) - (s0.escrow.supplies ?? 0)).toBe(100_000);
    await page.getByRole('tab', { name: 'My trades' }).click();
    const open = page.getByTestId('open-orders');
    await expect(open.locator('tbody tr')).toHaveCount(1);
    await expect(open.locator('tbody tr td').nth(2)).toHaveText('100');
    await expect(open.locator('tbody tr td').nth(3)).toHaveText('0');
    // a computer country submits a funded bid for 40 units (ordinary validated order) → partial fill
    const ai = await wc<{ country: string; ok: boolean; reason: string | null }>(page, 'wc.host().request({ op: "debugMarketOrder", side: "buy", resource: "supplies", qty: 40, price: 5000 })');
    expect(ai.ok, ai.reason ?? '').toBe(true);
    await expect(open.locator('tbody tr td').nth(3)).toHaveText('40');
    await expect(open.locator('tbody tr td').nth(4)).toHaveText('60');
    const s2 = await frame<typeof s0>(page, 'f => ({ stock: f.view.self.stock, escrow: f.view.self.escrow })');
    expect(s2.stock.money - s1.stock.money).toBe(40 * 5000); // seller receives the cash
    expect(s2.escrow.supplies - (s0.escrow.supplies ?? 0)).toBe(60_000); // only the unsold balance stays reserved
    await expect(page.getByTestId('market-panel')).toContainText(`sold to ${await wc<string>(page, `wc.countryName(${JSON.stringify(ai.country)})`)}`);
    // cancel the rest
    await open.getByRole('button', { name: 'Abort' }).click();
    await expect(page.getByTestId('open-orders')).toHaveCount(0);
    const mine = await frame<Order[]>(page, 'f => f.view.market.myOrders');
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ side: 'sell', resource: 'supplies', qty: 100, filled: 40, cancelledQty: 60 });
    expect(mine[0].status).not.toBe('open');
    const s3 = await frame<typeof s0>(page, 'f => ({ stock: f.view.self.stock, escrow: f.view.self.escrow })');
    expect(s3.stock.supplies).toBe(s0.stock.supplies - 40_000); // the unsold 60 came back
    expect(s3.escrow.supplies ?? 0).toBe(s0.escrow.supplies ?? 0);
    expect(s3.stock.money).toBe(s0.stock.money + 40 * 5000);
    // the cancelled residual stays in history
    await expect(page.getByTestId('market-panel')).toContainText('Completed and cancelled');
    await shot(page, 'scr-market-history');
    // reload: open reservations, executions and ordering preserved
    const snap = 'f => JSON.stringify({ stock: f.view.self.stock, escrow: f.view.self.escrow, orders: f.view.market.myOrders, fills: f.view.market.myFills })';
    const before = await frame<string>(page, snap);
    await page.getByTestId('panel-close').click();
    await saveReloadContinue(page);
    expect(await frame<string>(page, snap)).toBe(before);
    await page.getByTestId('rail-economy').click();
    await expect(page.getByTestId('economy-panel')).toContainText('Ledger reconciles exactly to the national stockpile.');
  });

  test('coalitions: create with name/description/emblem, details, coalition-only thread, leave with timed notice', async ({ page }) => {
    test.setTimeout(240_000);
    await clearStorage(page);
    await newCampaign(page, 'IDN', 6060);
    await page.getByTestId('rail-coalition').click();
    const cp = page.getByTestId('coalition-panel');
    await expect(cp).toContainText('You are not in a coalition.');
    await cp.getByRole('button', { name: 'Create coalition…' }).click();
    const dlg = page.getByRole('dialog', { name: 'Create a coalition' });
    // name required
    await expect(dlg.getByRole('button', { name: 'Create', exact: true })).toHaveAttribute('aria-disabled', 'true');
    await dlg.getByLabel('Name').fill('Archipelago Pact');
    await dlg.getByLabel('Description').fill('Maritime security in the Java Sea.');
    await dlg.getByRole('radio').nth(7).check(); // ⚓
    await dlg.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(cp).toContainText('You are a member of Archipelago Pact.');
    const co = await frame<{ id: string; leader: string; members: string[]; emblem: string; description: string }>(page, 'f => f.view.coalitions.find(c => c.id === f.view.myCoalition)');
    expect(co).toMatchObject({ leader: 'IDN', members: ['IDN'], emblem: '⚓', description: 'Maritime security in the Java Sea.' });
    // details: leader, total and required score, remaining slots, admission
    await cp.getByRole('row', { name: /Archipelago Pact/ }).getByRole('button', { name: 'Details' }).click();
    for (const t of ['Leader', 'Total score', 'Required', 'Remaining slots', 'Admission', 'Indonesia (you)']) await expect(cp).toContainText(t);
    await expect(cp.locator('dt:has-text("Remaining slots") + dd')).toHaveText('4');
    // cannot found a second one / apply elsewhere while a member
    await expect(cp.getByRole('button', { name: 'Create coalition…' })).toHaveAttribute('aria-disabled', 'true');
    // coalition-only thread
    await cp.getByLabel('Coalition message').fill('Convoy schedule follows.');
    await cp.getByRole('button', { name: 'Post' }).click();
    await expect(cp).toContainText('Convoy schedule follows.');
    expect(await frame<string[]>(page, `f => (f.view.messages["co:${co.id}"] || []).map(m => m.text)`)).toContain('Convoy schedule follows.');
    await shot(page, 'scr-coalition');
    // leave: the consequence (24 h notice) is shown before committing
    await cp.getByRole('button', { name: 'Leave coalition…' }).click();
    const leave = page.getByRole('dialog', { name: 'Leave coalition?' });
    await expect(leave).toContainText('24 h notice');
    await leave.getByRole('button', { name: 'Announce departure' }).click();
    await expect.poll(() => frame<number>(page, `f => (f.view.coalitions.find(c => c.id === "${co.id}") || { departures: [] }).departures.length`)).toBe(1);
    const eff = await frame<number>(page, `f => f.view.coalitions.find(c => c.id === "${co.id}").departures[0].effectiveAt`);
    await expect(cp).toContainText('Leaving at');
    await expect(cp.getByRole('button', { name: 'Leave coalition…' })).toHaveAttribute('aria-disabled', 'true');
    expect(await frame<string | null>(page, 'f => f.view.myCoalition')).toBe(co.id); // still a member during notice
    await page.getByTestId('panel-close').click();
    await advance(page, eff - (await frame<number>(page, 'f => f.view.tick')) + 60);
    expect(await frame<string | null>(page, 'f => f.view.myCoalition')).toBeNull();
    await page.getByTestId('rail-coalition').click();
    await expect(page.getByTestId('coalition-panel')).toContainText('You are not in a coalition.');
    // membership history is kept as an event
    expect(await frame<number>(page, 'f => f.view.journal.filter(e => /coalition/i.test(e.kind) || /coalition/i.test(e.text)).length')).toBeGreaterThan(0);
  });

  test('journal, toasts and newspaper: grouped by day, filters, event detail after the unit is gone, jump-to, editions without future days, anonymous statement', async ({ page }) => {
    test.setTimeout(300_000);
    await clearStorage(page);
    await newCampaign(page, 'IDN', 7007);
    // queue a mobilization so a dated, placed event will be recorded
    await page.locator('#map-search-input').fill('Jakarta');
    await page.keyboard.press('Enter');
    await page.getByTestId('inspector-mobilize').click();
    await page.locator('[data-testid="unit-catalog"] button[data-testid^="mobilize-"]:not([aria-disabled="true"])').first().click();
    await expect.poll(() => frame<number>(page, 'f => f.view.self.jobs.filter(j => j.kind === "mobilize").length')).toBe(1);
    const job = await frame<{ endsAt: number }>(page, 'f => f.view.self.jobs.find(j => j.kind === "mobilize")');
    await page.getByTestId('panel-close').click();
    await page.keyboard.press('Escape');
    // advance until the job completes: a routine completion goes to the history, not a toast
    await advance(page, job.endsAt - (await frame<number>(page, 'f => f.view.tick')) + 15);
    const done = await frame<{ id: string; text: string; node: number; routine: boolean }>(page, 'f => f.view.journal.find(e => e.kind === "job_completed")');
    expect(done.routine).toBe(true);
    // a non-routine placed event (a purchased intelligence report) raises a toast with jump-to
    await page.getByTestId('rail-intel').click();
    const tgt = page.locator('#intel-target');
    await tgt.selectOption((await tgt.locator('option').nth(1).getAttribute('value'))!);
    await page.getByRole('button', { name: 'Assign agent' }).click();
    await expect.poll(() => frame<number>(page, 'f => f.view.agents.length')).toBe(1);
    await page.getByTestId('buy-report').click();
    await page.getByTestId('panel-close').click();
    const toast = page.getByTestId('toasts').locator('.toast').filter({ has: page.getByRole('button', { name: 'Jump to location' }) }).first();
    await expect(toast).toBeVisible();
    const toastText = (await toast.innerText()).split('\n')[0];
    const paused = await page.getByTestId('pause-toggle').getAttribute('aria-pressed');
    await toast.getByRole('button', { name: 'Jump to location' }).click();
    await expect.poll(() => wc<string | null>(page, 'wc.ui().selection?.kind ?? null')).not.toBeNull();
    await expect(page.getByTestId('pause-toggle')).toHaveAttribute('aria-pressed', paused ?? 'false'); // toasts never change the clock
    await toast.getByRole('button', { name: 'Dismiss notification' }).click();
    await expect(page.getByTestId('toasts').locator('.toast').filter({ hasText: toastText })).toHaveCount(0);
    // journal: grouped by day, newest first, filters
    await page.getByTestId('rail-journal').click();
    const jp = page.getByTestId('journal-panel');
    await expect(jp.locator('section[aria-label^="Day"]').first()).toBeVisible();
    const total = await jp.locator('li').count();
    expect(total).toBeGreaterThan(0);
    for (const c of ['economy', 'research', 'diplomacy', 'combat', 'intel']) {
      await page.getByTestId(`journal-filter-${c}`).click();
      await expect(page.getByTestId(`journal-filter-${c}`)).toHaveAttribute('aria-pressed', 'true');
      await expect(jp.locator('li').first().or(jp.locator('.empty'))).toBeVisible();
      for (const tag of await jp.locator('li .tag').allInnerTexts()) expect(tag).toBe(c);
    }
    await page.getByTestId('journal-filter-all').click();
    await expect(jp.locator('li')).toHaveCount(total);
    // open the mobilization event: place, time and outcome remain readable
    const entry = jp.locator('li').filter({ hasText: done.text }).first();
    await entry.locator('button[aria-expanded]').click();
    await expect(entry).toContainText('Recorded');
    await expect(entry).toContainText('Place');
    await expect(entry).toContainText('keeps its place, time and outcome');
    // notification history contains the toast
    await jp.getByRole('tab', { name: /Notification history/ }).click();
    await expect(jp).toContainText(toastText.slice(0, 20));
    const hist = jp.locator('li').filter({ hasText: done.text.slice(0, 20) }).first();
    await expect(hist).toBeVisible();
    await hist.getByRole('button', { name: 'Go' }).click();
    await expect(page.getByTestId('panel-journal')).toHaveCount(0);
    expect(await wc<{ kind: string; node?: number }>(page, 'wc.ui().selection')).toMatchObject({ node: done.node });
    await page.getByTestId('rail-journal').click();
    await shot(page, 'scr-journal');
    // newspaper: today's edition, next is disabled (no future), previous works after day 2
    await advance(page, 24 * 60);
    await page.getByTestId('rail-news').click();
    const np = page.getByTestId('news-panel');
    const today = await frame<number>(page, 'f => f.view.day');
    await expect(np).toContainText(`The World 120 Dispatch — Day ${today}`);
    await expect(np.getByRole('button', { name: 'Next edition' })).toBeDisabled();
    await np.getByRole('button', { name: 'Previous edition' }).click();
    await expect(np).toContainText(`Day ${today - 1}`);
    await np.getByRole('button', { name: 'Next edition' }).click();
    await expect(np).toContainText(`Day ${today}`);
    await expect(np.getByRole('button', { name: 'Next edition' })).toBeDisabled();
    // ranked nation index
    await expect(np.locator('table.data tbody tr').first()).toContainText('VP');
    // anonymous statement, plain text
    const pub = np.getByRole('form', { name: 'Publish a statement' });
    await expect(pub.getByRole('button', { name: 'Publish' })).toHaveAttribute('aria-disabled', 'true');
    await pub.getByLabel('Headline').fill('Shipping lanes stay open');
    await pub.getByLabel('Body (plain text)').fill('<b>No</b> blockade is planned.');
    await pub.getByLabel('Publish anonymously').check();
    await pub.getByRole('button', { name: 'Publish' }).click();
    const art = np.locator('article').filter({ hasText: 'Shipping lanes stay open' });
    await expect(art).toContainText('Anonymous statement');
    await expect(art).toContainText('<b>No</b> blockade is planned.'); // shown as text, not markup
    expect(await art.locator('b').count()).toBe(0);
    await expect(art).not.toContainText('By Indonesia');
    await shot(page, 'scr-news');
  });

  test('unit dossier: class, level, HP, upkeep, feature names, combat table by target class, terrain table, unavailable cells, back to the previous screen', async ({ page }) => {
    test.setTimeout(180_000);
    await clearStorage(page);
    await newCampaign(page, 'IDN', 8118);
    const st = await frame<{ id: string; type: string }>(page, 'f => { const s = f.view.stacks.find(s => s.moveClass === "ground" && s.units.length > 0); return { id: s.id, type: s.units[0].type }; }');
    await selectFormation(page, st.id);
    const unitName = await wc<string>(page, `wc.unitName(${JSON.stringify(st.type)})`);
    await page.getByRole('button', { name: `Open dossier for ${unitName}` }).click();
    const d = page.getByTestId('unit-dossier');
    await expect(d).toBeVisible();
    await expect(d.locator('h3')).toHaveText(unitName);
    for (const t of ['Hit points', 'Upkeep', 'Features', 'Occupier', 'Kills', 'Sight', 'Signature']) await expect(d).toContainText(t);
    const ct = page.getByTestId('combat-table');
    for (const cls of ['unarmored', 'armored', 'helicopter', 'airplane', 'ship', 'submarine', 'building']) await expect(ct.locator('thead')).toContainText(new RegExp(cls, 'i'));
    const tt = page.getByTestId('terrain-table');
    for (const terr of ['Open ground', 'Mountains', 'Forest', 'Urban']) await expect(tt).toContainText(terr);
    // explicit unavailable cells (not blanks)
    await expect(d.locator('[aria-label="not available"]').first()).toBeVisible();
    // level selector switches base stats
    await d.getByLabel('Level').selectOption({ index: 0 });
    await shot(page, 'scr-dossier');
    await d.getByRole('button', { name: '← Previous screen' }).click();
    await expect(page.getByTestId('unit-dossier')).toHaveCount(0);
  });

  test('split, merge and fire control on a friendly formation: before/after roster, conservation, inspector shows the behaviour', async ({ page }) => {
    test.setTimeout(180_000);
    await clearStorage(page);
    await newCampaign(page, 'IDN', 9119);
    const st = await frame<{ id: string; n: number; node: number; hp: number }>(page, 'f => { const s = f.view.stacks.find(s => s.moveClass === "ground" && s.units.length >= 2 && s.pos.kind === "node"); return { id: s.id, n: s.units.length, node: s.pos.node, hp: s.units.reduce((a, u) => a + u.hp, 0) }; }');
    const all0 = await frame<{ stacks: number; units: number; hp: number }>(page, 'f => ({ stacks: f.view.stacks.length, units: f.view.stacks.reduce((a, s) => a + s.units.length, 0), hp: f.view.stacks.reduce((a, s) => a + s.units.reduce((b, u) => b + u.hp, 0), 0) })');
    await selectFormation(page, st.id);
    // fire control: change and read back in the inspector
    const fire = page.getByTestId('inspector').getByLabel('Fire control');
    await fire.selectOption('engage');
    await expect.poll(() => frame<string>(page, `f => f.view.stacks.find(s => s.id === "${st.id}").firePolicy`)).toBe('engage');
    await expect(page.getByTestId('inspector').locator('dt:has-text("Fire control") + dd')).toHaveText('Engage eligible contacts');
    await fire.selectOption('hold');
    await expect(page.getByTestId('inspector').locator('dt:has-text("Fire control") + dd')).toHaveText('Hold unless ordered');
    // split: nothing picked → disabled with a reason; picking all but zero → disabled
    await page.getByRole('button', { name: 'Split…' }).click();
    const dlg = page.getByRole('dialog', { name: /^Split / });
    await expect(dlg).toContainText(`Before: ${st.n} units. After: ${st.n} stay, 0 form a new formation.`);
    await expect(dlg.getByRole('button', { name: /Split 0 unit/ })).toHaveAttribute('aria-disabled', 'true');
    await expect(dlg).toContainText('Pick at least one unit to detach.');
    const boxes = dlg.getByRole('checkbox');
    for (let i = 0; i < st.n; i++) await boxes.nth(i).check();
    await expect(dlg).toContainText('Leave at least one unit in the original formation.');
    for (let i = 1; i < st.n; i++) await boxes.nth(i).uncheck();
    await expect(dlg).toContainText(`After: ${st.n - 1} stay, 1 form a new formation.`);
    await dlg.getByRole('button', { name: 'Split 1 unit(s)' }).click();
    await expect(dlg).toHaveCount(0);
    const all1 = await frame<typeof all0>(page, 'f => ({ stacks: f.view.stacks.length, units: f.view.stacks.reduce((a, s) => a + s.units.length, 0), hp: f.view.stacks.reduce((a, s) => a + s.units.reduce((b, u) => b + u.hp, 0), 0) })');
    expect(all1).toEqual({ ...all0, stacks: all0.stacks + 1 }); // same units and HP, one more formation
    expect(await frame<number>(page, `f => f.view.stacks.find(s => s.id === "${st.id}").units.length`)).toBe(st.n - 1);
    // the new formation is in the roster and on the same node
    const newId = await frame<string>(page, `f => f.view.stacks.filter(s => s.pos.kind === "node" && s.pos.node === ${st.node} && s.id !== "${st.id}" && s.units.length === 1).map(s => s.id).pop()`);
    await page.getByTestId('rail-forces').click();
    await expect(page.getByTestId(`formation-${newId}`)).toBeVisible();
    await page.getByTestId('panel-close').click();
    // merge back from the original formation's sheet
    await selectFormation(page, st.id);
    const merge = page.getByRole('button', { name: /^Merge here \(\d+\)$/ });
    await expect(merge).not.toHaveAttribute('aria-disabled', 'true');
    await merge.click();
    await expect.poll(() => frame<number>(page, 'f => f.view.stacks.length')).toBeLessThan(all1.stacks);
    const all2 = await frame<typeof all0>(page, 'f => ({ stacks: f.view.stacks.length, units: f.view.stacks.reduce((a, s) => a + s.units.length, 0), hp: f.view.stacks.reduce((a, s) => a + s.units.reduce((b, u) => b + u.hp, 0), 0) })');
    expect(all2.units).toBe(all0.units);
    expect(all2.hp).toBe(all0.hp);
    await shot(page, 'scr-merge');
  });

  test('tutorial: start from the briefing, skip a step, reopen it, auto-complete from real actions, progress saved in the campaign', async ({ page }) => {
    test.setTimeout(180_000);
    await clearStorage(page);
    await page.goto('/');
    await page.getByTestId('new-campaign').click();
    await expect(page.getByTestId('preview-capital')).toBeVisible({ timeout: 120_000 });
    await page.getByTestId('seed-input').fill('1212');
    await page.getByTestId('start-campaign').click();
    await expect(page.getByTestId('game')).toBeVisible({ timeout: 120_000 });
    await page.getByTestId('start-tutorial').click();
    const tut = page.getByTestId('tutorial');
    await expect(tut).toContainText('0/5 done');
    await expect(tut).toContainText('Select a city');
    // "Show me" focuses the relevant control
    await tut.getByRole('button', { name: 'Show me' }).click();
    await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.testid ?? null)).toBe('rail-cities');
    // skip, then reopen
    await tut.getByRole('button', { name: 'Skip step' }).click();
    await expect(tut).toContainText('1/5 done');
    await expect(tut).toContainText('Read your resource balance');
    await tut.getByRole('button', { name: 'reopen' }).click();
    await expect(tut).toContainText('0/5 done');
    // a real action completes the lesson
    await page.locator('#map-search-input').fill('Jakarta');
    await page.keyboard.press('Enter');
    await expect(tut).toContainText('1/5 done');
    await page.getByTestId('rail-economy').click();
    await expect(tut).toContainText('2/5 done');
    await page.getByTestId('panel-close').click();
    // close and reopen from the game menu: progress kept
    await tut.getByRole('button', { name: 'Close tutorial' }).click();
    await expect(page.getByTestId('tutorial')).toHaveCount(0);
    await page.getByTestId('game-menu').click();
    await page.getByRole('button', { name: 'Reopen tutorial' }).click();
    await expect(page.getByTestId('tutorial')).toContainText('2/5 done');
    // saved inside the campaign (survives reload)
    await saveReloadContinue(page);
    expect(await frame<string>(page, 'f => String(f.uiPrefs["tutorial.done"] || "")')).toMatch(/select_city/);
    await page.getByTestId('game-menu').click();
    await page.getByRole('button', { name: 'Reopen tutorial' }).click();
    await expect(page.getByTestId('tutorial')).toContainText('2/5 done');
  });

  test('home and archives: archive hides from the active list, restore brings it back unchanged, delete asks first', async ({ page }) => {
    test.setTimeout(240_000);
    await clearStorage(page);
    await newCampaign(page, 'IDN', 3131);
    await page.getByTestId('step-hour').click();
    await expect(page.getByTestId('game-clock')).toContainText('D1 07:00');
    const snap = 'f => JSON.stringify({ tick: f.view.tick, seed: f.meta.seed, stock: f.view.self.stock, stacks: f.view.stacks.length })';
    const idn = await frame<string>(page, snap);
    await page.getByTestId('game-menu').click();
    await page.getByTestId('home-button').click();
    await newCampaign(page, 'BOL', 3132);
    await page.getByTestId('game-menu').click();
    await page.getByTestId('home-button').click();
    await page.getByTestId('load-campaign').click();
    const list = page.getByTestId('campaign-list');
    await expect(list.locator('tbody tr')).toHaveCount(2);
    // the row shows nation, scenario, day and last saved time
    const row = list.locator('tbody tr').filter({ hasText: 'Indonesia' });
    await expect(row).toContainText('World 120');
    await expect(row).toContainText('seed 3131');
    // archive Indonesia
    await row.getByRole('button', { name: 'Archive' }).click();
    await expect(list.locator('tbody tr')).toHaveCount(1);
    await expect(list).not.toContainText('Indonesia');
    await expect(page.getByRole('tab', { name: 'Archived (1)' })).toBeVisible();
    await page.getByRole('tab', { name: 'Archived (1)' }).click();
    await expect(page.getByTestId('campaign-list').locator('tbody tr')).toHaveCount(1);
    await expect(page.getByTestId('campaign-list')).toContainText('Indonesia');
    // the title screen's Continue never offers an archived campaign … restore it
    await page.getByTestId('campaign-list').getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByRole('tab', { name: 'Archived (0)' })).toBeVisible();
    await page.getByRole('tab', { name: 'Active (2)' }).click();
    await expect(page.getByTestId('campaign-list').locator('tbody tr')).toHaveCount(2);
    // resume the restored campaign: progress intact
    await page.getByRole('button', { name: 'Resume Indonesia' }).click();
    await expect(page.getByTestId('game')).toBeVisible({ timeout: 60_000 });
    expect(await frame<string>(page, snap)).toBe(idn);
    // delete Bolivia (with confirmation; cancel first)
    await page.getByTestId('game-menu').click();
    await page.getByTestId('home-button').click();
    await page.getByTestId('load-campaign').click();
    const bol = page.getByTestId('campaign-list').locator('tbody tr').filter({ hasText: 'Bolivia' });
    await bol.getByRole('button', { name: 'Delete' }).click();
    const del = page.getByRole('dialog', { name: 'Delete campaign?' });
    await expect(del).toContainText('cannot be undone');
    await del.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('campaign-list').locator('tbody tr')).toHaveCount(2);
    await bol.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('dialog', { name: 'Delete campaign?' }).getByRole('button', { name: 'Delete permanently' }).click();
    await expect(page.getByTestId('campaign-list').locator('tbody tr')).toHaveCount(1);
    await expect(page.getByTestId('campaign-list')).toContainText('Indonesia');
  });

  test('settings, credits and diagnostics: theme and interruptions persist per device; catch-up is named, capped and summarised', async ({ page }) => {
    test.setTimeout(240_000);
    await clearStorage(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings' }).click();
    // defaults: interruptions on for war/capital/end; catch-up off
    await expect(page.getByLabel('War declared on me')).toBeChecked();
    await expect(page.getByLabel('My capital changes hands')).toBeChecked();
    await expect(page.getByLabel('Campaign end / elimination')).toBeChecked();
    await expect(page.getByTestId('catchup-toggle')).not.toBeChecked();
    await page.getByLabel('Theme').selectOption('light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByLabel('War declared on me').uncheck();
    await page.getByLabel('Monochrome unit symbols (frame shapes carry affiliation)').check();
    await page.getByLabel('Sound cues (local, off by default)').check();
    await page.getByTestId('catchup-toggle').check();
    await page.getByLabel('Maximum').fill('2');
    await page.reload();
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.getByLabel('War declared on me')).not.toBeChecked();
    await expect(page.getByLabel('Monochrome unit symbols (frame shapes carry affiliation)')).toBeChecked();
    await expect(page.getByLabel('Sound cues (local, off by default)')).toBeChecked();
    await expect(page.getByTestId('catchup-toggle')).toBeChecked();
    await expect(page.getByLabel('Maximum')).toHaveValue('2');
    await page.getByRole('button', { name: '← Back' }).click();
    // credits and diagnostics (local, no server)
    await page.getByRole('button', { name: 'Credits' }).click();
    await expect(page.getByTestId('milsymbol-license')).toContainText('MIT');
    await expect(page.locator('main')).toContainText('Natural Earth');
    await page.getByRole('button', { name: '← Back' }).click();
    await page.getByRole('button', { name: 'Diagnostics' }).click();
    await expect(page.getByTestId('app-version')).not.toBeEmpty();
    await expect(page.locator('main')).toContainText('Save format version');
    await expect(page.locator('dt:has-text("Last successful save") + dd')).toHaveText('none this session');
    await expect(page.locator('main')).toContainText('Not applicable — fully local, no server');
    await expect(page.getByLabel('Error report (copy and keep with your exported save)')).toHaveValue(/World Command .*\nUser agent/);
    await page.getByRole('button', { name: '← Back' }).click();
    // catch-up: closed-app time is simulated at 1×, capped, then paused with a summary
    await newCampaign(page, 'IDN', 4141);
    await page.getByTestId('game-menu').click();
    await page.getByTestId('home-button').click();
    await expect(page.getByTestId('continue')).toBeVisible();
    await page.waitForTimeout(4000);
    await page.getByTestId('continue').click();
    await expect(page.getByTestId('game')).toBeVisible({ timeout: 60_000 });
    const tick = await frame<number>(page, 'f => f.view.tick');
    expect(tick).toBeGreaterThanOrEqual(3);
    expect(tick).toBeLessThanOrEqual(120);
    await expect(page.getByTestId('pause-toggle')).toHaveAttribute('aria-pressed', 'false');
    // the summary names the simulated time and the cap (never "0 game hours")
    await expect(page.getByTestId('toasts')).toContainText(`Catch-up: simulated ${tick} min of closed-app game time (maximum 2 h). Paused.`);
    // in-game settings dialog exposes the same preferences
    await page.getByTestId('game-menu').click();
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByRole('dialog', { name: 'Settings' }).getByTestId('catchup-toggle')).toBeChecked();
  });
});
