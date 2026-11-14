import { expect, type Page } from '@playwright/test';

export const SHOTS = process.env.WC_SHOTS ?? '';

export async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** Block every non-loopback request (offline play). Returns the list of blocked URLs. */
export async function blockNetwork(page: Page): Promise<string[]> {
  const blocked: string[] = [];
  await page.context().route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
    blocked.push(route.request().url());
    return route.abort();
  });
  return blocked;
}

export async function clearStorage(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    localStorage.clear();
    await new Promise<void>((res) => {
      const r = indexedDB.deleteDatabase('world-command');
      r.onsuccess = r.onerror = r.onblocked = () => res();
    });
  });
}

export async function newCampaign(page: Page, country = 'IDN', seed = 12345, url = '/') {
  await page.goto(url);
  await page.getByTestId('new-campaign').click();
  await expect(page.getByTestId('preview-capital')).toBeVisible({ timeout: 120_000 });
  if (country !== 'IDN') {
    await page.getByTestId('country-search').fill(country);
    await page.getByTestId(`country-${country}`).click();
  }
  await page.getByTestId('seed-input').fill(String(seed));
  await page.getByTestId('start-campaign').click();
  await expect(page.getByTestId('game')).toBeVisible({ timeout: 120_000 });
  await page.getByTestId('close-briefing').click();
}

export async function frame<T>(page: Page, fn: string): Promise<T> {
  return page.evaluate(`(() => { const f = window.__wc.frame(); return (${fn})(f); })()`) as Promise<T>;
}

export async function openPanel(page: Page, name: string, isMobile: boolean) {
  if (isMobile) {
    const direct = page.getByTestId(`mnav-${name}`);
    if (!(await direct.isVisible().catch(() => false))) {
      await page.getByRole('button', { name: 'More…' }).click();
    }
    await page.getByTestId(`mnav-${name}`).click();
  } else await page.getByTestId(`rail-${name}`).click();
  await expect(page.getByTestId(`panel-${name}`)).toBeVisible();
}

/** Evaluate an expression with `wc = window.__wc` in scope. */
export const wc = <T = unknown>(page: Page, expr: string) => page.evaluate(`(() => { const wc = window.__wc; return ${expr}; })()`) as Promise<T>;

/**
 * Advance the simulation through the sim host (the same `step` the ▸| button uses), in chunks,
 * and wait until the UI frame shows the new tick.
 */
export async function advance(page: Page, minutes: number, chunk = 720) {
  const t0 = await frame<number>(page, 'f => f.view.tick');
  let left = minutes;
  while (left > 0) {
    const m = Math.min(chunk, left);
    await page.evaluate(`window.__wc.host().step(${m})`);
    left -= m;
  }
  await expect.poll(() => frame<number>(page, 'f => f.view.tick'), { timeout: 60_000 }).toBe(t0 + minutes);
}

/** Advance in steps until `cond` (a frame predicate source) is true; returns minutes advanced. */
export async function advanceUntil(page: Page, cond: string, maxMinutes: number, step = 60) {
  let spent = 0;
  while (spent < maxMinutes) {
    if (await frame<boolean>(page, cond)) return spent;
    await advance(page, step);
    spent += step;
  }
  return (await frame<boolean>(page, cond)) ? spent : -1;
}

/** Select a friendly formation from the Forces list (works on desktop and the mobile nav). */
export async function selectFormation(page: Page, id: string, isMobile = false) {
  await openPanel(page, 'forces', isMobile);
  await page.getByTestId(`formation-${id}`).click();
  await expect(page.getByTestId('inspector-title')).toBeVisible();
}

/** Choose a move destination in the open move panel: the nearest listed province owned by `owner`. */
export async function pickOwnedDestination(page: Page, owner: string, exclude: number | null) {
  const sel = page.getByTestId('dest-select');
  await expect(sel.locator('option').nth(2)).toBeAttached();
  const values = await sel.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
  const pick = await frame<string | null>(page, `f => { const vals = ${JSON.stringify(values)}; return vals.find(v => Number(v) !== ${exclude ?? -1} && f.view.owners[Number(v)] === ${JSON.stringify(owner)}) ?? null; }`);
  expect(pick, `a listed destination owned by ${owner}`).not.toBeNull();
  await sel.selectOption(pick!);
  return Number(pick);
}
