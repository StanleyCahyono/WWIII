import { describe, expect, it } from 'vitest';
import { advance, BasicController, cloneState } from '../../src/engine';
import { newMiniGame } from '../fixtures/mini-world';
import { createCampaign } from '../../src/engine/scenario/create';
import { scaledScenario } from '../fixtures/scaled-world';
import { updateVisibility, computeDetections } from '../../src/engine/systems/visibility';
import { streamRng } from '../../src/engine/rng';
import type { GameState } from '../../src/engine/state';

function detsJson(m: ReturnType<typeof computeDetections>): string {
  const out: Record<string, unknown> = {};
  for (const [c, d] of m) out[c] = [...d.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([sid, x]) => [sid, x.level, [...x.units].sort(), x.domain, [...x.src].sort()]);
  return JSON.stringify(out);
}
function check(s: GameState) {
  // a clone has no cache → full recompute; compare with the warm incremental cache
  const full = cloneState(s);
  expect(detsJson(computeDetections(s))).toBe(detsJson(computeDetections(full, { full: true })));
  updateVisibility(s);
  updateVisibility(full);
  expect(JSON.stringify(s.contacts)).toBe(JSON.stringify(full.contacts));
}

describe('incremental visibility', () => {
  it('equals a full recompute on random ticks (mini world with wars, captures and movement)', () => {
    const s = newMiniGame({ human: null, seed: 31 });
    const r = streamRng(99, 'test', 'vis');
    for (let i = 0; i < 25 && !s.score.result; i++) {
      advance(s, 15 * (1 + r.int(40)), { fallback: BasicController });
      check(s);
    }
  });

  it('equals a full recompute on the scaled 120-country world', () => {
    const s = createCampaign({ seed: 4, humanCountry: null, scenario: scaledScenario() });
    const r = streamRng(7, 'test', 'vis2');
    for (let i = 0; i < 6; i++) {
      advance(s, 30 * (1 + r.int(16)), { fallback: BasicController });
      check(s);
    }
  });
});

describe('batch views', () => {
  it('getCountryViews equals per-country getCountryView', async () => {
    const { getCountryView, getCountryViews } = await import('../../src/engine');
    const s = newMiniGame({ human: 'ARD', seed: 2 });
    advance(s, 600, { fallback: BasicController });
    const batch = getCountryViews(s, s.countryOrder);
    for (const c of s.countryOrder) expect(JSON.stringify(batch.get(c))).toBe(JSON.stringify(getCountryView(s, c)));
  });
});
