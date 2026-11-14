import { describe, expect, it } from 'vitest';
import { advance, submitCommand, previewCommand, validateCommand, cloneState, stateHash, COMMAND_TYPES, getCountryView, newspaper, journal, inbox, cityList, researchTree, scoreBreakdown, provinceInspector, forceModel } from '../../src/engine';
import { newMiniGame, N } from '../fixtures/mini-world';
import { clearStacks, place, must, setStock, war, reconciled } from '../fixtures/helpers';
import type { Command } from '../../src/engine';
import type { CountryController } from '../../src/engine/ai-host/types';

describe('command path (one validator for human and AI)', () => {
  it('validation results are identical whether the issuer is human- or AI-controlled', () => {
    const a = newMiniGame({ human: 'ARD' });
    const b = cloneState(a);
    b.countries.ARD.controller = 'ai';
    const st = Object.values(a.stacks).find((x) => x.owner === 'ARD' && x.moveClass === 'ground')!;
    const cmds: Command[] = [
      { type: 'startResearch', country: 'ARD', tech: 'land_infantry_2' },
      { type: 'startResearch', country: 'ARD', tech: 'late_tech' },
      { type: 'mobilize', country: 'ARD', unit: 'frigate', cities: ['ARD-ardena', 'BOR-borgrad'] },
      { type: 'move', country: 'ARD', stack: st.id, dest: N.borCapital },
      { type: 'marketOrder', country: 'ARD', side: 'buy', resource: 'fuel', qty: 999999, price: 100000 },
      { type: 'declareWar', country: 'ARD', target: 'ARD' },
    ];
    for (const c of cmds) expect(JSON.stringify(validateCommand(b, c))).toBe(JSON.stringify(validateCommand(a, c)));
  });

  it('an AI controller goes through submitCommand: same effects, invalid commands rejected and counted', () => {
    const a = newMiniGame({ human: null, seed: 3 });
    const b = cloneState(a);
    const script: Command[] = [
      { type: 'startResearch', country: 'CEL', tech: 'off_staff' },
      { type: 'build', country: 'CEL', building: 'factory', targets: ['CEL-celesta'] },
      { type: 'build', country: 'CEL', building: 'naval_base', targets: ['ARD-ardena'] }, // not owner
      { type: 'startResearch', country: 'ARD', tech: 'off_staff' }, // foreign issuer
    ];
    let fired = false;
    const ctl: CountryController = { decide: (v) => { if (v.viewer !== 'CEL' || fired) return []; fired = true; return script; } };
    advance(a, 120, { controllers: { CEL: ctl } });
    // human-equivalent submission on the twin state at the same tick the AI acted
    const tick = a.countries.CEL.jobs[0].enqueuedAt;
    advance(b, tick);
    for (const c of script.slice(0, 3)) submitCommand(b, c);
    advance(b, 120 - tick);
    expect(b.countries.CEL.stock).toEqual(a.countries.CEL.stock);
    expect(b.countries.CEL.jobs.map((j) => j.building)).toEqual(a.countries.CEL.jobs.map((j) => j.building));
    expect(a.countries.CEL.stats.rejected.build).toBe(1);
    expect(a.countries.CEL.stats.rejected.foreign_issuer).toBe(1);
    expect(a.countries.ARD.research.length).toBe(0);
  });

  it('human-readable reasons with codes: invalid domain, unsuitable port, not owner, locked tech, occupied city, exact shortfall', () => {
    const s = newMiniGame({ human: 'ARD' });
    clearStacks(s);
    const f = place(s, 'ARD', N.ardWestport, ['frigate']);
    const inf = place(s, 'ARD', N.ardCapital, ['inf']);
    const air = place(s, 'ARD', N.ardCapital, ['fighter']);
    const r = (c: Command) => {
      const v = previewCommand(s, c);
      return v.ok ? 'ok' : `${v.code}: ${v.reason}`;
    };
    expect(r({ type: 'move', country: 'ARD', stack: air.id, dest: 13 })).toMatch(/^invalid_domain/);
    expect(r({ type: 'patrol', country: 'ARD', stack: inf.id, center: 13 })).toMatch(/^invalid_domain/);
    expect(r({ type: 'move', country: 'BOR', stack: inf.id, dest: 13 })).toMatch(/^not_owner/);
    expect(r({ type: 'mobilize', country: 'ARD', unit: 'carrier', cities: ['ARD-ardena'] })).toMatch(/locked_tech: .*Requires research: Carrier Aviation/);
    expect(r({ type: 'build', country: 'ARD', building: 'naval_base', targets: ['ARD-ardena', 'BOR-borgrad'] })).toBe('ok');
    const v = previewCommand(s, { type: 'build', country: 'ARD', building: 'naval_base', targets: ['ARD-ardena', 'BOR-borgrad'] });
    if (v.ok) {
      const rows = (v.preview as { rows: { ok: boolean; reason?: string }[] }).rows;
      expect(rows[0].ok).toBe(true);
      expect(rows[1].reason).toMatch(/do not control Borgrad/);
    }
    setStock(s, 'ARD', { money: 10 });
    expect(r({ type: 'startResearch', country: 'ARD', tech: 'land_infantry_2' })).toMatch(/insufficient_resources: Insufficient resources — short by 290 money/);
    expect(r({ type: 'embark', country: 'ARD', stack: f.id, sea: N.S_W })).toMatch(/^invalid_domain/);
    expect(r({ type: 'unknownThing', country: 'ARD' } as unknown as Command)).toMatch(/^unknown_command/);
    expect(COMMAND_TYPES.length).toBeGreaterThanOrEqual(40);
  });

  it('bulk build: per-city preview, exact charge, stale preview token recomputed', () => {
    const s = newMiniGame({ human: 'ARD' });
    setStock(s, 'ARD', { money: 1000, components: 1000 });
    const cmd: Command = { type: 'build', country: 'ARD', building: 'factory', targets: ['ARD-ardena', 'ARD-westport', 'BOR-borgrad'] };
    const v = previewCommand(s, cmd);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const p = v.preview as { rows: { ok: boolean; reason?: string; startTick?: number }[]; total: { money: number }; token: string; eligible: number };
    expect(p.rows.map((x) => x.ok)).toEqual([true, true, false]);
    expect(p.total.money).toBe(800_000);
    expect(p.rows[0].startTick).toBe(0);
    // treasury changes before confirmation → refused with a refreshed preview
    setStock(s, 'ARD', { money: 500, components: 1000 });
    const stale = submitCommand(s, { ...cmd, previewToken: p.token });
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.code).toBe('stale_preview');
      const fresh = stale.details as { rows: { ok: boolean; reason?: string }[]; token: string };
      expect(fresh.rows.map((x) => x.ok)).toEqual([true, false, false]);
      expect(fresh.rows[1].reason).toMatch(/short by 300 money/);
      const m0 = s.countries.ARD.stock.money;
      must(s, { ...cmd, previewToken: fresh.token });
      expect(m0 - s.countries.ARD.stock.money).toBe(400_000);
    }
    expect(reconciled(s, 'ARD')).toBe(true);
  });

  it('rally point applies to later mobilizations; completed project leaves a city-linked event', () => {
    const s = newMiniGame({ human: 'ARD' });
    clearStacks(s);
    must(s, { type: 'setRally', country: 'ARD', city: 'ARD-ardena', node: 13 });
    must(s, { type: 'mobilize', country: 'ARD', unit: 'inf', cities: ['ARD-ardena'] });
    must(s, { type: 'build', country: 'ARD', building: 'hospital', targets: ['ARD-ardena'] });
    advance(s, 40 * 60);
    const st = Object.values(s.stacks).find((x) => x.owner === 'ARD')!;
    expect(st.pos).toEqual({ kind: 'node', node: 13 });
    expect(s.cities['ARD-ardena'].buildings.some((b) => b.type === 'hospital')).toBe(true);
    expect(s.events.some((e) => e.kind === 'job_completed' && e.node === N.ardCapital)).toBe(true);
  });

  it('intel agents, articles, deployables and explicit embark/disembark work through commands', () => {
    const s = newMiniGame({ human: 'ARD', seed: 5 });
    clearStacks(s);
    war(s, 'ARD', 'BOR');
    must(s, { type: 'assignAgent', country: 'ARD', city: 'BOR-borgrad', mission: 'information' });
    expect(previewCommand(s, { type: 'assignAgent', country: 'ARD', city: 'ARD-ardena', mission: 'sabotage' }).ok).toBe(false);
    advance(s, 13 * 60);
    expect(s.events.some((e) => (e.kind === 'intel_report' || e.kind === 'agent_captured') && e.private.ARD)).toBe(true);
    must(s, { type: 'publishArticle', country: 'ARD', headline: 'Calm\u0007 returns', body: 'All is well.', anonymous: true });
    const np = newspaper(s, 1)!;
    expect(np.articles[0].author).toBeNull();
    expect(np.articles[0].headline).toBe('Calm returns');
    expect(newspaper(s, 99)).toBeNull(); // future editions cannot open
    const target = place(s, 'BOR', 14, ['inf']);
    const d = place(s, 'ARD', 13, ['drone']);
    must(s, { type: 'useDeployable', country: 'ARD', stack: d.id, unit: d.units[0].id, target: 14 });
    expect(target.units[0].hp).toBeLessThan(target.units[0].maxHp);
    expect(previewCommand(s, { type: 'useDeployable', country: 'ARD', stack: d.id, unit: d.units[0].id, target: 14 }).ok).toBe(false); // cooldown
    const inf = place(s, 'ARD', N.ardCapital, ['inf']);
    must(s, { type: 'embark', country: 'ARD', stack: inf.id, sea: N.S_W });
    advance(s, 24 * 60);
    expect(s.stacks[inf.id].pos).toEqual({ kind: 'node', node: N.S_W });
    expect(s.stacks[inf.id].mode).toBe('embarked');
    must(s, { type: 'disembark', country: 'ARD', stack: inf.id, land: N.ardWestport });
    advance(s, 48 * 60);
    expect(s.stacks[inf.id].pos).toEqual({ kind: 'node', node: N.ardWestport });
  });

  it('public newspaper never exposes private orders or composition; journal and inbox are private', () => {
    const s = newMiniGame({ human: 'ARD' });
    clearStacks(s);
    war(s, 'ARD', 'DUN');
    place(s, 'ARD', N.dunLow, ['inf', 'tank'], 'Operation Secret Hammer');
    must(s, { type: 'proposeOffer', country: 'CEL', to: 'ESK', give: [{ kind: 'status', level: 'right_of_way' }], receive: [], text: 'Secret proposal text' });
    advance(s, 120);
    const np = JSON.stringify(newspaper(s, 1));
    expect(np).toContain('declares war');
    expect(np).not.toContain('Secret Hammer');
    expect(np).not.toContain('Secret proposal');
    expect(np).not.toContain('"tank"');
    expect(journal(s, 'ARD').some((e) => e.kind === 'city_captured')).toBe(true);
    expect(journal(s, 'BOR').some((e) => e.kind === 'city_captured')).toBe(false);
    expect(inbox(s, 'ESK').offers.length).toBe(1);
    expect(inbox(s, 'ARD').offers.length).toBe(0);
    expect(JSON.stringify(getCountryView(s, 'BOR').messages)).not.toContain('Secret proposal');
  });

  it('UI model helpers: city list sort keys, research tree, score breakdown, inspector privacy, force summary', () => {
    const s = newMiniGame({ human: 'ARD' });
    const cl = cityList(s, 'ARD');
    expect(cl.every((c) => typeof c.netValue === 'number' && typeof c.vp === 'number')).toBe(true);
    const rt = researchTree(s, 'ARD');
    expect(rt.find((t) => t.id === 'late_tech')!.status).toBe('time_locked');
    expect(scoreBreakdown(s, 'ARD').nextSettlementTick).toBe(1080);
    expect(provinceInspector(s, 'ARD', N.borCapital).private).toBeNull();
    expect(provinceInspector(s, 'ARD', N.ardCapital).private!.factors.length).toBeGreaterThan(0);
    const f = forceModel(s, 'ARD');
    expect(f.fielded).toBeGreaterThan(0);
    expect(f.ready).toBeLessThanOrEqual(f.fielded);
    expect(stateHash(s)).toBe(stateHash(cloneState(s)));
  });
});
