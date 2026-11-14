import { describe, expect, it } from 'vitest';
import { advance, getCountryView, BasicController, observedNodes, stackSensorRadii, distKm } from '../../src/engine';
import { newMiniGame } from '../fixtures/mini-world';
import { clearStacks, place, refreshVision, grant, war } from '../fixtures/helpers';
import { bumpEconomy } from '../../src/engine/systems/economy';
import { createCampaign } from '../../src/engine/scenario/create';
import { scaledScenario } from '../fixtures/scaled-world';
import { invalidateViewCache } from '../../src/engine/view/country-view';
import { S } from '../../src/engine/scenario/registry';
import { visionSources } from '../../src/engine/systems/world';
import type { GameState } from '../../src/engine/state';
import { streamRng } from '../../src/engine/rng';

function setup(): GameState {
  const s = newMiniGame({ human: 'ARD' });
  clearStacks(s);
  return s;
}

/** Every current (non-stale) contact standing on a node lies inside the viewer's observed nodes. */
function contactsInsideCoverage(s: GameState): number {
  let checked = 0;
  for (const c of s.countryOrder) {
    const v = getCountryView(s, c);
    const obs = new Set(v.observedNodes);
    for (const k of v.contacts) {
      if (k.level === 'stale' || k.node === null) continue;
      expect(obs.has(k.node), `${c} contact at node ${k.node} outside observedNodes`).toBe(true);
      checked++;
    }
  }
  return checked;
}

describe('sensor radii on own stacks (StackView.sightKm / radarKm)', () => {
  it('reports effective sight/radar of the best living member, incl. terrain and the radar modifier; 0 aboard', () => {
    const s = setup();
    const a = place(s, 'ARD', 13, ['inf', 'scout']);
    const b = place(s, 'ARD', 12, ['sam']);
    invalidateViewCache(s);
    const v = getCountryView(s, 'ARD');
    const va = v.stacks.find((x) => x.id === a.id)!;
    const vb = v.stacks.find((x) => x.id === b.id)!;
    const st = S(s);
    const terrSight = (node: number, unit: string) => st.cat.units.get(unit)!.terrain[st.map.terrain[node]]?.sight ?? 1;
    expect(va.sightKm).toBeCloseTo(Math.max(40 * terrSight(13, 'inf'), 240 * terrSight(13, 'scout')), 9);
    expect(va.radarKm).toBe(0);
    expect(vb.radarKm).toBe(220);
    expect(vb.sightKm).toBeCloseTo(40 * terrSight(12, 'sam'), 9);
    // the national radar modifier scales radar only
    s.countries.ARD.modifiers['radar_range_mult'] = 1.5;
    invalidateViewCache(s);
    const vb2 = getCountryView(s, 'ARD').stacks.find((x) => x.id === b.id)!;
    expect(vb2.radarKm).toBeCloseTo(330, 9);
    expect(vb2.sightKm).toBe(vb.sightKm);
    // a dead member does not sense
    a.units = a.units.map((u) => (u.type === 'scout' ? { ...u, hp: 0 } : u));
    expect(stackSensorRadii(s, a).sightKm).toBeCloseTo(40 * terrSight(13, 'inf'), 9);
    // aboard stacks do not sense
    a.aboard = b.id;
    expect(stackSensorRadii(s, a)).toEqual({ sightKm: 0, radarKm: 0 });
  });
});

