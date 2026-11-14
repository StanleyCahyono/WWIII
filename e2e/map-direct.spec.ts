import { test, expect, type Page } from '@playwright/test';
import { clearStorage, newCampaign, frame, wc, selectFormation } from './helpers';

/**
 * Direct map interaction (desktop):
 *  - selecting a formation by clicking its drawn marker — centre and edges, at three zoom levels,
 *    with APP-6 symbols and with game counters, and with small (≤ 4 px) mouse jitter;
 *  - map-targeted orders: hover shows the validator's live preview, one click sets the target,
 *    Confirm issues the order, Esc / right-click cancels — for patrol, move and rebase.
 */

type Box = { id: string; kind: string; x: number; y: number; w: number; h: number; ax: number; ay: number };

/** Current hit boxes of single friendly formations, in page coordinates (box = drawn marker). */
async function stackBoxes(page: Page): Promise<Box[]> {
  await page.waitForTimeout(350);
  return wc<Box[]>(
    page,
    `(() => { const m = wc.map(); const b = m.canvas.getBoundingClientRect();
      return m.hits.filter(h => h.kind === 'object' && !h.locate && h.ids[0].startsWith('S:'))
        .map(h => ({ id: h.ids[0], kind: h.kind, x: b.left + h.x, y: b.top + h.y, w: h.w, h: h.h, ax: b.left + (h.cx ?? h.x + h.w / 2), ay: b.top + (h.cy ?? h.y + h.h / 2) }))
        .filter(h => h.x > b.left + 30 && h.y > b.top + 30 && h.x + h.w < b.right - 90 && h.y + h.h < b.bottom - 160); })()`,
  );
}

async function boxOf(page: Page, id: string): Promise<Box | null> {
  return (await stackBoxes(page)).find((b) => b.id === id) ?? null;
}

/** Hit box of one object wherever it is drawn (no on-screen margin filter). */
async function anyBoxOf(page: Page, id: string): Promise<Box | null> {
  await page.waitForTimeout(350);
  return wc<Box | null>(page, `(() => { const m = wc.map(); const b = m.canvas.getBoundingClientRect(); const h = m.hits.find(h => h.ids.includes(${JSON.stringify(id)}) && !h.locate);
    return h ? { id: h.ids[0], kind: h.kind, x: b.left + h.x, y: b.top + h.y, w: h.w, h: h.h, ax: b.left + (h.cx ?? h.x + h.w / 2), ay: b.top + (h.cy ?? h.y + h.h / 2) } : null; })()`);
}

const selection = (page: Page) => wc<{ kind: string; id?: string } | null>(page, 'wc.ui().selection');

async function clearSelection(page: Page) {
  await page.keyboard.press('Escape');
  await expect.poll(() => selection(page)).toBeNull();
}

async function setUnitStyle(page: Page, style: 'app6' | 'counters') {
  await page.getByTestId('layers-button').click();
  await page.getByTestId(`unit-style-${style}`).check();
  await page.getByTestId('layers-button').click();
}

/** A page point inside sector `node` (its label point, or the nearest point of a small grid around it). */
async function pointInNode(page: Page, node: number): Promise<{ x: number; y: number }> {
  const p = await wc<{ x: number; y: number } | null>(
    page,
    `(() => { const m = wc.map(), c = wc.nodeCenter(${node}); if (!c) return null;
      for (let r = 0; r <= 0.6; r += 0.05) for (const [dx, dy] of [[0,0],[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]]) {
        const lon = c[0] + dx * r, lat = c[1] + dy * r;
        if (m.nodeAt(lon, lat) === ${node}) return wc.project(lon, lat);
      }
      return null; })()`,
  );
  expect(p, `a point inside sector ${node}`).not.toBeNull();
  return p!;
}

/** Centre the map on a sector and return a page point inside it (clear of the HUD and the order bar). */
async function focusNode(page: Page, node: number, zoom = 22): Promise<{ x: number; y: number }> {
  const c = await wc<[number, number]>(page, `wc.nodeCenter(${node})`);
  await wc(page, `wc.map().center(${c[0]}, ${c[1]}, ${zoom})`);
  await page.waitForTimeout(300);
  return pointInNode(page, node);
}

