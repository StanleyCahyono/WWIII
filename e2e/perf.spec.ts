import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { clearStorage, newCampaign } from './helpers';

/**
 * Map performance probe (run explicitly: `npx playwright test e2e/perf.spec.ts --project=desktop`).
 * Real World 120 map + the human's real objects + N synthetic render-only stacks.
 * Reports p95 map-input response (event → next drawn frame) and pan fps. Results go to
 * $WC_PERF_OUT (JSON) when set; numbers are recorded in docs/UI.md with device/browser info.
 */
test.describe('perf', () => {
  test.skip(({ isMobile }) => !!isMobile && !process.env.WC_PERF_MOBILE, 'desktop by default');

  test('map input response and pan fps with ~2000 stacks', async ({ page, browserName, isMobile }) => {
    test.setTimeout(240_000);
    await clearStorage(page);
    await newCampaign(page, 'IDN', 555);
    const injected = await page.evaluate(() => (window as unknown as { __wc: { perfInject: (n: number) => number } }).__wc.perfInject(2000));
    expect(injected).toBe(2000);
    const res = await page.evaluate(async () => {
      const wc = (window as unknown as { __wc: { map: () => { canvas: HTMLCanvasElement; w: number; h: number; onFrame: ((ms: number) => void) | null; center: (a: number, b: number, z?: number) => void; panBy: (x: number, y: number) => void; baseRenderMs: number }; camera: () => unknown } }).__wc;
      const r = wc.map();
      const nextFrame = () =>
        new Promise<number>((res) => {
          const prev = r.onFrame;
          const timer = setTimeout(() => {
            r.onFrame = prev;
            res(-1);
          }, 1000);
          r.onFrame = (ms) => {
            clearTimeout(timer);
            prev?.(ms);
            r.onFrame = prev;
            res(ms);
          };
        });
      const pct = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
      const scenarios: Record<string, unknown> = {};
      for (const [name, lon, lat, z] of [
        ['regional-europe', 15, 50, 14],
        ['regional-se-asia', 112, -2, 16],
        ['local-java', 110, -7, 60],
        ['world', 20, 20, 4],
      ] as [string, number, number, number][]) {
        r.center(lon, lat, z);
        await nextFrame();
        await new Promise((x) => setTimeout(x, 300));
        // input response: wheel → drawn frame
        const rect = r.canvas.getBoundingClientRect();
        const lat2: number[] = [];
        const draw: number[] = [];
        for (let i = 0; i < 40; i++) {
          const t0 = performance.now();
          const p = nextFrame();
          r.canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: i % 2 ? -60 : 60, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, bubbles: true, cancelable: true }));
          draw.push(await p);
          lat2.push(performance.now() - t0);
        }
        // settle (base cache re-render after zoom)
        await new Promise((x) => setTimeout(x, 300));
        // pan fps: 3 s of continuous drag-equivalent panning
        const frames: number[] = [];
        const drawMs: number[] = [];
        const t0 = performance.now();
        let last = t0;
        await new Promise<void>((done) => {
          const step = () => {
            const now = performance.now();
            frames.push(now - last);
            last = now;
            r.panBy(6, 0);
            const prev = r.onFrame;
            r.onFrame = (ms) => {
              drawMs.push(ms);
              r.onFrame = prev;
            };
            if (now - t0 < 3000) requestAnimationFrame(step);
            else done();
          };
          requestAnimationFrame(step);
        });
        const secs = (performance.now() - t0) / 1000;
        scenarios[name] = {
          wheelToFrameP50: +pct(lat2, 0.5).toFixed(1),
          wheelToFrameP95: +pct(lat2, 0.95).toFixed(1),
          drawP95: +pct(draw, 0.95).toFixed(1),
          panFps: +(frames.length / secs).toFixed(1),
          panFrameP95: +pct(frames.slice(1), 0.95).toFixed(1),
          panDrawP95: +pct(drawMs, 0.95).toFixed(1),
          baseRenderMs: +r.baseRenderMs.toFixed(1),
        };
      }
      // click → inspector (selection) response
      r.center(106.85, -6.2, 30);
      await nextFrame();
      await new Promise((x) => setTimeout(x, 300));
      const clicks: number[] = [];
      const rect = r.canvas.getBoundingClientRect();
      const targets: [number, number][] = [[106.85, -6.2], [107.6, -6.9], [110.42, -6.97], [112.75, -7.25], [104.75, -2.98], [106.0, -6.0]];
      const proj = (window as unknown as { __wc: { project: (a: number, b: number) => { x: number; y: number } } }).__wc.project;
      for (let i = 0; i < 24; i++) {
        const [lo, la] = targets[i % targets.length];
        const pt = proj(lo, la);
        const x = pt.x, y = pt.y;
        void rect;
        const t0 = performance.now();
        const opts = { clientX: x, clientY: y, bubbles: true, pointerId: 1, button: 0, isPrimary: true, pointerType: 'mouse' } as PointerEventInit;
        r.canvas.dispatchEvent(new PointerEvent('pointerdown', opts));
        r.canvas.dispatchEvent(new PointerEvent('pointerup', opts));
        // selection → React inspector update → map redraw → next painted frame
        await new Promise((x2) => requestAnimationFrame(() => requestAnimationFrame(() => x2(null))));
        clicks.push(performance.now() - t0);
      }
      const selected = (window as unknown as { __wc: { ui: () => { selection: unknown } } }).__wc.ui().selection;
      void selected;
      return { scenarios, clickToFrameP95: +pct(clicks, 0.95).toFixed(1), clickToFrameP50: +pct(clicks, 0.5).toFixed(1), ua: navigator.userAgent, dpr: devicePixelRatio, viewport: [innerWidth, innerHeight], cores: navigator.hardwareConcurrency };
    });
    const out = { browser: browserName, isMobile, objects: 2000, ...res };
    console.log(JSON.stringify(out, null, 2));
    if (process.env.WC_PERF_OUT) writeFileSync(process.env.WC_PERF_OUT, JSON.stringify(out, null, 2));
    expect(res.clickToFrameP95).toBeGreaterThan(0);
  });
});
