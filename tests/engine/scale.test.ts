import { describe, expect, it } from 'vitest';
import { advance, createCampaign, BasicController, IdleController } from '../../src/engine';
import { scaledScenario } from '../fixtures/scaled-world';
import type { CountryController } from '../../src/engine/ai-host/types';

describe('scale: 120 countries, ~2,000 stacks', () => {
  it('benchmark: one simulated game day (engine only, then with BasicController for 119 AIs)', () => {
    const t0 = performance.now();
    const s = createCampaign({ seed: 1, humanCountry: 'C000', scenario: scaledScenario() });
    const tCreate = performance.now() - t0;
    const stacks = Object.keys(s.stacks).length;
    expect(s.countryOrder.length).toBe(120);
    expect(stacks).toBeGreaterThanOrEqual(1900);
    advance(s, 15, { fallback: IdleController }); // warm-up (JIT)
    const t1 = performance.now();
    advance(s, 1440 - 15, { fallback: IdleController });
    const engineDay = performance.now() - t1;
    const t2 = performance.now();
    advance(s, 1440, { fallback: BasicController });
    const aiDay = performance.now() - t2;
    // eslint-disable-next-line no-console
    console.log(`[bench] create=${tCreate.toFixed(0)}ms stacks=${stacks} engine-day=${engineDay.toFixed(0)}ms basic-ai-day=${aiDay.toFixed(0)}ms aiCalls=${s.ai.calls} saveKB=${(JSON.stringify(s).length / 1024).toFixed(0)}`);
    expect(engineDay).toBeLessThan(6000);
    expect(aiDay).toBeLessThan(20000);
  });

  it('AI starvation: all 119 bots get reviews within a day, including distant ones; budget is respected per step', () => {
    const s = createCampaign({ seed: 2, humanCountry: 'C000', scenario: scaledScenario() });
    const runs = new Map<string, number>();
    const spy: CountryController = { decide: (v) => { runs.set(v.viewer, (runs.get(v.viewer) ?? 0) + 1); return []; } };
    let maxPerStep = 0;
    for (let i = 0; i < 96; i++) {
      const before = s.ai.calls;
      advance(s, 15, { fallback: spy });
      maxPerStep = Math.max(maxPerStep, s.ai.calls - before);
    }
    expect(runs.has('C000')).toBe(false); // human seat never driven by AI
    expect(runs.size).toBe(119);
    const counts = [...runs.values()];
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(10); // operational every 2h at least, plus others
    expect(maxPerStep).toBeLessThanOrEqual(60);
    expect(runs.get('C119')).toBeGreaterThanOrEqual(10); // farthest corner from the human
  });
});
