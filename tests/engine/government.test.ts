import { describe, expect, it } from 'vitest';
import { advance, submitCommand, previewCommand, countryScores, cloneState } from '../../src/engine';
import { newMiniGame, N } from '../fixtures/mini-world';
import { clearStacks, place, war, must, reconciled } from '../fixtures/helpers';
import { cityOutput, cityAdjustedOutput } from '../../src/engine/systems/economy';
import { resolveUprising, revoltChecks, moraleTarget, revoltProbability } from '../../src/engine/systems/government';
import { govHooks } from '../../src/engine/systems/hooks';
import { RESOURCES } from '../../src/engine/data-types';

describe('capture, annexation & government', () => {
  it('A05: capture → cannot recruit → annex → recruit → lose: owner, rights, output, buildings, ledger and score stay consistent', () => {
    const s = newMiniGame({ human: 'ARD' });
    clearStacks(s);
    war(s, 'ARD', 'DUN');
    s.cities['DUN-lowmere'].buildings.push({ type: 'barracks', level: 1, condition: 100 });
    const inf = place(s, 'ARD', N.dunLow, ['inf', 'inf']);
    advance(s, 15);
    const p = s.provinces[N.dunLow]!;
    expect(p.owner).toBe('ARD');
    expect(p.status).toBe('occupied');
    expect(s.cities['DUN-lowmere'].buildings[0].condition).toBe(90); // capture damage
    const sc1 = countryScores(s);
    // occupied city: build OK, mobilize refused with reason
    const mob = previewCommand(s, { type: 'mobilize', country: 'ARD', unit: 'inf', cities: ['DUN-lowmere'] });
    expect(mob.ok).toBe(false);
    if (!mob.ok) expect(mob.reason).toMatch(/occupied — cannot mobilize/);
    expect(previewCommand(s, { type: 'build', country: 'ARD', building: 'hospital', targets: ['DUN-lowmere'] }).ok).toBe(true);
    // output at 25 %
    const city = s.cities['DUN-lowmere'];
    const adj = cityAdjustedOutput(s, city);
    expect(cityOutput(s, city).supplies).toBe(Math.trunc(adj.supplies * 0.25));
    // annex
    const an = submitCommand(s, { type: 'annex', country: 'ARD', city: 'DUN-lowmere' });
    expect(an.ok).toBe(true);
    advance(s, 24 * 60 + 15);
    expect(p.status).toBe('annexed');
    expect(cityOutput(s, city).supplies).toBe(Math.trunc(cityAdjustedOutput(s, city).supplies * 0.5));
    const mob2 = submitCommand(s, { type: 'mobilize', country: 'ARD', unit: 'inf', cities: ['DUN-lowmere'] });
    expect(mob2.ok).toBe(true);
    const refundBefore = s.countries.ARD.ledger.totals.refund?.money ?? 0;
    // lose it: DUN counter-attacks after ARD's garrison leaves
    delete s.stacks[inf.id];
    place(s, 'DUN', N.dunLow, ['inf']);
    advance(s, 15);
    expect(p.owner).toBe('DUN');
    expect(p.status).toBe('homeland');
    expect(s.countries.ARD.jobs.some((j) => j.city === 'DUN-lowmere')).toBe(false);
    expect((s.countries.ARD.ledger.totals.refund?.money ?? 0) - refundBefore).toBeGreaterThan(0); // refund of the cancelled mobilization
    expect(s.events.some((e) => e.kind === 'city_captured' && e.private.DUN?.text.includes('liberated'))).toBe(true);
    expect(s.events.some((e) => e.kind === 'job_cancelled' && e.private.ARD?.text.includes('location lost'))).toBe(true);
    const sc2 = countryScores(s);
    expect(sc2.DUN).toBe(sc1.DUN + (sc1.ARD - sc2.ARD));
    for (const c of s.countryOrder) expect(reconciled(s, c)).toBe(true);
  });

  it('morale target exposes signed factors; low morale has a published revolt probability', () => {
    const s = newMiniGame();
    const city = s.cities['ESK-isle'];
    const t = moraleTarget(s, s.provinces[city.node]!, city);
    expect(t.factors.find((f) => f.key === 'base')!.value).toBe(75);
    expect(t.factors.some((f) => f.key === 'distance')).toBe(true);
    expect(revoltProbability(50)).toBe(0);
    expect(revoltProbability(30)).toBeGreaterThan(0);
    expect(revoltProbability(10)).toBeGreaterThan(revoltProbability(30));
  });

  it('cross-check 8: undefended city → immediate rebel control; garrisoned city → fight; each resolved once', () => {
    const base = newMiniGame();
    clearStacks(base);
    base.cities['BOR-canalport'].morale = 10;
    const undefended = cloneState(base);
    const garrisoned = cloneState(base);
    expect(resolveUprising(undefended, 'BOR-canalport', govHooks)).toBe('rebels_took_control');
    const p = undefended.provinces[N.borCanal]!;
    expect(p.owner).toBeNull();
    expect(p.control).toBe('rebel');
    expect(undefended.countryOrder.length).toBe(6); // no new diplomatic seat
    expect(undefended.events.filter((e) => e.kind === 'uprising_success').length).toBe(1);
    // rebel nodes produce nothing and score for nobody
    expect(Object.values(countryScores(undefended)).reduce((a, b) => a + b, 0)).toBeLessThan(Object.values(countryScores(base)).reduce((a, b) => a + b, 0));
    place(garrisoned, 'BOR', N.borCanal, ['inf', 'inf', 'tank']);
    const out = resolveUprising(garrisoned, 'BOR-canalport', govHooks);
    expect(out).toBe('suppressed');
    expect(garrisoned.provinces[N.borCanal]!.owner).toBe('BOR');
    expect(garrisoned.events.filter((e) => e.kind === 'uprising_suppressed').length).toBe(1);
    const units = Object.values(garrisoned.stacks).filter((x) => x.owner === 'BOR')[0].units;
    expect(units.some((u) => u.hp < u.maxHp)).toBe(true);
    // rebels can be retaken by any country without a declaration of war
    place(undefended, 'ESK', N.borCanal, ['inf']);
    advance(undefended, 15);
    expect(undefended.provinces[N.borCanal]!.owner).toBe('ESK');
  });

  it('seeded revolt checks are deterministic per (city, day)', () => {
    const a = newMiniGame({ seed: 3 });
    clearStacks(a);
    for (const c of Object.values(a.cities)) c.morale = 5;
    const b = cloneState(a);
    a.clock.tick = b.clock.tick = 1080;
    revoltChecks(a, govHooks);
    revoltChecks(b, govHooks);
    expect(a.provinces.map((p) => p?.owner)).toEqual(b.provinces.map((p) => p?.owner));
    expect(a.events.filter((e) => e.kind === 'uprising_success').length).toBeGreaterThan(0);
  });

  it('population and morale update at day change', () => {
    const s = newMiniGame();
    const c = s.cities['ARD-ardena'];
    const pop0 = c.population;
    advance(s, 1080 + 15);
    expect(c.morale).toBe(80); // 75 base + 5 capital (step 5/day)
    expect(c.population).toBeGreaterThan(pop0);
    expect(c.moraleFactors.length).toBeGreaterThan(0);
    for (const r of RESOURCES) expect(Number.isFinite(cityOutput(s, c)[r])).toBe(true);
  });

  it('human eliminated with no territory and no recovery force: run concluded, observing allowed, still one human', () => {
    const s = newMiniGame({ human: 'DUN' });
    clearStacks(s);
    war(s, 'ARD', 'DUN');
    place(s, 'ARD', N.dunCapital, ['inf']);
    place(s, 'ARD', N.dunLow, ['inf']);
    place(s, 'ARD', 21, ['inf']);
    advance(s, 30);
    expect(s.countries.DUN.alive).toBe(false);
    expect(s.meta.humanRun).toBe('concluded');
    expect(s.countryOrder.filter((c) => s.countries[c].controller === 'human')).toEqual(['DUN']);
    expect(s.events.some((e) => e.kind === 'country_eliminated' && e.interrupt.includes('DUN'))).toBe(true);
    advance(s, 120); // observing continues
    expect(s.clock.tick).toBe(150);
    expect(must).toBeTruthy();
  });
});