test.describe('direct map interaction (desktop)', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop');

  test('clicking a formation selects it: centre and edges, three zoom levels, both marker styles, jitter ≤ 4 px; hover shows what a click selects', async ({ page }) => {
    test.setTimeout(300_000);
    await clearStorage(page);
    await newCampaign(page, 'IDN', 12345, '/?e2e=1');
    let checked = 0;
    for (const style of ['app6', 'counters'] as const) {
      await setUnitStyle(page, style);
      for (const z of [14, 24, 45]) {
        await wc(page, `wc.map().center(106.8, -6.2, ${z})`);
        const boxes = (await stackBoxes(page)).slice(0, 2);
        expect(boxes.length, `${style} z=${z}: a single formation marker on screen`).toBeGreaterThan(0);
        for (const b0 of boxes) {
          // centre, the four drawn edges (1 px inside), and a press that slips 4 px before release
          const pts: { dx: number; dy: number; jitter?: number; edge?: 'l' | 'r' | 't' | 'b' }[] = [{ dx: 0, dy: 0 }, { dx: 0, dy: 0, edge: 'l' }, { dx: 0, dy: 0, edge: 'r' }, { dx: 0, dy: 0, edge: 't' }, { dx: 0, dy: 0, edge: 'b' }, { dx: 0, dy: 0, jitter: 4 }, { dx: 0, dy: 0, edge: 'r', jitter: 3 }];
          for (const pt of pts) {
            await clearSelection(page);
            await wc(page, `wc.map().center(106.8, -6.2, ${z})`);
            const b = await boxOf(page, b0.id);
            expect(b, `${b0.id} still drawn`).not.toBeNull();
            const x = pt.edge === 'l' ? b!.x + 1 : pt.edge === 'r' ? b!.x + b!.w - 1 : b!.ax;
            const y = pt.edge === 't' ? b!.y + 1 : pt.edge === 'b' ? b!.y + b!.h - 1 : b!.ay;
            await page.mouse.move(x, y);
            await page.mouse.down();
            if (pt.jitter) await page.mouse.move(x + pt.jitter * (pt.edge === 'r' ? 1 : 0.8), y - (pt.edge === 'r' ? 0 : pt.jitter * 0.6), { steps: 3 });
            await page.mouse.up();
            await expect.poll(() => selection(page), { message: `${style} z=${z} ${b0.id} ${pt.edge ?? 'centre'} jitter=${pt.jitter ?? 0}` }).toEqual({ kind: 'stack', id: b0.id.slice(2) });
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(2 * 3 * 7);

    // hover: pointer cursor, ring and a tooltip naming what a click would select
    await setUnitStyle(page, 'app6');
    await clearSelection(page);
    await wc(page, 'wc.map().center(106.8, -6.2, 24)');
    const b = (await stackBoxes(page))[0];
    await page.mouse.move(b.ax - 30, b.ay - 40);
    await page.mouse.move(b.ax, b.ay, { steps: 3 });
    await expect(page.getByTestId('map-tooltip')).toBeVisible();
    const label = await wc<string>(page, `wc.map().hits.find(h => h.ids[0] === ${JSON.stringify(b.id)}).label`);
    await expect(page.getByTestId('map-tooltip')).toContainText(label);
    expect(await page.locator('#map-canvas').evaluate((c) => (c as HTMLCanvasElement).style.cursor)).toBe('pointer');
    expect(await wc<string[]>(page, 'wc.map().hoverIds')).toContain(b.id);

    // a drag beyond the threshold pans instead of selecting
    await page.mouse.down();
    await page.mouse.move(b.ax + 40, b.ay + 25, { steps: 5 });
    await page.mouse.up();
    expect(await selection(page)).toBeNull();

    // selecting a province opens the side inspector: the map does not slide under the pointer
    await wc(page, 'wc.map().center(106.8, -6.2, 24)');
    const before = (await stackBoxes(page))[0];
    const land = await wc<{ x: number; y: number }>(page, `(() => { const m = wc.map(), b = m.canvas.getBoundingClientRect();
      for (let lat = -6.6; lat > -8.2; lat -= 0.1) for (let lon = 106; lon < 112; lon += 0.15) {
        const p = wc.project(lon, lat), x = p.x - b.left, y = p.y - b.top;
        if (x < 60 || y < 60 || x > m.w - 120 || y > m.h - 180 || m.hitAt(x, y, 16)) continue;
        const n = m.nodeAt(lon, lat);
        if (n !== null && wc.frame().view.owners[n] === wc.frame().view.viewer) return p;
      } return null; })()`);
    await page.mouse.click(land.x, land.y);
    await expect.poll(async () => (await selection(page))?.kind).toMatch(/province|city/);
    await expect(page.locator('aside.inspector')).toBeVisible();
    const after = await anyBoxOf(page, before.id);
    expect(after, `formation still on screen (was ${JSON.stringify(before)})`).not.toBeNull();
    expect(Math.abs(after!.ax - before.ax)).toBeLessThan(1.5);
    expect(Math.abs(after!.ay - before.ay)).toBeLessThan(1.5);
    // …so clicking where the formation was drawn still selects it
    await page.mouse.click(before.ax, before.ay);
    await expect.poll(() => selection(page)).toEqual({ kind: 'stack', id: before.id.slice(2) });
  });

  test('patrol and rebase are issued purely by map clicks: crosshair, hover preview, click sets target, Confirm issues, Esc / right-click cancel', async ({ page }) => {
    test.setTimeout(300_000);
    await clearStorage(page);
    await newCampaign(page, 'IDN', 8080, '/?e2e=1');
    const air = await frame<{ id: string; home: number } | null>(page, 'f => { const s = f.view.stacks.find(s => s.air && s.air.state === "landed" && "node" in s.air.home); return s ? { id: s.id, home: s.air.home.node } : null; }');
    expect(air).not.toBeNull();
    await selectFormation(page, air!.id);
    await expect(page.getByTestId('aircraft-panel')).toBeVisible();

    // Esc cancels targeting without ordering anything
    await page.getByTestId('action-patrol').click();
    const bar = page.getByRole('dialog', { name: /^Patrol with / });
    await expect(bar).toBeVisible();
    expect(await wc<string>(page, 'wc.ui().mode.kind')).toBe('pick');
    // the list fallback exists but is collapsed when the order was started with the mouse
    await expect(page.getByTestId('target-list-toggle')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('patrol-node-select')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(bar).toHaveCount(0);
    expect(await wc<string>(page, 'wc.ui().mode.kind')).toBe('idle');
    expect(await frame<string>(page, `f => f.view.stacks.find(s => s.id === "${air!.id}").air.state`)).toBe('landed');

    // right-click cancels too
    await page.getByTestId('action-patrol').click();
    await expect(bar).toBeVisible();
    const box = (await page.locator('#map-canvas').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + 120, { button: 'right' });
    await expect(bar).toHaveCount(0);

    // started from the keyboard, the accessible list opens expanded and focused
    await page.getByTestId('action-patrol').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('target-list-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('patrol-node-select')).toBeVisible();
    await page.getByTestId('order-cancel').click();
    await expect(bar).toHaveCount(0);

    // a patrol area: one of the candidate sectors the list would offer (in range)
    await page.getByTestId('action-patrol').click();
    await expect(bar).toBeVisible();
    const cand = await page.getByTestId('patrol-node-select').locator('option').evaluateAll((os) => os.map((o) => Number((o as HTMLOptionElement).value)).filter((v) => !Number.isNaN(v) && v > 0));
    const target = cand.find((n) => n !== air!.home) ?? cand[0];
    const p = await focusNode(page, target);
    // hover: crosshair + live validator preview next to the pointer
    await page.mouse.move(p.x - 20, p.y - 10);
    await page.mouse.move(p.x, p.y, { steps: 3 });
    expect(await page.locator('#map-canvas').evaluate((c) => (c as HTMLCanvasElement).style.cursor)).toBe('crosshair');
    const tip = page.getByTestId('target-tip');
    await expect(tip).toBeVisible();
    await expect(tip).toHaveAttribute('data-state', 'ok', { timeout: 15_000 });
    await expect(tip).toContainText('Time on station');
    await expect(page.getByTestId('patrol-confirm')).toHaveAttribute('aria-disabled', 'true');
    // one click sets the target; the bar shows the full preview; Confirm issues the order
    await page.mouse.click(p.x, p.y);
    await expect(page.getByTestId('order-target')).toContainText('Target:');
    await expect(page.getByTestId('patrol-preview')).toContainText('Time on station', { timeout: 15_000 });
    await expect(page.getByTestId('patrol-confirm')).not.toHaveAttribute('aria-disabled', 'true');
    await page.getByTestId('patrol-confirm').click();
    await expect(bar).toHaveCount(0);
    await expect.poll(() => frame<string>(page, `f => f.view.stacks.find(s => s.id === "${air!.id}").air.state`)).not.toBe('landed');
    const patrol = await frame<{ node: number | null } | null>(page, `f => f.view.stacks.find(s => s.id === "${air!.id}").air.patrol`);
    expect(patrol?.node).toBe(target);

    // let the sortie end and refuel, then rebase by clicking another usable air base on the map
    for (let i = 0; i < 16; i++) {
      const st = await frame<string>(page, `f => (f.view.stacks.find(s => s.id === "${air!.id}") || { air: { state: 'gone' } }).air.state`);
      if (st === 'landed') break;
      await wc(page, 'wc.host().step(60)');
    }
    const bases = await wc<{ base: { node?: number; stack?: string }; ok: boolean; name: string }[]>(page, `wc.host().query('airInfo', ${JSON.stringify(air!.id)}).then(i => i.bases)`);
    const dest = bases.find((b) => b.ok && b.base.node !== undefined && b.base.node !== air!.home);
    expect(dest, 'another usable air base').toBeTruthy();
    await expect(page.getByTestId('action-rebase')).toBeVisible();
    await page.getByTestId('action-rebase').click();
    const rb = page.getByRole('dialog', { name: /^Rebase / });
    await expect(rb).toBeVisible();
    // hovering a sector without a base explains why it is not a target
    const bad = bases.some((b) => b.base.node === air!.home) ? null : air!.home;
    if (bad !== null) {
      const q = await focusNode(page, bad);
      await page.mouse.move(q.x, q.y, { steps: 2 });
      await expect(page.getByTestId('target-tip')).toHaveAttribute('data-state', 'bad');
    }
    const r = await focusNode(page, dest!.base.node!);
    await page.mouse.move(r.x - 15, r.y);
    await page.mouse.move(r.x, r.y, { steps: 3 });
    await expect(page.getByTestId('target-tip')).toHaveAttribute('data-state', 'ok', { timeout: 15_000 });
    await expect(page.getByTestId('target-tip')).toContainText(dest!.name);
    await expect(page.getByTestId('target-tip')).toContainText('lands');
    await page.mouse.click(r.x, r.y);
    await expect(page.getByTestId('order-target')).toContainText(dest!.name);
    await expect(page.getByTestId('rebase')).toContainText('Landing', { timeout: 15_000 });
    await page.getByTestId('rebase-confirm').click();
    await expect(rb).toHaveCount(0);
    await expect.poll(() => frame<string>(page, `f => f.view.stacks.find(s => s.id === "${air!.id}").air.state`)).toBe('rebasing');
    expect(await frame<number | null>(page, `f => { const d = f.view.stacks.find(s => s.id === "${air!.id}").air.dest; return d && 'node' in d ? d.node : null; }`)).toBe(dest!.base.node);
  });

  test('move is issued purely by map clicks: hover ETA preview, click sets destination, Confirm issues, Esc cancels', async ({ page }) => {
    test.setTimeout(240_000);
    await clearStorage(page);
    await newCampaign(page, 'IDN', 12345, '/?e2e=1');
    const g = await frame<{ id: string; node: number }>(page, 'f => { const s = f.view.stacks.find(s => s.moveClass === "ground" && s.pos.kind === "node" && !s.order && f.view.owners[s.pos.node] === f.view.viewer); return { id: s.id, node: s.pos.node }; }');
    await selectFormation(page, g.id);
    // Esc cancels the destination-picking state
    await page.getByTestId('action-move').click();
    await expect(page.getByTestId('move-panel')).toBeVisible();
    await expect(page.getByTestId('target-list-toggle')).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('move-panel')).toHaveCount(0);
    expect(await frame<boolean>(page, `f => !!f.view.stacks.find(s => s.id === "${g.id}").order`)).toBe(false);

    // destination: the nearest other own land province from the accessible list's candidates
    await page.getByTestId('action-move').click();
    await expect(page.getByTestId('move-panel')).toBeVisible();
    const vals = await page.getByTestId('dest-select').locator('option').evaluateAll((os) => os.map((o) => Number((o as HTMLOptionElement).value)).filter((v) => !Number.isNaN(v) && v > 0));
    const dest = await frame<number>(page, `f => { const vals = ${JSON.stringify(vals)}; return vals.find(v => v !== ${g.node} && f.view.owners[v] === f.view.viewer); }`);
    const p = await focusNode(page, dest, 26);
    await page.mouse.move(p.x - 12, p.y - 6);
    await page.mouse.move(p.x, p.y, { steps: 3 });
    const tip = page.getByTestId('target-tip');
    await expect(tip).toHaveAttribute('data-state', /ok|warn/, { timeout: 20_000 });
    await expect(tip).toContainText('Arrives');
    await expect(tip).toContainText('km');
    await page.mouse.click(p.x, p.y);
    await expect.poll(() => wc<number | null>(page, `(() => { const m = wc.ui().mode; return m.kind === 'move' ? m.dest : null; })()`)).toBe(dest);
    await expect(page.getByTestId('move-eta')).toBeVisible({ timeout: 20_000 });
    if (await page.getByTestId('war-warning').isVisible().catch(() => false)) await page.getByTestId('confirm-war').check();
    await page.getByTestId('confirm-move').click();
    await expect(page.getByTestId('move-panel')).toHaveCount(0);
    await expect.poll(() => frame<number | null>(page, `f => { const s = f.view.stacks.find(s => s.id === "${g.id}"); return s.order && s.order.kind === 'move' ? s.order.dest : null; }`)).toBe(dest);
    await expect(page.getByTestId('active-order')).toContainText('Moving to');
  });
});
