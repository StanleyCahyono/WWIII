import { describe, expect, it } from 'vitest';
import { advance, getCountryView, submitCommand, cloneState, BasicController, IdleController } from '../../src/engine';
import { newMiniGame, N } from '../fixtures/mini-world';
import { clearStacks, place, grant, refreshVision, must } from '../fixtures/helpers';
import { revokeGrantInternal } from '../../src/engine/systems/diplomacy';
import type { GameState } from '../../src/engine/state';
import { bumpEconomy } from '../../src/engine/systems/economy';

function setup(): GameState {
  const s = newMiniGame({ human: 'ARD' });
  clearStacks(s);
  return s;
}
function contactsOf(s: GameState, viewer: string) {
  return getCountryView(s, viewer).contacts;
}

describe('visibility & intel', () => {
  it('A04: radar-only contact exposes only broad domain/position/time; no hidden fields anywhere in the view', () => {
    const s = setup();
    s.cities['ARD-ardena'].buildings.push({ type: 'radar', level: 2, condition: 100 });
    bumpEconomy(s);
    const hidden = place(s, 'BOR', 14, ['inf', 'tank'], 'Secret Guards Brigade');
    refreshVision(s);
    const v = getCountryView(s, 'ARD');
    expect(v.contacts.length).toBe(1);
    const c = v.contacts[0];
    expect(c.level).toBe('contact');
    expect(Object.keys(c).sort()).toEqual(['ageMin', 'domain', 'id', 'level', 'lonlat', 'node', 'observedAt']);
    const json = JSON.stringify(v);
    expect(json).not.toContain(`"${hidden.id}"`);
    // own catalog levels (self.unitLevels) legitimately list unit type ids; nothing else may
    const foreign = JSON.stringify({ ...v, self: null });
    expect(foreign).not.toContain('"inf"');
    expect(foreign).not.toContain('"tank"');
    expect(json).not.toContain('Secret Guards');
    for (const u of hidden.units) expect(json).not.toContain(`"${u.id}"`);
    // attack/route previews can only reference the opaque contact id
    const mine = place(s, 'ARD', 13, ['inf']);
    const atk = submitCommand(s, { type: 'attack', country: 'ARD', stack: mine.id, targetContact: hidden.id });
    expect(atk.ok).toBe(false);
  });

  it('A04: purchased report is a frozen snapshot; moving the stack leaves it in place; expired reports remain as history', () => {
    const s = setup();
    const st = place(s, 'BOR', 14, ['inf', 'inf']);
    const r = must(s, { type: 'buyIntelReport', country: 'ARD', node: 14 });
    const id = (r.result as { report: string }).report;
    const rep0 = getCountryView(s, 'ARD').reports.find((x) => x.id === id)!;
    expect(rep0.stacks.length).toBe(1);
    expect(rep0.stacks[0].units).toEqual([{ type: 'inf', count: 2 }]);
    must(s, { type: 'move', country: 'BOR', stack: st.id, dest: 8 });
    advance(s, 26 * 60);
    expect(s.stacks[st.id].pos).toEqual({ kind: 'node', node: 8 });
    const v = getCountryView(s, 'ARD');
    const rep = v.reports.find((x) => x.id === id)!;
    expect(rep.stacks[0].lonlat).toEqual(rep0.stacks[0].lonlat);
    expect(rep.observedAt).toBe(rep0.observedAt);
    expect(rep.expired).toBe(true);
    expect(v.contacts.every((c) => c.node !== 8 || c.level === 'stale')).toBe(true);
  });

  it('mixed stack: detected through one member while the stealthy member stays hidden', () => {
    const s = setup();
    place(s, 'BOR', 14, ['inf', 'stealth']);
    place(s, 'ARD', 13, ['scout']);
    refreshVision(s);
    const c = contactsOf(s, 'ARD')[0];
    expect(c.level).toBe('identified');
    expect(c.count).toBe(1);
    expect(c.units!.map((u) => u.type)).toEqual(['inf']);
    expect(JSON.stringify({ ...getCountryView(s, 'ARD'), self: null })).not.toContain('"stealth"');
  });

  it('cross-check 7: two sensors on one contact — identification falls back to what the remaining sensor justifies, then stale', () => {
    const s = setup();
    s.cities['ARD-ardena'].buildings.push({ type: 'radar', level: 2, condition: 100 });
    bumpEconomy(s);
    place(s, 'BOR', 14, ['inf']);
    const scout = place(s, 'ARD', 13, ['scout']);
    refreshVision(s);
    expect(contactsOf(s, 'ARD')[0].level).toBe('identified');
    scout.pos = { kind: 'node', node: 24 }; // out of range
    refreshVision(s);
    const c = contactsOf(s, 'ARD')[0];
    expect(c.level).toBe('contact');
    expect(c.owner).toBeUndefined();
    expect(c.units).toBeUndefined();
    s.cities['ARD-ardena'].buildings = s.cities['ARD-ardena'].buildings.filter((b) => b.type !== 'radar');
    bumpEconomy(s); // direct test mutation of buildings must announce itself (engine paths do)
    refreshVision(s);
    expect(contactsOf(s, 'ARD')[0].level).toBe('stale');
  });

  it('shared intel shares vision; revoking it refreshes only legitimate fields (contacts go stale, nothing new leaks)', () => {
    const s = setup();
    place(s, 'CEL', N.celCapital, ['inf']);
    const borSt = place(s, 'BOR', N.borCanal, ['inf']);
    place(s, 'CEL', 2, ['scout']); // CEL scout near the BOR stack (in BOR territory, test-only placement)
    refreshVision(s);
    expect(contactsOf(s, 'ARD').length).toBe(0);
    grant(s, 'CEL', 'ARD', 'shared_intel');
    refreshVision(s);
    const cs = contactsOf(s, 'ARD');
    expect(cs.some((c) => c.owner === 'CEL' && c.level === 'identified')).toBe(true);
    expect(cs.some((c) => c.owner === 'BOR')).toBe(true);
    revokeGrantInternal(s, 'CEL', 'ARD', 'peace');
    borSt.pos = { kind: 'node', node: 8 };
    refreshVision(s);
    const after = contactsOf(s, 'ARD');
    expect(after.every((c) => c.level === 'stale')).toBe(true);
    const bor = after.find((c) => c.owner === 'BOR')!;
    expect(bor.node).toBe(N.borCanal); // frozen at last legitimate observation
  });

  it('coalition members share vision', () => {
    const s = setup();
    place(s, 'DUN', N.dunCapital, ['inf']);
    must(s, { type: 'createCoalition', country: 'ARD', name: 'Western Pact' });
    const co = Object.keys(s.coalitions)[0];
    must(s, { type: 'applyCoalition', country: 'DUN', coalition: co });
    must(s, { type: 'respondApplication', country: 'ARD', coalition: co, applicant: 'DUN', accept: true });
    refreshVision(s);
    expect(contactsOf(s, 'ARD').some((c) => c.owner === 'DUN' && c.level === 'identified')).toBe(true);
  });

  it('cross-check 6: an unobserved hidden unit cannot affect another country’s view, route choice or journal', () => {
    const a = newMiniGame({ human: null, seed: 4 });
    const b = cloneState(a);
    place(b, 'ESK', N.eskIsle, ['inf', 'inf', 'tank'], 'Ghost Battalion');
    refreshVision(b);
    const strip = (v: ReturnType<typeof getCountryView>) => JSON.stringify({ ...v, scores: null });
    expect(strip(getCountryView(b, 'DUN'))).toBe(strip(getCountryView(a, 'DUN')));
    const host = { controllers: (c: string) => (c === 'DUN' ? BasicController : IdleController) };
    advance(a, 2 * 1440, host);
    advance(b, 2 * 1440, host);
    const dunA = Object.values(a.stacks).filter((x) => x.owner === 'DUN').map((x) => JSON.stringify(x.pos) + JSON.stringify(x.order));
    const dunB = Object.values(b.stacks).filter((x) => x.owner === 'DUN').map((x) => JSON.stringify(x.pos) + JSON.stringify(x.order));
    expect(dunB).toEqual(dunA);
    expect(getCountryView(b, 'DUN').journal).toEqual(getCountryView(a, 'DUN').journal);
  });

  it('a foreign city exposes only public fields', () => {
    const s = setup();
    const v = getCountryView(s, 'ARD');
    const bor = v.publicCities.find((c) => c.key === 'BOR-borgrad')!;
    expect(Object.keys(bor).sort()).toEqual(['capital', 'homeland', 'key', 'name', 'node', 'owner', 'port', 'status', 'tier']);
    expect(v.cities.every((c) => s.provinces[c.node]!.owner === 'ARD')).toBe(true);
  });
});
