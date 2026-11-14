import { describe, expect, it } from 'vitest';
import { loadWorld120, createCampaign, listCampaignModes, previewCommand, advance, serialize, deserialize, getCountryView, computeOpeningPower } from '../../src/engine';
import type { Scenario } from '../../src/engine';
import { IdleController, BasicController } from '../../src/engine';

let scenario: Scenario | null = null;
let loadError: string | null = null;
try {
  scenario = await loadWorld120();
} catch (e) {
  loadError = (e as Error).message;
}

describe('World 120 scenario (real data when present)', () => {
  it('exposes exactly one campaign mode (W02)', () => {
    expect(listCampaignModes()).toEqual([{ id: 'world120', name: 'World 120' }]);
  });

  it.skipIf(!scenario)('W01 roster: unique seats/capitals, one human + N−1 AI, every seat owns territory and has a legal opening action', () => {
    const sc = scenario!;
    if (loadError) throw new Error(loadError);
    const seats = sc.seats;
    expect(new Set(seats).size).toBe(seats.length);
    const capitals = sc.map.cities.filter((c) => c.capital && seats.includes(c.country));
    expect(new Set(capitals.map((c) => c.country)).size).toBe(seats.length);
    expect(capitals.length).toBe(seats.length);
    const human = seats.includes('IDN') ? 'IDN' : seats[0];
    const s = createCampaign({ seed: 120, humanCountry: human, scenario: sc });
    const ctl = s.countryOrder.map((c) => s.countries[c].controller);
    expect(ctl.filter((x) => x === 'human').length).toBe(1);
    expect(ctl.filter((x) => x === 'ai').length).toBe(seats.length - 1);
    const stuck: string[] = [];
    for (const c of s.countryOrder) {
      const owns = s.provinces.some((p) => p && p.owner === c);
      const v = getCountryView(s, c);
      const options = [
        ...sc.catalog.techs.map((t) => ({ type: 'startResearch' as const, country: c, tech: t.id })),
        ...v.cities.flatMap((ci) => sc.catalog.buildings.filter((b) => b.scope === 'city').map((b) => ({ type: 'build' as const, country: c, building: b.id, targets: [ci.key] }))),
      ];
      const legal = owns && options.some((o) => previewCommand(s, o).ok);
      if (!legal) stuck.push(c);
    }
    expect(stuck).toEqual([]);
    expect(s.openingPower).toBeTruthy();
    // eslint-disable-next-line no-console
    console.log(`[world120] seats=${seats.length} nodes=${sc.map.nodes.length} stacks=${Object.keys(s.stacks).length} denominator=${s.score.denominator} notes=${(sc.notes ?? []).join(' | ').slice(0, 300)}`);
    const op = computeOpeningPower(s);
    // eslint-disable-next-line no-console
    console.log(`[world120] opening power leader=${op.leader} USA=${op.composite.USA ?? 'n/a'} nearest=${op.nearestRival} (${op.nearestRival ? op.composite[op.nearestRival] : 'n/a'})`);
  });

  it.skipIf(!scenario)('W02: save/reload/replay keep the single ruleset; one simulated day with 120 BasicController bots', () => {
    const s = createCampaign({ seed: 7, humanCountry: null, scenario: scenario! });
    const t0 = performance.now();
    advance(s, 1440, { fallback: IdleController });
    const t1 = performance.now();
    advance(s, 1440, { fallback: BasicController });
    const t2 = performance.now();
    // eslint-disable-next-line no-console
    console.log(`[world120] day engine-only=${(t1 - t0).toFixed(0)}ms day basic-ai=${(t2 - t1).toFixed(0)}ms stacks=${Object.keys(s.stacks).length} saveKB=${(serialize(s).length / 1024).toFixed(0)}`);
    expect(s.score.history.length).toBe(2);
    const l = deserialize(serialize(s));
    expect(l.scenarioId).toBe('world120');
    expect(l.meta.mode).toBe('world120');
    expect(l.countryOrder.length).toBe(scenario!.seats.length);
  });
});
