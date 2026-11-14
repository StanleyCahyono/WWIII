import { describe, expect, it } from 'vitest';
import { advance, BasicController, submitCommand, ledgerModel, resourceSummary, shortageBreakdown } from '../../src/engine';
import { newMiniGame, N } from '../fixtures/mini-world';
import { reconciled, setStock, must, war, place, clearStacks } from '../fixtures/helpers';
import { applyTerritoryFactor, cityAdjustedOutput, cityOutput } from '../../src/engine/systems/economy';
import { vecFromWhole, zero } from '../../src/engine/fixed';
import { RESOURCES } from '../../src/engine/data-types';

describe('economy & ledger', () => {
  it('ledger deltas reconcile to stockpile changes for every country after AI activity', () => {
    const s = newMiniGame({ seed: 21, human: null });
    advance(s, 3 * 1440, { fallback: BasicController });
    for (const c of s.countryOrder) expect(reconciled(s, c)).toBe(true);
    const lm = ledgerModel(s, 'ARD');
    expect(lm.reconciled).toBe(true);
    expect(lm.totals.production?.money ?? 0).toBeGreaterThan(0);
    expect(lm.totals.upkeep?.money ?? 0).toBeLessThan(0);
  });

  it('daily production is credited exactly (cumulative slicing) regardless of chunking', () => {
    const s = newMiniGame({ seed: 1 });
    // start mid-day; run to the next day change and then one full day
    advance(s, 1080); // to 00:00 day 2
    const before = s.countries.DUN.ledger.totals.production?.money ?? 0;
    // rates are constant during day 2 (morale updated at 00:00 before any hour is credited)
    const expected = Object.values(s.cities).filter((c) => s.provinces[c.node]?.owner === 'DUN').reduce((a, c) => a + cityOutput(s, c).money, 0);
    for (let i = 0; i < 1439; i++) advance(s, 1);
    // last hour slice is credited at 00:00 before the day-change morale update
    advance(s, 1);
    const after = s.countries.DUN.ledger.totals.production?.money ?? 0;
    const city = s.cities['DUN-dunholm'];
    // money comes from cities only (rural provinces have no money output)
    expect(after - before).toBe(expected);
    expect(city).toBeTruthy();
  });

  it('territory factor applied exactly once: 800/day → homeland 800, annexed 400, occupied 200', () => {
    const base = vecFromWhole({ supplies: 800 });
    expect(applyTerritoryFactor(base, 'homeland').supplies).toBe(800_000);
    expect(applyTerritoryFactor(base, 'annexed').supplies).toBe(400_000);
    expect(applyTerritoryFactor(base, 'occupied').supplies).toBe(200_000);
    // through the city pipeline
    const s = newMiniGame();
    const city = s.cities['BOR-canalport'];
    const adjusted = cityAdjustedOutput(s, city);
    const p = s.provinces[city.node]!;
    for (const [status, f] of [['homeland', 1], ['annexed', 0.5], ['occupied', 0.25]] as const) {
      p.status = status;
      const out = cityOutput(s, city);
      for (const r of RESOURCES) expect(out[r]).toBe(Math.trunc(adjusted[r] * f));
    }
  });

  it('unpaid upkeep is recorded as a shortage without negative stock; forecast & breakdown exposed', () => {
    const s = newMiniGame();
    setStock(s, 'CEL', { fuel: 0, money: 0 });
    advance(s, 180);
    const cs = s.countries.CEL;
    for (const r of RESOURCES) expect(cs.stock[r]).toBeGreaterThanOrEqual(0);
    expect(reconciled(s, 'CEL')).toBe(true);
    const sum = resourceSummary(s, 'CEL');
    const fuel = sum.find((x) => x.resource === 'fuel')!;
    expect(fuel.consumptionPerDay).toBeGreaterThan(0);
    expect(typeof fuel.forecast24h).toBe('number');
    expect(typeof fuel.forecast72h).toBe('number');
    const rows = shortageBreakdown(s, 'CEL', 'fuel');
    expect(rows.length).toBe(2);
    expect(rows.every((r) => typeof r.net === 'number')).toBe(true);
  });

  it('cross-check 2: two concurrent orders against funds for one → second rejected with exact shortfall; ledger reconciles', () => {
    const s = newMiniGame();
    setStock(s, 'ARD', { money: 450, components: 300 });
    const r1 = submitCommand(s, { type: 'build', country: 'ARD', building: 'factory', targets: ['ARD-ardena'] });
    expect(r1.ok).toBe(true);
    const r2 = submitCommand(s, { type: 'build', country: 'ARD', building: 'factory', targets: ['ARD-westport'] });
    expect(r2.ok).toBe(false);
    if (!r2.ok) {
      expect(r2.code).toBe('insufficient_resources');
      expect(r2.reason).toMatch(/short by 350 money/);
    }
    expect(s.countries.ARD.stock.money).toBe(50_000);
    expect(reconciled(s, 'ARD')).toBe(true);
  });

  it('job reservation rule: charged at enqueue, queued cancel refunds 100 %, active cancel refunds remaining × 0.75', () => {
    const s = newMiniGame();
    const m0 = s.countries.ARD.stock.money;
    const r = must(s, { type: 'build', country: 'ARD', building: 'factory', targets: ['ARD-ardena'] });
    const r2 = must(s, { type: 'build', country: 'ARD', building: 'bunker', targets: ['ARD-ardena'] });
    expect(s.countries.ARD.stock.money).toBe(m0 - 400_000 - 250_000);
    const jobs = s.countries.ARD.jobs;
    expect(jobs[0].startedAt).toBe(0); // factory active
    expect(jobs[1].startedAt).toBeNull(); // bunker queued (one construction at a time)
    const qid = (r2.result as { jobs: string[] }).jobs[0];
    const prev = submitCommand(s, { type: 'cancelJob', country: 'ARD', job: qid });
    expect(prev.ok).toBe(true);
    expect(s.countries.ARD.stock.money).toBe(m0 - 400_000);
    advance(s, 6 * 60); // 6h of 24h
    const aid = (r.result as { jobs: string[] }).jobs[0];
    const before = s.countries.ARD.stock.money;
    must(s, { type: 'cancelJob', country: 'ARD', job: aid });
    const delta = s.countries.ARD.stock.money - before;
    expect(delta).toBe(Math.trunc(400_000 * 0.75 * 0.75));
    expect(reconciled(s, 'ARD')).toBe(true);
  });

  it('occupation upkeep is visible in the ledger after a capture', () => {
    const s = newMiniGame();
    clearStacks(s);
    war(s, 'ARD', 'DUN');
    place(s, 'ARD', N.dunLow, ['inf']);
    advance(s, 15);
    expect(s.provinces[N.dunLow]!.owner).toBe('ARD');
    advance(s, 120);
    expect((s.countries.ARD.ledger.totals.occupation?.money ?? 0)).toBeLessThan(0);
    expect(zero().money).toBe(0);
  });
});
