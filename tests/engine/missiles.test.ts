import { describe, expect, it } from 'vitest';
import { advance, submitCommand, previewCommand, serialize, deserialize, stateHash, resolveMissileOutcome, cloneState, getCountryView } from '../../src/engine';
import { createCampaign } from '../../src/engine/scenario/create';
import { miniScenario, N } from '../fixtures/mini-world';
import { clearStacks, place, setStock, must, reconciled } from '../fixtures/helpers';
import { grantTech } from '../../src/engine/systems/research';
import { MINI_MISSILES } from '../fixtures/mini-catalog';
import type { MissileOutcome } from '../../src/engine/data-types';
import type { GameState } from '../../src/engine/state';

function game(seed = 42): GameState {
  const s = createCampaign({ seed, humanCountry: 'ARD', scenario: miniScenario() });
  clearStacks(s);
  s.cities['ARD-ardena'].buildings.push({ type: 'missile_complex', level: 2, condition: 100 });
  setStock(s, 'ARD', { money: 100000, rare: 2000, electronics: 2000, components: 5000, fuel: 5000 });
  for (const t of ['str_cruise_blueprint', 'str_ballistic_blueprint', 'str_ballistic_qualified', 'hyp_advanced_materials', 'hyp_glide_blueprint', 'hyp_glide_qualified', 'hyp_cruise_blueprint', 'hyp_cruise_qualified']) grantTech(s, 'ARD', t, 'domestic');
  return s;
}
/** Test-only stock injection (bypasses production) for branch tests. */
function stock(s: GameState, m: string, n: number) {
  const inv = s.countries.ARD.missiles[m];
  inv.ready = n;
  inv.produced = n;
  inv.maturity = 'ready';
}
function seedFor(outcome: MissileOutcome, missile = 'cruise_x'): number {
  const mt = MINI_MISSILES.find((x) => x.id === missile)!;
  for (let seed = 1; seed < 5000; seed++) if (resolveMissileOutcome(seed, 'l1', mt, 0).outcome === outcome) return seed;
  throw new Error('no seed');
}
const launch = (target: number, missile = 'cruise_x', extra: Record<string, unknown> = {}) => ({ type: 'launchMissile' as const, country: 'ARD', missile, from: { node: N.ardCapital }, target, confirmActOfWar: ['BOR'], ...extra });

