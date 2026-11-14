import { test, expect, type Page } from '@playwright/test';
import { clearStorage, newCampaign, frame, shot, openTargetList } from './helpers';

const wc = (page: Page, expr: string) => page.evaluate(`(() => { const wc = window.__wc; return ${expr}; })()`);

async function selectStack(page: Page, id: string) {
  await page.evaluate((sid) => {
    const w = window as unknown as { __wc: { ui: () => unknown } };
    void w;
    return sid;
  }, id);
  await page.getByTestId('rail-forces').click();
  await page.getByTestId(`formation-${id}`).click();
  await expect(page.getByTestId('inspector-title')).toBeVisible();
}

async function pickFirst(page: Page, testid: string, index = 1) {
  const sel = page.getByTestId(testid);
  await expect(sel.locator('option').nth(index)).toBeAttached({ timeout: 15_000 });
  // map-targeted orders keep their list selector under the collapsed "Choose from a list" fallback
  if (!(await sel.isVisible())) await openTargetList(page);
  const opts = sel.locator('option:not([disabled])');
  const v = await opts.nth(index).getAttribute('value');
  await sel.selectOption(v!);
}

test.describe('military orders (desktop)', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop');

  test('missiles: research → production → launch dialog with outcomes → in flight → viewer-scoped report', async ({ page }) => {
    test.setTimeout(240_000);
    await clearStorage(page);
    await newCampaign(page, 'IDN', 7070, '/?e2e=1');
    // test hook: grant the cruise blueprint (research path) and a launch complex in the capital
    await wc(page, 'wc.host().request({ op: "debugMissileSetup", missile: "msl_cruise" })');
    await page.getByTestId('rail-forces').click();
    const row = page.getByTestId('missile-msl_cruise');
    await expect(row.locator('[data-maturity]')).toBeVisible();
    const m0 = await row.locator('[data-maturity]').getAttribute('data-maturity');
    expect(['qualified', 'prototype']).toContain(m0);
    await page.getByTestId('produce-msl_cruise').click();
    await expect(page.getByTestId('produce')).toContainText('Cost (charged now)');
    await page.getByTestId('produce-confirm').click();
    await expect.poll(() => frame<number>(page, 'f => f.view.self.jobs.filter(j => j.kind === "missile").length')).toBe(1);
    await shot(page, 'mil-01-missile-queued');
    // production completes (only a completed job creates inventory)
    for (let i = 0; i < 4 && (await frame<number>(page, 'f => (f.view.self.missiles.msl_cruise || {}).ready || 0')) === 0; i++) await wc(page, 'wc.host().step(720)');
    expect(await frame<number>(page, 'f => f.view.self.missiles.msl_cruise.ready')).toBeGreaterThan(0);
    const ready0 = await frame<number>(page, 'f => f.view.self.missiles.msl_cruise.ready');
    await page.getByTestId('panel-close').click();
    await page.getByTestId('rail-forces').click();
    await expect(row.locator('[data-maturity]')).toHaveAttribute('data-maturity', 'ready');
    await page.getByTestId('launch-msl_cruise').click();
    await page.getByTestId('launch-from').selectOption('0');
    await pickFirst(page, 'launch-node-select', 1);
    await expect(page.getByTestId('launch-preview')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('launch-outcomes').locator('li')).toHaveCount(4);
    await expect(page.getByTestId('launch-headline')).toContainText('%');
    await shot(page, 'mil-02-launch-preview');
    if (await page.getByTestId('launch-war').isVisible().catch(() => false)) await page.getByTestId('launch-war').check();
    await page.getByTestId('launch-confirm').click();
    await expect(page.getByTestId('launch-done')).toContainText(`Ready inventory now: ${ready0 - 1}`);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    const fl = await frame<{ k: string; from: unknown }[]>(page, 'f => f.view.launches.map(l => ({ k: l.knowledge, from: l.from }))');
    expect(fl[0].k).toBe('in_flight');
    expect(fl[0].from).not.toBeNull();
    await page.getByTestId('panel-close').click();
    await shot(page, 'mil-03-in-flight');
    await wc(page, 'wc.host().step(240)');
    const k = await frame<string>(page, 'f => f.view.launches[0].knowledge');
    expect(['arrived_effect', 'arrived_limited', 'intercepted', 'failed', 'effect_unconfirmed']).toContain(k);
    await page.getByTestId('rail-forces').click();
    await expect(page.getByTestId('strike-reports')).not.toContainText('In flight');
    await shot(page, 'mil-04-report');
  });

  test('contact sheet: launch shortcut opens the validated launch dialog with the sector preselected', async ({ page }) => {
    test.setTimeout(240_000);
    await clearStorage(page);
    await newCampaign(page, 'IDN', 7171, '/?e2e=1');
    await wc(page, 'wc.host().request({ op: "debugMissileSetup", missile: "msl_cruise" })');
    // produce one batch through the normal production command
    await page.getByTestId('rail-forces').click();
    await page.getByTestId('produce-msl_cruise').click();
    await page.getByTestId('produce-confirm').click();
    await expect.poll(() => frame<number>(page, 'f => f.view.self.jobs.filter(j => j.kind === "missile").length')).toBe(1);
    await page.getByTestId('panel-close').click();
    // before inventory is ready the shortcut is disabled with a reason
    const pre = (await wc(page, 'wc.host().request({ op: "debugContact" })')) as { contactId: string; node: number };
    await page.getByRole('button', { name: 'Roster' }).click();
    await page.getByRole('button', { name: 'Known contacts', exact: true }).click();
    await page.locator(`[data-roster-id="C:${pre.contactId}"]`).click();
    await expect(page.getByTestId('contact-sheet')).toBeVisible();
    await expect(page.getByTestId('contact-launch')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('inspector')).toContainText('No ready missiles');
    for (let i = 0; i < 4 && (await frame<number>(page, 'f => (f.view.self.missiles.msl_cruise || {}).ready || 0')) === 0; i++) await wc(page, 'wc.host().step(720)');
    const ready0 = await frame<number>(page, 'f => f.view.self.missiles.msl_cruise.ready');
    expect(ready0).toBeGreaterThan(0);
    // fresh injected radar contact (the previous one may have been refreshed away by visibility)
    const info = (await wc(page, 'wc.host().request({ op: "debugContact" })')) as { contactId: string; node: number };
    if (!(await page.getByRole('button', { name: 'Known contacts', exact: true }).isVisible().catch(() => false))) await page.getByRole('button', { name: 'Roster' }).click();
    await page.getByRole('button', { name: 'Known contacts', exact: true }).click();
    await page.locator(`[data-roster-id="C:${info.contactId}"]`).click();
    await expect(page.getByTestId('contact-sheet')).toBeVisible();
    await expect(page.getByTestId('contact-launch')).not.toHaveAttribute('aria-disabled', 'true');
    await page.getByTestId('contact-launch').click();
    await expect(page.getByTestId('launch')).toBeVisible();
    await page.getByTestId('launch-missile').selectOption('msl_cruise');
    await page.getByTestId('launch-from').selectOption('0');
    await expect(page.getByTestId('launch-node-select')).toHaveValue(String(info.node));
    // the engine validator answers (preview or an explicit reason such as range) — nothing is committed
    await expect(page.getByTestId('launch-preview').or(page.getByTestId('launch').getByRole('alert')).first()).toBeVisible({ timeout: 15_000 });
    await shot(page, 'mil-09-contact-launch');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await frame<number>(page, 'f => f.view.self.missiles.msl_cruise.ready')).toBe(ready0);
    expect(await frame<number>(page, 'f => f.view.launches.length')).toBe(0);
  });

  test('aircraft: patrol with footprint/endurance preview, then rebase (new home)', async ({ page }) => {
    test.setTimeout(240_000);
    await clearStorage(page);
    await newCampaign(page, 'IDN', 8080);
    const air = await frame<{ id: string; home: number } | null>(page, 'f => { const s = f.view.stacks.find(s => s.air && s.air.state === "landed"); return s ? { id: s.id, home: s.air.home.node } : null; }');
    expect(air).not.toBeNull();
    await selectStack(page, air!.id);
    await expect(page.getByTestId('aircraft-panel')).toBeVisible();
    await page.getByTestId('action-patrol').click();
    await pickFirst(page, 'patrol-node-select', 2);
    await expect(page.getByTestId('patrol-preview')).toContainText('Time on station', { timeout: 15_000 });
    await shot(page, 'mil-05-patrol-preview');
    await page.getByTestId('patrol-confirm').click();
    await expect.poll(() => frame<string>(page, `f => f.view.stacks.find(s => s.id === "${air!.id}").air.state`)).not.toBe('landed');
    await wc(page, 'wc.host().step(60)');
    await expect(page.getByTestId('air-state')).not.toContainText('Landed');
    await shot(page, 'mil-06-patrolling');
    // let the sortie end and refuel, then rebase to another base
    for (let i = 0; i < 12; i++) {
      const st = await frame<string>(page, `f => (f.view.stacks.find(s => s.id === "${air!.id}") || { air: { state: 'gone' } }).air.state`);
      if (st === 'landed') break;
      await wc(page, 'wc.host().step(60)');
    }
    await expect(page.getByTestId('action-rebase')).toBeVisible();
    await page.getByTestId('action-rebase').click();
    await pickFirst(page, 'rebase-base', 2);
    await expect(page.getByTestId('rebase')).toContainText('Landing', { timeout: 15_000 });
    await page.getByTestId('rebase-confirm').click();
    await expect.poll(() => frame<string>(page, `f => f.view.stacks.find(s => s.id === "${air!.id}").air.state`)).toBe('rebasing');
    for (let i = 0; i < 12; i++) {
      const st = await frame<string>(page, `f => f.view.stacks.find(s => s.id === "${air!.id}").air.state`);
      if (st !== 'rebasing') break;
      await wc(page, 'wc.host().step(60)');
    }
    const home = await frame<number>(page, `f => f.view.stacks.find(s => s.id === "${air!.id}").air.home.node`);
    expect(home).not.toBe(air!.home);
  });

  test('retreat: destination and forecast HP cost, then the order is recorded', async ({ page }) => {
    test.setTimeout(180_000);
    await clearStorage(page);
    await newCampaign(page, 'IDN', 9090, '/?e2e=1');
    const eng = (await wc(page, 'wc.host().request({ op: "debugEngage" })')) as { stack: string; foeOwner: string };
    await selectStack(page, eng.stack);
    await page.getByTestId('action-retreat').click();
    await pickFirst(page, 'retreat-dest', 1);
    await expect(page.getByTestId('retreat-cost')).toContainText('HP', { timeout: 15_000 });
    await shot(page, 'mil-07-retreat');
    await page.getByTestId('retreat-confirm').click();
    await expect.poll(() => frame<boolean>(page, `f => !!(f.view.stacks.find(s => s.id === "${eng.stack}").order || {}).retreat`)).toBe(true);
    // the war is visible in diplomacy (declared by the other side in this test setup)
    expect(await frame<boolean>(page, `f => f.view.relations.find(r => r.country === "${eng.foeOwner}").war`)).toBe(true);
  });

  test('intelligence: assign an agent mission and buy a dated report', async ({ page }) => {
    test.setTimeout(180_000);
    await clearStorage(page);
    await newCampaign(page, 'IDN', 1111);
    await page.getByTestId('rail-intel').click();
    const sel = page.locator('#intel-target');
    const v = await sel.locator('option').nth(1).getAttribute('value');
    await sel.selectOption(v!);
    await page.getByRole('button', { name: 'Assign agent' }).click();
    await expect.poll(() => frame<number>(page, 'f => f.view.agents.length')).toBe(1);
    await page.getByTestId('buy-report').click();
    await expect.poll(() => frame<number>(page, 'f => f.view.reports.length')).toBeGreaterThan(0);
    await expect(page.getByTestId('report-history')).toBeVisible();
    await shot(page, 'mil-08-intel');
  });
});
