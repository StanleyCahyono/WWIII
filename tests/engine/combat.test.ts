import { describe, expect, it } from 'vitest';
import { advance, cloneState, stateHash, submitCommand, previewCommand, countryScores } from '../../src/engine';
import { newMiniGame, N } from '../fixtures/mini-world';
import { clearStacks, place, war, must, totalHp, stacksOf } from '../fixtures/helpers';
import { allocateDamage, combatRound, stackEfficiency } from '../../src/engine/systems/combat';
import { combatHooks } from '../../src/engine/systems/hooks';
import { newUnit } from '../../src/engine/systems/production';

function setup() {
  const s = newMiniGame({ human: 'ARD' });
  clearStacks(s);
  return s;
}

describe('combat', () => {
  it('echelon allocation: front echelon absorbs damage first, split evenly, overflow passes to next echelon', () => {
    const s = setup();
    const a = newUnit(s, 'inf', 1); // 1500 hp, echelon 1
    const b = newUnit(s, 'inf', 1);
    const c = newUnit(s, 'arty', 1); // 1000 hp, echelon 3, unarmored
    const t = newUnit(s, 'tank', 1); // armored
    const units = [a, b, c, t];
    allocateDamage(s, units, { unarmored: 2001 });
    expect([a.hp, b.hp, c.hp, t.hp]).toEqual([1500 - 1001, 1500 - 1000, 1000, 2500]);
    allocateDamage(s, units, { unarmored: 1500 });
    // a: 499 → 0 (overflow 251), b: 500 → 0 (overflow 250) → arty takes 501
    expect(a.hp).toBe(0);
    expect(b.hp).toBe(0);
    expect(c.hp).toBe(1000 - 501);
    // damage vs a class with no units is lost (does not spill)
    allocateDamage(s, units, { ship: 5000 });
    expect(t.hp).toBe(2500);
  });

  it('A07: split/merge conserve unit count and HP; merging never adds HP; ids stay unique', () => {
    const s = setup();
    const st = place(s, 'ARD', N.ardCapital, ['inf', 'inf', 'tank', 'arty']);
    st.units[0].hp = 700;
    const hp0 = totalHp([st]);
    const ids0 = st.units.map((u) => u.id).sort();
    const r = must(s, { type: 'split', country: 'ARD', stack: st.id, units: [st.units[0].id, st.units[2].id] });
    const other = s.stacks[(r.result as { newStack: string }).newStack];
    expect(st.units.length + other.units.length).toBe(4);
    expect(totalHp([st, other])).toBe(hp0);
    const all = [...st.units, ...other.units].map((u) => u.id).sort();
    expect(all).toEqual(ids0);
    expect(previewCommand(s, { type: 'split', country: 'ARD', stack: st.id, units: st.units.map((u) => u.id) }).ok).toBe(false);
    must(s, { type: 'merge', country: 'ARD', stacks: [st.id, other.id] });
    expect(s.stacks[other.id]).toBeUndefined();
    expect(s.stacks[st.id].units.length).toBe(4);
    expect(totalHp([s.stacks[st.id]])).toBe(hp0);
    expect(s.stacks[st.id].units.find((u) => u.id === ids0.find((x) => x === st.units.find((y) => y.hp === 700)?.id))?.hp).toBe(700);
  });

  it('overstack efficiency is published and enforced', () => {
    expect(stackEfficiency(10)).toBe(1);
    expect(stackEfficiency(14)).toBeCloseTo(0.84);
    expect(stackEfficiency(40)).toBe(0.5);
    const s = setup();
    const a = place(s, 'ARD', N.ardCapital, Array(8).fill('inf'));
    const b = place(s, 'ARD', N.ardCapital, Array(6).fill('inf'));
    const v = previewCommand(s, { type: 'merge', country: 'ARD', stacks: [a.id, b.id] });
    expect(v.ok && (v.preview as { efficiency: number }).efficiency).toBeCloseTo(0.84);
  });

  it('timed engagement: identical outcome at two speeds; defender uses defense table; battle report emitted once', () => {
    const base = setup();
    war(base, 'ARD', 'BOR');
    place(base, 'BOR', 14, ['inf', 'inf'], 'BOR Defenders');
    base.clock.tick = 0;
    advance(base, 180); // defenders become entrenched
    const att = place(base, 'ARD', 13, ['inf', 'inf', 'tank', 'tank'], 'ARD Assault');
    must(base, { type: 'move', country: 'ARD', stack: att.id, dest: 14 });
    const fast = cloneState(base);
    const slow = cloneState(base);
    advance(fast, 2 * 1440);
    for (let i = 0; i < 2 * 1440; i++) advance(slow, 1);
    expect(stateHash(fast)).toBe(stateHash(slow));
    const eng = Object.values(fast.engagements).find((e) => e.kind === 'node');
    expect(eng).toBeTruthy();
    expect(eng!.tables.BOR).toBe('defense');
    expect(eng!.tables.ARD).toBe('attack');
    const reports = fast.events.filter((e) => e.kind === 'battle_report');
    expect(reports.length).toBe(1);
    expect(reports[0].private.ARD.text).toMatch(/assault on a defended center/);
    expect(reports[0].private.BOR).toBeTruthy();
    // ARD captured the province after defeating the garrison
    expect(fast.provinces[14]!.owner).toBe('ARD');
  });

  it('the same round can never apply damage twice', () => {
    const s = setup();
    war(s, 'ARD', 'BOR');
    const a = place(s, 'ARD', 14, ['inf']);
    const b = place(s, 'BOR', 14, ['inf']);
    s.clock.tick = 60;
    combatRound(s, combatHooks);
    const hp = [a.units[0].hp, b.units[0].hp];
    combatRound(s, combatHooks);
    expect([a.units[0].hp, b.units[0].hp]).toEqual(hp);
    expect(hp[0]).toBeLessThan(a.units[0].maxHp);
  });

  it('cross-check 4: a non-capturing unit does not capture; eligible infantry does (owner, score, event together)', () => {
    const s = setup();
    war(s, 'ARD', 'DUN');
    const sc = place(s, 'ARD', N.dunLow, ['scout', 'arty']);
    advance(s, 60);
    expect(s.provinces[N.dunLow]!.owner).toBe('DUN');
    const before = countryScores(s);
    place(s, 'ARD', N.dunLow, ['inf']);
    advance(s, 15);
    expect(s.provinces[N.dunLow]!.owner).toBe('ARD');
    expect(s.provinces[N.dunLow]!.status).toBe('occupied');
    const after = countryScores(s);
    expect(after.ARD - before.ARD).toBe(before.DUN - after.DUN);
    expect(s.events.some((e) => e.kind === 'city_captured' && e.node === N.dunLow)).toBe(true);
    expect(sc.id).toBeTruthy();
  });

  it('retreat goes to a real adjacent destination and costs 10 % HP', () => {
    const s = setup();
    war(s, 'ARD', 'BOR');
    const a = place(s, 'ARD', 14, ['inf']);
    place(s, 'BOR', 14, ['inf', 'inf']);
    const hp = a.units[0].hp;
    expect(previewCommand(s, { type: 'retreat', country: 'ARD', stack: a.id, dest: 26 }).ok).toBe(false);
    const r = submitCommand(s, { type: 'retreat', country: 'ARD', stack: a.id, dest: 13 });
    expect(r.ok).toBe(true);
    expect(a.units[0].hp).toBe(hp - Math.floor(hp * 0.1));
    advance(s, 24 * 60);
    expect(s.stacks[a.id]?.pos).toEqual({ kind: 'node', node: 13 });
  });

  it('ranged support hits an adjacent hostile stack; a stack in node combat does not also fire elsewhere', () => {
    const s = setup();
    war(s, 'ARD', 'BOR');
    const arty = place(s, 'ARD', 13, ['arty', 'scout']); // scout provides observation
    const target = place(s, 'BOR', 14, ['inf']);
    s.contacts = {};
    advance(s, 60);
    expect(target.units[0].hp).toBeLessThan(target.units[0].maxHp);
    // now arty is engaged at its own node
    const t2hp = target.units[0].hp;
    place(s, 'BOR', 13, ['inf']);
    advance(s, 60);
    expect(s.stacks[target.id].units[0].hp).toBe(t2hp);
    expect(arty.id).toBeTruthy();
  });

  it('readiness lowers strength; refit stacks fight at reduced strength', () => {
    const s = setup();
    war(s, 'ARD', 'BOR');
    const a = place(s, 'ARD', 14, ['inf'], 'fresh', 100);
    const b = place(s, 'BOR', 14, ['inf'], 'tired', 0);
    a.stationarySince = b.stationarySince = 0;
    a.firePolicy = 'engage';
    b.firePolicy = 'engage';
    s.clock.tick = 60;
    combatRound(s, combatHooks);
    const dmgToB = b.units[0].maxHp - b.units[0].hp;
    const dmgToA = a.units[0].maxHp - a.units[0].hp;
    expect(dmgToB).toBeGreaterThan(dmgToA);
    expect(stacksOf(s, 'ARD').length).toBe(1);
  });
});
