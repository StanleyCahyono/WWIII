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
