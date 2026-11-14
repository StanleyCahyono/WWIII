import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { clearStorage, newCampaign, wc } from './helpers';

/**
 * Screenshot regression for the operations map (SPEC "Symbol gallery": a crowded European region
 * and an Indonesian/Philippine port at two zoom levels) and a gallery manifest diff.
 *
 * Baselines live in e2e/visual.spec.ts-snapshots/ (Chromium, Linux, 1440×900, DPR 1). Regenerate
 * deliberately after a reviewed renderer change: `npx playwright test e2e/visual.spec.ts --update-snapshots`.
 */

const SHOT = { maxDiffPixelRatio: 0.01, threshold: 0.2, animations: 'disabled' as const };

/** Centre the camera, wait for the base layer and two painted frames, then return the canvas. */
async function settle(page: Page, lon: number, lat: number, z: number) {
  await wc(page, `wc.map().center(${lon}, ${lat}, ${z})`);
  await page.evaluate(
    () =>
      new Promise<void>((res) => {
        let n = 0;
        const tick = () => (++n >= 6 ? res() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
  );
  await page.waitForTimeout(600);
  return page.locator('#map-canvas');
}

test.describe('visual regression (desktop)', () => {
  test.skip(({ isMobile }) => !!isMobile, 'baselines are desktop 1440×900');

  test('map screenshots: crowded Europe and the port of Surabaya at regional and local zoom', async ({ page }) => {
    test.setTimeout(240_000);
    await clearStorage(page);
    await newCampaign(page, 'IDN', 4040);
    await expect.poll(() => wc<boolean>(page, '!!wc.map()')).toBe(true);
    // the geometry layer is loaded before any shot
    await expect.poll(() => wc<number>(page, 'wc.map().baseRenderMs ?? 0'), { timeout: 60_000 }).toBeGreaterThan(0);
    // crowded region: the perf harness's deterministic synthetic stacks (all four affiliations)
    expect(await wc<number>(page, 'wc.perfInject(2000)')).toBe(2000);
    const mask = [page.locator('.toasts'), page.locator('.legend'), page.locator('.map-tools'), page.locator('.map-search')];
    let c = await settle(page, 15, 50, 14);
    await expect(c).toHaveScreenshot('europe-regional.png', { ...SHOT, mask });
    c = await settle(page, 9, 50.5, 40);
    await expect(c).toHaveScreenshot('europe-local.png', { ...SHOT, mask });
    // the port: remove synthetic objects so only real Indonesian forces, cities and coast remain
    await page.evaluate(() => {
      const w = window as unknown as { __wc: { perfInject: (n: number) => number } };
      w.__wc.perfInject(0);
    });
    c = await settle(page, 112.75, -7.25, 16);
    await expect(c).toHaveScreenshot('surabaya-regional.png', { ...SHOT, mask });
    c = await settle(page, 112.75, -7.25, 60);
    await expect(c).toHaveScreenshot('surabaya-local.png', { ...SHOT, mask });
  });

  test('symbol gallery: the regenerated manifest equals the reviewed docs/gallery/manifest.json', async () => {
    test.setTimeout(180_000);
    const root = process.cwd(); // Playwright runs from the repository root
    const committed = JSON.parse(readFileSync(resolve(root, 'docs/gallery/manifest.json'), 'utf8')) as { samples: { id: string; sidc: string; meaning: string; svgSha256: string }[]; renderer: { version: string } };
    const fresh = JSON.parse(execFileSync(process.execPath, [resolve(root, 'node_modules/tsx/dist/cli.mjs'), resolve(root, 'e2e/gallery-manifest.mts')], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' } } /* clean env: Playwright's loader variables must not leak into the generator */)) as typeof committed;
    expect(fresh.renderer).toEqual(committed.renderer);
    expect(fresh.samples.length).toBe(committed.samples.length);
    // every affiliation × main family is present
    for (const a of ['friend', 'hostile', 'neutral', 'unknown']) expect(committed.samples.some((s) => s.id.endsWith(`#${a}`))).toBe(true);
    for (const v of ['planned', 'damaged', 'stale', 'mono-unknown']) expect(committed.samples.some((s) => s.id.endsWith(`#${v}`))).toBe(true);
    // compare in order (the generator is deterministic; sample ids are not unique — `#mono-unknown`
    // is emitted by two gallery sections with different captions)
    const diffs = fresh.samples.filter((s, i) => {
      const c = committed.samples[i];
      return !c || c.id !== s.id || c.sidc !== s.sidc || c.meaning !== s.meaning || c.svgSha256 !== s.svgSha256;
    });
    expect(diffs.map((d) => d.id), 'symbols changed since the reviewed manifest — review docs/gallery and re-run `npm run gallery`').toEqual([]);
  });
});
