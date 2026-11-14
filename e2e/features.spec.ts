import { test, expect, type Page } from '@playwright/test';
import { clearStorage, newCampaign, frame, advance, shot } from './helpers';

const wc = <T = unknown>(page: Page, expr: string) => page.evaluate(`(() => { const wc = window.__wc; return ${expr}; })()`) as Promise<T>;

async function pickFirst(page: Page, testid: string, index = 1) {
  const sel = page.getByTestId(testid);
  await expect(sel.locator('option').nth(index)).toBeAttached({ timeout: 15_000 });
  const v = await sel.locator('option').nth(index).getAttribute('value');
  await sel.selectOption(v!);
}

test.describe('engine features pass (desktop)', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop');

  test('helicopter air assault: previewed hop with range, fuel and observed-risk estimate, airborne, then lands', async ({ page }) => {
    test.setTimeout(240_000);
    await clearStorage(page);
    await newCampaign(page, 'IDN', 4242, '/?e2e=1');
    const r = await wc<{ stack: string; node: number }>(page, 'wc.host().request({ op: "debugFeature", what: "airlift" })');
    await page.getByTestId('rail-forces').click();
    await expect(page.getByTestId('panel-forces')).toBeVisible();
    await page.getByTestId(`airmobile-${r.stack}`).click();
    await expect(page.getByTestId('airmobile')).toBeVisible();
    // the closest other land sector (index 1 = first option after the placeholder)
    await pickFirst(page, 'airmobile-dest-select', 1);
    await expect(page.getByTestId('airmobile-preview')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('airmobile-risk')).toContainText('%');
    await expect(page.getByTestId('airmobile-preview')).toContainText('km range');
    await shot(page, 'features-01-airmobile');
    await page.getByTestId('airmobile-confirm').click();
    await expect.poll(() => frame<string>(page, `f => f.view.stacks.find(s => s.id === "${r.stack}").pos.kind`)).toBe('air');
    await expect(page.getByTestId('formations-table')).toContainText('Air-mobile hop to');
    const eta = await frame<number>(page, `f => f.view.stacks.find(s => s.id === "${r.stack}").eta`);
    const now = await frame<number>(page, 'f => f.view.tick');
    await advance(page, Math.ceil((eta - now + 15) / 15) * 15, 240);
    await expect.poll(() => frame<string>(page, `f => f.view.stacks.find(s => s.id === "${r.stack}").pos.kind`)).toBe('node');
    // landed: the helicopters refuel — the engine refuses another hop for now (shared validator)
    const again = await wc<{ ok: boolean; code: string }>(page, `wc.host().preview({ type: 'airmobile', stack: "${r.stack}", dest: ${r.node} })`);
    expect(again.ok).toBe(false);
  });

  test('blockade shows in the economy report and journal; peace offer with a territory clause through the diplomacy UI', async ({ page }) => {
    test.setTimeout(240_000);
    await clearStorage(page);
    await newCampaign(page, 'IDN', 5151, '/?e2e=1');
    const b = await wc<{ foe: string; city: string; cityName: string }>(page, 'wc.host().request({ op: "debugFeature", what: "blockade" })');
    await advance(page, 60, 60);
    await expect.poll(() => frame<string[]>(page, 'f => f.view.blockades.filter(x => x.role === "blockaded").map(x => x.city)')).toContain(b.city);
    await page.getByTestId('rail-economy').click();
    await expect(page.getByTestId('blockaded-ports')).toContainText(b.cityName);
    await expect(page.getByTestId('blockade-report')).toContainText('output ×0.7');
    // the victim's view never names the blockader
    const leaked = await frame<boolean>(page, `f => JSON.stringify(f.view.blockades).includes(${JSON.stringify(b.foe)})`);
    expect(leaked).toBe(false);
    const journal = await frame<string[]>(page, 'f => f.view.journal.filter(j => j.kind === "blockade_started").map(j => j.text)');
    expect(journal.join(' ')).toContain('blockaded by hostile warships');
    await shot(page, 'features-02-blockade');

    // peace settlement composer: the enemy cedes one of its provinces
    await page.getByTestId('rail-diplomacy').click();
    await expect(page.getByTestId('diplomacy-panel')).toBeVisible();
    await page.getByRole('button', { name: 'War', exact: true }).click();
    await page.getByTestId(`nation-${b.foe}`).click();
    await page.getByTestId('propose-offer').click();
    await page.getByTestId('term-give-peace-treaty').check();
    await expect(page.getByTestId('territory-clauses')).toBeVisible();
    await pickFirst(page, 'territory-node', 1);
    await page.getByTestId('territory-add').click();
    await expect(page.getByTestId('territory-clauses')).toContainText('cedes');
    await expect(page.getByTestId('send-offer')).toBeEnabled({ timeout: 15_000 });
    await page.getByTestId('send-offer').click();
    await expect.poll(() => frame<number>(page, 'f => f.view.offers.filter(o => o.territory && o.territory.receive.length === 1 && o.from === f.view.viewer).length')).toBe(1);
    await expect(page.getByTestId('country-detail')).toContainText('cession of');
    await shot(page, 'features-03-peace-terms');
  });
});