describe('missiles (W07)', () => {
  it('maturity sequence prototype → qualified → in_production → ready → expended via production only', () => {
    const s = createCampaign({ seed: 1, humanCountry: 'ARD', scenario: miniScenario() });
    s.cities['ARD-ardena'].buildings.push({ type: 'missile_complex', level: 1, condition: 100 });
    setStock(s, 'ARD', { money: 100000, rare: 2000, electronics: 2000, components: 5000, fuel: 5000 });
    must(s, { type: 'startResearch', country: 'ARD', tech: 'str_ballistic_blueprint' });
    advance(s, 25 * 60);
    expect(s.countries.ARD.missiles.ballistic_x.maturity).toBe('prototype');
    const p0 = previewCommand(s, { type: 'produceMissile', country: 'ARD', missile: 'ballistic_x' });
    expect(p0.ok).toBe(false);
    if (!p0.ok) expect(p0.reason).toMatch(/prototype/);
    must(s, { type: 'startResearch', country: 'ARD', tech: 'str_ballistic_qualified' });
    advance(s, 25 * 60);
    expect(s.countries.ARD.missiles.ballistic_x.maturity).toBe('qualified');
    expect(s.countries.ARD.missiles.ballistic_x.ready).toBe(0);
    must(s, { type: 'produceMissile', country: 'ARD', missile: 'ballistic_x' });
    expect(s.countries.ARD.missiles.ballistic_x.maturity).toBe('in_production');
    expect(s.countries.ARD.ledger.totals.missile_production?.money).toBe(-500_000);
    const over = previewCommand(s, { type: 'produceMissile', country: 'ARD', missile: 'ballistic_x', batches: 4 });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.reason).toMatch(/ceiling 8/);
    advance(s, 25 * 60);
    const inv = s.countries.ARD.missiles.ballistic_x;
    expect(inv.maturity).toBe('ready');
    expect(inv.ready).toBe(2);
    must(s, launch(N.borCapital, 'ballistic_x'));
    must(s, launch(N.borCapital, 'ballistic_x'));
    expect(inv.maturity).toBe('expended');
    expect(previewCommand(s, launch(N.borCapital, 'ballistic_x')).ok).toBe(false);
    expect(reconciled(s, 'ARD')).toBe(true);
  });

  it('insufficient stock, range, own target and act-of-war confirmation are validated on commit', () => {
    const s = game();
    let v = previewCommand(s, launch(N.borCapital));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe('insufficient_stock');
    stock(s, 'cruise_x', 2);
    v = previewCommand(s, { ...launch(N.borCapital), confirmActOfWar: undefined });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe('act_of_war');
    v = previewCommand(s, launch(N.ardWestport));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe('invalid_target');
    v = previewCommand(s, launch(N.eskIsle, 'cruise_x', { confirmActOfWar: true }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe('insufficient_range');
    v = previewCommand(s, launch(N.borCapital));
    expect(v.ok).toBe(true);
    if (v.ok) {
      const p = v.preview as { possibleOutcomes: string[]; headlineChance: number; arriveAt: number };
      expect(p.possibleOutcomes).toEqual(['arrived_effect', 'arrived_limited', 'intercepted', 'failed']);
      expect(p.headlineChance).toBeCloseTo(0.75);
      expect(p.arriveAt).toBeGreaterThan(0);
    }
  });

  it('double submit with the same nonce debits exactly one ready item', () => {
    const s = game();
    stock(s, 'cruise_x', 3);
    const r1 = submitCommand(s, { ...launch(N.borCapital), nonce: 'fire-1' });
    const r2 = submitCommand(s, { ...launch(N.borCapital), nonce: 'fire-1' });
    expect(r1.ok && r2.ok).toBe(true);
    expect(r2.ok && r2.duplicate).toBe(true);
    expect(s.countries.ARD.missiles.cruise_x.ready).toBe(2);
    expect(Object.keys(s.launches).length).toBe(1);
  });

  for (const outcome of ['arrived_effect', 'arrived_limited', 'intercepted', 'failed'] as MissileOutcome[]) {
    it(`deterministic branch: ${outcome} resolves exactly once with consistent effects and knowledge`, () => {
      const s = game(seedFor(outcome));
      stock(s, 'cruise_x', 1);
      const cond0 = s.cities['BOR-borgrad'].condition;
      const r = must(s, launch(N.borCapital));
      const id = (r.result as { launch: string }).launch;
      expect(s.countries.ARD.missiles.cruise_x.ready).toBe(0);
      expect(s.launches[id].knowledge.ARD).toBe('in_flight');
      advance(s, 24 * 60);
      const l = s.launches[id];
      expect(l.resolved).toBe(true);
      expect(l.outcome).toBe(outcome);
      // unobserved target sector → attacker sees only "effect unconfirmed"
      expect(l.knowledge.ARD).toBe('effect_unconfirmed');
      if (outcome === 'failed') expect(l.knowledge.BOR).toBeUndefined();
      else expect(l.knowledge.BOR).toBe(outcome);
      const cond = s.cities['BOR-borgrad'].condition;
      if (outcome === 'arrived_effect') expect(cond).toBe(cond0 - 15);
      else if (outcome === 'arrived_limited') expect(cond).toBe(Math.round(cond0 - 7.5));
      else expect(cond).toBe(cond0);
      expect(s.events.filter((e) => e.kind === 'missile_resolved').length).toBe(1);
      expect(s.countries.ARD.missiles.cruise_x.expended).toBe(1);
      // the attacker's view never contains the underlying outcome
      expect(JSON.stringify(getCountryView(s, 'ARD').launches)).not.toContain(outcome === 'failed' ? '"failed"' : `"${outcome}"`);
    });
  }

  it('observed target sector → attacker learns the real outcome', () => {
    const s = game(seedFor('arrived_effect'));
    stock(s, 'cruise_x', 1);
    place(s, 'ARD', 13, ['scout']);
    must(s, launch(14));
    advance(s, 600);
    const l = Object.values(s.launches)[0];
    expect(l.outcome).toBe('arrived_effect');
    expect(l.knowledge.ARD).toBe('arrived_effect');
  });

  it('every family can be launched; air defence raises interception through the separate defence draw', () => {
    const s = game(3);
    for (const m of ['cruise_x', 'ballistic_x', 'hgv_x', 'hcm_x']) stock(s, m, 1);
    place(s, 'BOR', N.borCapital, ['sam', 'sam', 'sam', 'sam']);
    for (const m of ['cruise_x', 'ballistic_x', 'hgv_x', 'hcm_x']) must(s, launch(N.borCapital, m));
    advance(s, 600);
    const ls = Object.values(s.launches);
    expect(ls.length).toBe(4);
    expect(ls.every((l) => l.resolved && l.defenseRating! > 0)).toBe(true);
    expect(new Set(ls.map((l) => l.missile)).size).toBe(4);
  });

  it('save during flight and reload resolves identically; accelerated clock gives the same result', () => {
    const s = game(77);
    stock(s, 'hgv_x', 2);
    must(s, launch(N.borCapital, 'hgv_x'));
    must(s, launch(14, 'hgv_x'));
    advance(s, 3);
    const save = serialize(s);
    const a = deserialize(save);
    const b = cloneState(s);
    advance(s, 120);
    advance(a, 120);
    for (let i = 0; i < 120; i++) advance(b, 1);
    expect(stateHash(a)).toBe(stateHash(s));
    expect(stateHash(b)).toBe(stateHash(s));
    expect(Object.values(s.launches).every((l) => l.resolved)).toBe(true);
  });

  for (const p of [0.7, 0.15, 0.95]) {
    it(`statistical: 10,000 synthetic launches at p=${p} within 3 binomial standard errors`, () => {
      const mt = { outcomes: { arrived_effect: p, arrived_limited: 0, intercepted: 0, failed: 1 - p }, interceptBase: 0 };
      let hits = 0;
      const n = 10000;
      for (let i = 0; i < n; i++) if (resolveMissileOutcome(12345, `syn${i}`, mt, 0).outcome === 'arrived_effect') hits++;
      const se = Math.sqrt((p * (1 - p)) / n);
      expect(Math.abs(hits / n - p)).toBeLessThanOrEqual(3 * se);
    });
  }

  it('statistical: defence draw converts arrivals with p = interceptBase × rating (speed class gives no bonus)', () => {
    const fast = { outcomes: { arrived_effect: 1, arrived_limited: 0, intercepted: 0, failed: 0 }, interceptBase: 0.5 };
    let ic = 0;
    const n = 10000;
    for (let i = 0; i < n; i++) if (resolveMissileOutcome(99, `d${i}`, fast, 0.6).outcome === 'intercepted') ic++;
    const p = 0.3;
    expect(Math.abs(ic / n - p)).toBeLessThanOrEqual(3 * Math.sqrt((p * (1 - p)) / n));
    for (const m of MINI_MISSILES) {
      const sum = Object.values(m.outcomes).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 10);
    }
  });
});
