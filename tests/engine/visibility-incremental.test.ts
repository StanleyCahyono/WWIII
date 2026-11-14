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
/** Canonical JSON (sorted object keys): key insertion order of the contact tables is not semantic
 * (the view sorts contacts, stateHash is canonical) and differs between incremental and full passes. */
function canon(x: unknown): string {
  return JSON.stringify(x, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v));
}
function check(s: GameState) {
  // a clone has no cache → full recompute; compare with the warm incremental cache
  const full = cloneState(s);
  expect(detsJson(computeDetections(s))).toBe(detsJson(computeDetections(full, { full: true })));
  updateVisibility(s);
  updateVisibility(full);
  expect(canon(s.contacts)).toBe(canon(full.contacts));
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

describe('incremental visibility under heavy war', () => {
  it('equals a full recompute with many movers, captures, radar modifier and city radar changes (scaled world)', async () => {
    const { submitCommand } = await import('../../src/engine');
    const { bumpEconomy } = await import('../../src/engine/systems/economy');
    const s = createCampaign({ seed: 12, humanCountry: null, scenario: scaledScenario() });
    const order = s.countryOrder;
    for (let i = 0; i + 1 < order.length; i += 2) submitCommand(s, { type: 'declareWar', country: order[i], target: order[i + 1] } as never);
    const r = streamRng(5, 'test', 'vis3');
    for (let i = 0; i < 8; i++) {
      advance(s, 15 * (1 + r.int(12)), { fallback: BasicController });
      if (i === 2) {
        // national radar modifier changes (research path) and a city radar build/damage (journal path)
        s.countries[order[3]].modifiers['radar_range_mult'] = 1.4;
        const k = Object.keys(s.cities).sort()[r.int(Object.keys(s.cities).length)];
        s.cities[k].buildings.push({ type: 'radar', level: 1, condition: 60 });
        bumpEconomy(s, s.cities[k].node);
      }
      check(s);
    }
  });
});

describe('incremental visibility: radar modifier change', () => {
  it('a national radar_range_mult change re-derives existing sensor groups (warm == cold)', async () => {
    const { place, clearStacks } = await import('../fixtures/helpers');
    const { S } = await import('../../src/engine/scenario/registry');
    const { distKm } = await import('../../src/engine/systems/mapindex');
    const s = newMiniGame({ human: null, seed: 3 });
    clearStacks(s);
    const m = S(s).map;
    let pair: [number, number] | null = null;
    for (const a of m.playable) for (const b of m.playable) {
      const d = distKm(m.lon[a], m.lat[a], m.lon[b], m.lat[b]);
      if (!pair && d > 230 && d < 300) pair = [a, b];
    }
    expect(pair).not.toBeNull();
    place(s, 'ARD', pair![0], ['sam']);
    const heli = place(s, 'BOR', pair![1], ['heli']);
    updateVisibility(s);
    const before = computeDetections(s).get('ARD')!;
    expect(before.has(heli.id)).toBe(false);
    s.countries.ARD.modifiers['radar_range_mult'] = 1.4;
    check(s);
    expect(computeDetections(s).get('ARD')!.get(heli.id)?.level).toBe('contact');
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