describe('observedNodes', () => {
  it('covers own territory and the sensor discs of own stacks and cities — and nothing else', () => {
    const s = setup();
    for (const k of Object.keys(s.cities)) s.cities[k].buildings = s.cities[k].buildings.filter((b) => b.type !== 'radar');
    bumpEconomy(s);
    const scout = place(s, 'ARD', 13, ['scout']);
    invalidateViewCache(s);
    const obs = getCountryView(s, 'ARD').observedNodes;
    const set = new Set(obs);
    expect([...obs].sort((x, y) => x - y)).toEqual(obs);
    const st = S(s);
    const m = st.map;
    const r = stackSensorRadii(s, scout);
    const range = Math.max(r.sightKm, r.radarKm);
    for (let n = 0; n < m.lon.length; n++) {
      const own = s.provinces[n]?.owner === 'ARD';
      const nearScout = distKm(m.lon[13], m.lat[13], m.lon[n], m.lat[n]) <= range;
      let nearCity = false;
      for (const k of Object.keys(s.cities)) {
        const c = s.cities[k];
        if (s.provinces[c.node]?.owner !== 'ARD') continue;
        if (distKm(m.lon[c.node], m.lat[c.node], m.lon[n], m.lat[n]) <= 80) nearCity = true;
      }
      expect(set.has(n), `node ${n}`).toBe(own || nearScout || nearCity);
    }
  });

  it('never reveals hidden stacks: foreign stacks (visible or not) do not change it, and no foreign id appears', () => {
    const s = setup();
    place(s, 'ARD', 13, ['inf']);
    invalidateViewCache(s);
    const before = getCountryView(s, 'ARD').observedNodes;
    const hidden = place(s, 'BOR', 8, ['stealth', 'inf'], 'Hidden Reserve');
    place(s, 'DUN', 20, ['scout', 'sam']);
    refreshVision(s);
    invalidateViewCache(s);
    const v = getCountryView(s, 'ARD');
    expect(v.observedNodes).toEqual(before);
    expect(JSON.stringify(v.observedNodes)).not.toContain(hidden.id);
    // moving the hidden stack around does not change it either
    hidden.pos = { kind: 'node', node: 3 };
    invalidateViewCache(s);
    expect(getCountryView(s, 'ARD').observedNodes).toEqual(before);
  });

  it('includes the coverage of vision sources (shared_intel / coalition) exactly as contacts do', () => {
    const s = setup();
    place(s, 'BOR', 8, ['scout']);
    invalidateViewCache(s);
    const alone = new Set(observedNodes(s, 'ARD'));
    grant(s, 'BOR', 'ARD', 'shared_intel');
    invalidateViewCache(s);
    expect(visionSources(s, 'ARD')).toContain('BOR');
    const shared = new Set(observedNodes(s, 'ARD'));
    for (const n of alone) expect(shared.has(n)).toBe(true);
    for (const n of observedNodes(s, 'BOR')) expect(shared.has(n)).toBe(true);
  });

  it('matches the visibility model: every current contact on a node is inside the observer coverage (mini world, random ticks)', () => {
    const s = newMiniGame({ human: null, seed: 5 });
    war(s, 'ARD', 'BOR');
    war(s, 'DUN', 'FAL');
    // sensors and targets spread over the map (land nodes of the mini world)
    const land = S(s).map.playable;
    const r = streamRng(11, 'test', 'obs');
    for (const c of s.countryOrder) for (let i = 0; i < 3; i++) place(s, c, land[r.int(land.length)], i === 0 ? ['scout'] : ['inf', 'tank']);
    refreshVision(s);
    let checked = contactsInsideCoverage(s);
    for (let i = 0; i < 12; i++) {
      // land exactly on a refresh boundary so contacts and coverage describe the same tick
      advance(s, 30 * (1 + r.int(12)), { fallback: BasicController });
      checked += contactsInsideCoverage(s);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('matches the visibility model on the scaled 120-country world', () => {
    const s = createCampaign({ seed: 9, humanCountry: null, scenario: scaledScenario() });
    const order = s.countryOrder;
    for (let i = 0; i + 1 < order.length; i += 2) {
      war(s, order[i], order[i + 1]);
      // an intruder on the neighbour's soil (territory sight) and a scout next to it
      const host = s.provinces.find((p) => p && p.owner === order[i] && p.control === 'country');
      if (host) {
        place(s, order[i + 1], host.node, ['inf']);
        place(s, order[i + 1], host.node, ['scout']);
      }
    }
    refreshVision(s);
    let checked = contactsInsideCoverage(s);
    for (let k = 0; k < 2; k++) {
      advance(s, 4 * 60, { fallback: BasicController });
      checked += contactsInsideCoverage(s);
    }
    expect(checked).toBeGreaterThan(0);
  });
});
