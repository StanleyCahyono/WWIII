import { describe, expect, it } from 'vitest';
import { advance, getCountryView } from '../../src/engine';
import { newMiniGame } from '../fixtures/mini-world';
import { reconciled, setStock, war, place, refreshVision } from '../fixtures/helpers';
import { UtilityController, getDecisionLog } from '../../src/ai';
import { decideOnce, memoryOf, realWorld, newReal, recording } from './helpers';

describe('AI economy and procurement', () => {
  it('spending depletes the visible ledger under the same rules (stock reconciles)', () => {
    const s = newMiniGame({ human: null, seed: 6 });
    const before = s.countries.BOR.stock.money;
    const { cmds } = decideOnce(s, 'BOR', ['strategic', 'economic']);
    expect(cmds.some((c) => c.type === 'startResearch' || c.type === 'build' || c.type === 'mobilize')).toBe(true);
    expect(s.countries.BOR.stock.money).toBeLessThan(before);
    expect(reconciled(s, 'BOR')).toBe(true);
    expect(Object.values(s.countries.BOR.stats.rejected).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('seeded example: a bot cancels a proposed missile procurement when its trade position deteriorates', () => {
    const s = newMiniGame({ human: 'CEL', seed: 77 });
    // Ardenia has a qualified cruise program and a launch complex, and is at war with Borvia
    s.countries.ARD.missiles.cruise_x = { maturity: 'qualified', ready: 0, expended: 0, produced: 0, launched: 0 };
    s.cities['ARD-ardena'].buildings.push({ type: 'missile_complex', level: 1, condition: 100 });
    setStock(s, 'ARD', { money: 30000, components: 4000, electronics: 1500 });
    war(s, 'ARD', 'BOR');
    // review 1: the procurement is proposed (valued in campaign points against ground units)
    decideOnce(s, 'ARD', ['strategic', 'economic']);
    const p1 = memoryOf(s, 'ARD').procurement;
    expect(p1?.status).toBe('proposed');
    expect(p1!.value).toBeGreaterThan(p1!.altValue);
    const idx0 = p1!.tradeIndex;
    // trade position deteriorates: Ardenia's electronics stock collapses before the order is confirmed
    setStock(s, 'ARD', { electronics: 5 });
    s.clock.tick += 60;
    const r2 = decideOnce(s, 'ARD', ['economic']);
    const p2 = memoryOf(s, 'ARD').procurement;
    expect(p2?.status).toBe('cancelled');
    expect(p2?.reason).toMatch(/trade position deteriorated/);
    expect(r2.cmds.some((c) => c.type === 'produceMissile')).toBe(false);
    const entry = getDecisionLog('ARD').find((e) => e.kind === 'procurement_cancelled');
    expect(entry?.reason).toContain(String(idx0));
    expect(s.countries.ARD.jobs.some((j) => j.kind === 'missile')).toBe(false);
  });

  it('without deterioration the same proposal is confirmed and ordered after its review window', () => {
    const s = newMiniGame({ human: 'CEL', seed: 77 });
    s.countries.ARD.missiles.cruise_x = { maturity: 'qualified', ready: 0, expended: 0, produced: 0, launched: 0 };
    s.cities['ARD-ardena'].buildings.push({ type: 'missile_complex', level: 1, condition: 100 });
    setStock(s, 'ARD', { money: 30000, components: 4000, electronics: 1500 });
    war(s, 'ARD', 'BOR');
    decideOnce(s, 'ARD', ['strategic', 'economic']);
    s.clock.tick += 6 * 60;
    const r = decideOnce(s, 'ARD', ['economic']);
    expect(r.cmds.some((c) => c.type === 'produceMissile')).toBe(true);
    expect(memoryOf(s, 'ARD').procurement?.status).toBe('ordered');
  });

  it('landlocked bot never issues naval orders or builds naval capacity', () => {
    const s = newMiniGame({ human: 'ARD', seed: 31 });
    setStock(s, 'DUN', { money: 50000, components: 8000, supplies: 8000 });
    const { ctl, log } = recording();
    for (let d = 0; d < 15 && !s.score.result; d++) advance(s, 1440, { fallback: ctl });
    const dun = log.filter((x) => x.country === 'DUN');
    expect(dun.length).toBeGreaterThan(10);
    const naval = new Set(['frigate', 'sub', 'carrier']);
    for (const { cmd } of dun) {
      expect(['embark', 'disembark', 'ferry']).not.toContain(cmd.type);
      if (cmd.type === 'mobilize') expect(naval.has(cmd.unit)).toBe(false);
      if (cmd.type === 'build') expect(cmd.building).not.toBe('naval_base');
    }
    expect(Object.values(s.stacks).some((x) => x.owner === 'DUN' && x.moveClass === 'naval')).toBe(false);
    expect(memoryOf(s, 'DUN').geography).toBe('landlocked');
  });

  it('archipelago start (real World 120: Indonesia) funds sea mobility', async () => {
    const sc = await realWorld();
    if (!sc) return;
    const s = newReal(sc, 3, 'USA');
    advance(s, 4 * 1440); // idle world: day 5, sea-mobility nodes become available
    const out = [];
    for (let i = 0; i < 4; i++) {
      out.push(...decideOnce(s, 'IDN', ['strategic', 'economic']).cmds);
      s.clock.tick += 6 * 60; // successive economic reviews (state otherwise unchanged)
    }
    expect(memoryOf(s, 'IDN').geography).toBe('maritime');
    const sea = out.filter((c) => (c.type === 'startResearch' && /^(mob_sea|nav_|mob_)/.test(c.tech)) || (c.type === 'build' && /naval|pontoon|logistics/.test(c.building)) || (c.type === 'mobilize' && /^nav_|^sub_/.test(c.unit)));
    expect(sea.length).toBeGreaterThan(0);
    // and a landlocked real start (Mongolia) never does
    const mng = decideOnce(s, 'MNG', ['strategic', 'economic']).cmds;
    expect(mng.some((c) => (c.type === 'mobilize' && /^nav_|^sub_/.test(c.unit)) || (c.type === 'startResearch' && /^nav_|sealift/.test(c.tech)))).toBe(false);
  });

  it('electronics shortage → electronics plant, trade, or delaying expensive electronics programs', async () => {
    const sc = await realWorld();
    if (!sc) return;
    const s = newReal(sc, 4, null);
    advance(s, 2 * 1440);
    const c = 'TUR';
    setStock(s, c, { electronics: 3, money: 40000 });
    refreshVision(s);
    const v0 = getCountryView(s, c);
    void v0;
    const { cmds } = decideOnce(s, c, ['strategic', 'economic']);
    expect(memoryOf(s, c).plan.shortages).toContain('electronics');
    const plant = cmds.some((x) => x.type === 'build' && sc.catalog.buildings.find((b) => b.id === x.building)?.levels.some((l) => (l.effects.produces?.electronics ?? 0) > 0));
    const trade = cmds.some((x) => (x.type === 'marketOrder' && x.side === 'buy' && x.resource === 'electronics') || (x.type === 'proposeOffer' && x.receive.some((t) => t.kind === 'resource' && t.resource === 'electronics')));
    expect(plant || trade).toBe(true);
    // expensive electronics-heavy research is delayed
    for (const x of cmds) if (x.type === 'startResearch') expect((sc.catalog.techs.find((t) => t.id === x.tech)?.cost.electronics ?? 0) * 1000).toBeLessThanOrEqual(3000 * 0.3 + 1);
  });

  it('information gathering: buys a report on an uncertain objective, then updates its plan when findings arrive', () => {
    const s = newMiniGame({ human: 'CEL', seed: 15 });
    setStock(s, 'ARD', { money: 40000 });
    decideOnce(s, 'ARD', ['strategic'], { submit: false });
    const obj = memoryOf(s, 'ARD').objective!;
    expect(obj.target).toBeTruthy();
    war(s, 'ARD', obj.target!);
    place(s, obj.target!, obj.node!, ['inf', 'inf', 'tank', 'tank', 'sam'], 'Objective Reserve');
    refreshVision(s);
    const r1 = decideOnce(s, 'ARD', ['operational']);
    const buy = r1.cmds.find((c) => c.type === 'buyIntelReport');
    expect(buy).toBeTruthy();
    expect(getDecisionLog('ARD').some((e) => e.kind === 'intel_purchase')).toBe(true);
    s.clock.tick += 15;
    decideOnce(s, 'ARD', ['operational']);
    const upd = getDecisionLog('ARD').filter((e) => e.kind === 'plan_update');
    expect(upd.length).toBeGreaterThan(0);
    expect(upd[upd.length - 1].reason).toMatch(/intel report/);
    expect(memoryOf(s, 'ARD').intel.some((i) => i.reportSeen)).toBe(true);
  });
});
