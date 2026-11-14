/**
 * W03 / W04 / W08 checks on the ACTUAL World 120 opening save built by the engine from the
 * authored profiles (owner: profiles agent).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { RESOURCES, type CountryProfile } from '../../src/engine/data-types';
import { allRates, buildWorld120Scenario, createCampaign, loadWorld120, resourceSummary, validateCommand, type GameState } from '../../src/engine/index';
import { CATALOG, RESOURCE_DEFS } from '../../src/data/catalog/index';
import { MANIFEST } from '../../src/data/countries';
import { loadMapData } from '../../src/data/map-index';
import { PROFILES, PROFILE_SPECS, profileById } from '../../src/data/profiles/index';
import { buildProfile } from '../../src/data/profiles/build';
import { buildOpeningState, crossCheck, engineOpeningPower, summarize } from '../../scripts/opening-power-report';

let state: GameState;
beforeAll(() => {
  state = buildOpeningState();
});

const withUSA = (mut: (p: CountryProfile) => CountryProfile) => PROFILES.map((p) => (p.id === 'USA' ? mut(structuredClone(p)) : p));
const raw = (s: GameState) => engineOpeningPower(s).raw.USA;

describe('engine integration', () => {
  it('the engine scenario loader picks up all 120 authored profiles (none synthesized)', async () => {
    const sc = await loadWorld120();
    expect(sc.seats).toHaveLength(120);
    expect((sc.notes ?? []).join(' ')).not.toMatch(/synthesized/);
    for (const m of MANIFEST) expect(sc.profiles[m.id]?.template).toBe(profileById.get(m.id)!.template);
  });
  it('creates the opening save with every seat alive and every formation placed', () => {
    expect(state.countryOrder).toHaveLength(120);
    const expected = PROFILES.reduce((a, p) => a + p.forces.reduce((b, f) => b + f.count, 0), 0);
    const placed = Object.values(state.stacks).reduce((a, s) => a + s.units.length, 0);
    expect(placed).toBe(expected);
  });
});

describe('W03 opening power', () => {
  it('ranks all 120 seats from the actual save and puts the U.S. at 118 (band 115–121)', () => {
    const op = engineOpeningPower(state);
    expect(op.rank).toHaveLength(120);
    expect(op.rank[0]).toBe('USA');
    expect(op.composite.USA).toBeGreaterThanOrEqual(115);
    expect(op.composite.USA).toBeLessThanOrEqual(121);
    expect(Math.max(...op.rank.filter((c) => c !== 'USA').map((c) => op.composite[c]))).toBeCloseTo(100, 6);
  });
  it('the U.S. leads the nearest rival by 15–21 %', () => {
    const s = summarize(engineOpeningPower(state));
    expect(s.leadPct).toBeGreaterThanOrEqual(15);
    expect(s.leadPct).toBeLessThanOrEqual(21);
  });
  it('has a plausible ranking: the major powers fill the top ten and peers lead individual dimensions', () => {
    const op = engineOpeningPower(state);
    const top10 = op.rank.slice(0, 10);
    const majors = ['CHN', 'RUS', 'IND', 'JPN', 'FRA', 'GBR', 'DEU', 'KOR'];
    expect(majors.filter((c) => top10.includes(c)).length).toBeGreaterThanOrEqual(7);
    expect(op.rank[1]).toBe('CHN');
    // China leads industry; Russia leads ready formations among peers
    expect(op.raw.CHN.industrial).toBe(op.normalization.industrial);
    expect(op.raw.RUS.formations).toBe(op.normalization.formations);
    expect(op.raw.CHN.industrial).toBeGreaterThan(op.raw.USA.industrial);
  });
  it('the independent cross-check reproduces the engine result', () => {
    const op = engineOpeningPower(state);
    const ch = crossCheck(state, 'engine');
    for (const c of state.countryOrder) expect(ch.composite[c]).toBeCloseTo(op.composite[c], 1);
  });
  it('removing a funded capability in a test copy changes the relevant raw score', () => {
    const base = raw(state);
    const noCarriers = raw(buildOpeningState(withUSA((p) => ({ ...p, forces: p.forces.filter((f) => f.unit !== 'nav_carrier') }))));
    expect(noCarriers.formations).toBeLessThan(base.formations);
    const noLabs = raw(buildOpeningState(withUSA((p) => ({ ...p, cities: p.cities.map((c) => ({ ...c, buildings: c.buildings.filter((b) => b.type !== 'research_lab') })) }))));
    expect(noLabs.research).toBeLessThan(base.research);
    const noDepots = raw(buildOpeningState(withUSA((p) => ({ ...p, cities: p.cities.map((c) => ({ ...c, buildings: c.buildings.filter((b) => b.type !== 'maintenance_depot') })) }))));
    expect(noDepots.mobility).toBeLessThan(base.mobility);
    const noLift = raw(buildOpeningState(withUSA((p) => ({ ...p, lift: 0, techs: p.techs }))));
    expect(noLift.mobility).toBeLessThan(base.mobility);
  });
  it('does not weaken or strengthen the U.S. by controller or difficulty', () => {
    const sc = buildWorld120Scenario({ map: loadMapData(), catalog: CATALOG as never, manifest: MANIFEST, profiles: PROFILES });
    const human = createCampaign({ seed: 7, humanCountry: 'USA', scenario: sc, difficulty: 'hard' });
    const bot = createCampaign({ seed: 7, humanCountry: null, scenario: sc, difficulty: 'easy' });
    expect(human.openingPower!.composite.USA).toBe(bot.openingPower!.composite.USA);
    expect(human.openingPower!.composite.USA).toBe(engineOpeningPower(state).composite.USA);
  });
  it('a $1 change in the reference basket changes no country’s starting forces', () => {
    const before = JSON.stringify(PROFILE_SPECS.map((s) => buildProfile(s).profile.forces));
    const supplies = RESOURCE_DEFS.find((r) => r.id === 'supplies')!;
    const old = supplies.referencePrice;
    supplies.referencePrice = old + 1;
    try {
      expect(JSON.stringify(PROFILE_SPECS.map((s) => buildProfile(s).profile.forces))).toBe(before);
      const catalog = { ...CATALOG, resources: RESOURCE_DEFS.map((r) => ({ ...r })) };
      const st2 = buildOpeningState(PROFILES, 120, catalog as never);
      const roster = (s: GameState) => Object.values(s.stacks).map((x) => `${x.owner}|${x.name}|${x.units.map((u) => u.type).join(',')}|${JSON.stringify(x.pos)}`).sort();
      expect(roster(st2)).toEqual(roster(state));
    } finally {
      supplies.referencePrice = old;
    }
  });
});

describe('W04 technology package in the opening save', () => {
  it('the U.S. has carrier aviation, lift and refuelling, and charges their upkeep', () => {
    const us = state.countries.USA;
    for (const t of ['nav_carrier_aviation', 'mob_strategic_airlift_2', 'mob_refuel_support', 'rec_broad_area_recon', 'hyp_advanced_materials']) expect(us.techs[t]).toBeDefined();
    expect(us.lift).toBeGreaterThan(Math.max(...state.countryOrder.filter((c) => c !== 'USA').map((c) => state.countries[c].lift)));
    const carriers = Object.values(state.stacks).filter((s) => s.owner === 'USA' && s.units.some((u) => u.type === 'nav_carrier'));
    expect(carriers.length).toBeGreaterThanOrEqual(2);
    const r = allRates(state).USA;
    expect(r.upkeepUnits.fuel).toBeGreaterThan(0);
    expect(r.upkeepBuildings.components).toBeGreaterThan(0);
  });
  it('no country starts with hypersonic (or any) missile inventory', () => {
    for (const c of state.countryOrder) {
      for (const [id, inv] of Object.entries(state.countries[c].missiles)) {
        expect(inv.ready, `${c} ${id}`).toBe(0);
        expect(id === 'msl_hgv' || id === 'msl_hcm', `${c} has ${id}`).toBe(false);
      }
    }
  });
  it('shows one identifiable U.S. import pressure in the opening forecast', () => {
    const usa = profileById.get('USA')!;
    const rows = resourceSummary(state, 'USA');
    const negatives = rows.filter((r) => r.negativeNet).map((r) => r.resource);
    expect(negatives).toEqual(usa.tradeNeeds);
    expect(negatives).toHaveLength(1);
  });
});

describe('W08 country viability at the opening', () => {
  it('every seat has non-negative net flows except its declared trade needs, which its reserve covers for 30+ days', () => {
    const rates = allRates(state);
    for (const p of PROFILES) {
      const r = rates[p.id];
      for (const res of RESOURCES) {
        if (p.tradeNeeds.includes(res)) {
          expect(r.net[res], `${p.id} ${res} should be a visible deficit`).toBeLessThan(0);
          expect(state.countries[p.id].stock[res] / -r.net[res], `${p.id} ${res} reserve days`).toBeGreaterThanOrEqual(30);
        } else expect(r.net[res], `${p.id} ${res}`).toBeGreaterThanOrEqual(0);
      }
    }
  });
  it('every seat can issue a legal opening recruit order', () => {
    for (const p of PROFILES) {
      const ok = p.cities.some((c) => validateCommand(state, { type: 'mobilize', country: p.id, unit: 'inf_militia', cities: [c.city] }).ok);
      expect(ok, `${p.id} cannot recruit`).toBe(true);
    }
  });
});
