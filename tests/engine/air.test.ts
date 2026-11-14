import { describe, expect, it } from 'vitest';
import { advance, submitCommand, previewCommand, serialize, deserialize, stateHash } from '../../src/engine';
import { newMiniGame, N } from '../fixtures/mini-world';
import { clearStacks, place, war, grant, must } from '../fixtures/helpers';
import { transferNode } from '../../src/engine/systems/government';
import { govHooks, destroyStack } from '../../src/engine/systems/hooks';
import { revokeGrantInternal } from '../../src/engine/systems/diplomacy';
import type { GameState } from '../../src/engine/state';

function setup(): GameState {
  const s = newMiniGame({ human: 'ARD' });
  clearStacks(s);
  return s;
}

describe('air operations (A10)', () => {
  it('patrol: outbound → on station → return within endurance → refuel → landed', () => {
    const s = setup();
    const f = place(s, 'ARD', N.ardCapital, ['fighter', 'fighter']);
    const v = previewCommand(s, { type: 'patrol', country: 'ARD', stack: f.id, center: 14 });
    expect(v.ok).toBe(true);
    must(s, { type: 'patrol', country: 'ARD', stack: f.id, center: 14, radiusKm: 120 });
    expect(f.air!.state).toBe('outbound');
    advance(s, 45);
    expect(s.stacks[f.id].air!.state).toBe('on_station');
    const until = s.stacks[f.id].air!.patrol!.until;
    expect(until).toBeLessThanOrEqual(240);
    advance(s, until - s.clock.tick + 60);
    expect(['refueling', 'landed']).toContain(s.stacks[f.id].air!.state);
    // refuel blocks a new sortie with a reason; save/restore mid-refuel resolves identically
    if (s.stacks[f.id].air!.state === 'refueling') {
      const r = submitCommand(s, { type: 'patrol', country: 'ARD', stack: f.id, center: 14 });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('refueling');
      const l = deserialize(serialize(s));
      advance(l, 120);
      advance(s, 120);
      expect(stateHash(l)).toBe(stateHash(s));
    }
    advance(s, 120);
    expect(s.stacks[f.id].air!.state).toBe('landed');
    expect(s.stacks[f.id].pos).toEqual({ kind: 'node', node: N.ardCapital });
  });

  it('home base captured while airborne → divert to nearest legal base with an event', () => {
    const s = setup();
    war(s, 'ARD', 'DUN');
    const f = place(s, 'ARD', N.ardWestport, ['fighter']);
    must(s, { type: 'patrol', country: 'ARD', stack: f.id, center: 19 });
    advance(s, 30);
    transferNode(s, N.ardWestport, 'DUN', 'capture', govHooks);
    advance(s, 15);
    const st = s.stacks[f.id];
    expect(st).toBeTruthy();
    expect(st.air!.home).toEqual({ node: N.ardCapital });
    expect(s.events.some((e) => e.kind === 'aircraft_diverted' && e.private.ARD)).toBe(true);
    advance(s, 240);
    expect(s.stacks[f.id].pos).toEqual({ kind: 'node', node: N.ardCapital });
  });

  it('no legal base within range → documented loss, accounted for in an event', () => {
    const s = setup();
    war(s, 'ARD', 'DUN');
    const f = place(s, 'ARD', N.ardWestport, ['fighter', 'fighter']);
    must(s, { type: 'patrol', country: 'ARD', stack: f.id, center: 19 });
    advance(s, 30);
    transferNode(s, N.ardWestport, 'DUN', 'capture', govHooks);
    transferNode(s, N.ardCapital, 'DUN', 'capture', govHooks);
    advance(s, 15);
    expect(s.stacks[f.id]).toBeUndefined();
    const ev = s.events.find((e) => e.kind === 'aircraft_lost' && e.private.ARD);
    expect(ev).toBeTruthy();
    expect(ev!.private.ARD.data?.count).toBe(2);
  });

  it('basing access revoked while airborne → divert; disabled airfield grounds aircraft on the ground', () => {
    const s = setup();
    grant(s, 'BOR', 'ARD', 'right_of_way');
    const f = place(s, 'ARD', N.ardCapital, ['fighter']);
    must(s, { type: 'rebase', country: 'ARD', stack: f.id, base: { node: N.borCapital } });
    advance(s, 120);
    expect(s.stacks[f.id].air!.home).toEqual({ node: N.borCapital });
    advance(s, 120);
    must(s, { type: 'patrol', country: 'ARD', stack: f.id, center: 14 });
    advance(s, 15);
    revokeGrantInternal(s, 'BOR', 'ARD', 'peace');
    advance(s, 15);
    expect(s.stacks[f.id].air!.home).toEqual({ node: N.ardCapital });
    advance(s, 300);
    // grounded
    s.cities['ARD-ardena'].condition = 10;
    advance(s, 15);
    expect(s.stacks[f.id].air!.grounded).toBe(true);
    const r = submitCommand(s, { type: 'patrol', country: 'ARD', stack: f.id, center: 14 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('grounded');
  });

  it('carriers are mobile bases; aircraft aboard a sunk carrier are lost with it', () => {
    const s = setup();
    const c = place(s, 'ARD', N.S_W, ['carrier', 'frigate']);
    const f = place(s, 'ARD', N.ardCapital, ['fighter', 'fighter']);
    const v = submitCommand(s, { type: 'rebase', country: 'ARD', stack: f.id, base: { stack: c.id } });
    expect(v.ok).toBe(true);
    advance(s, 180);
    expect(s.stacks[f.id].aboard).toBe(c.id);
    expect(s.stacks[f.id].air!.home).toEqual({ stack: c.id });
    destroyStack(s, s.stacks[c.id], null);
    expect(s.stacks[f.id]).toBeUndefined();
    expect(s.events.some((e) => e.kind === 'aircraft_lost' && /carrier/.test(e.private.ARD?.text ?? ''))).toBe(true);
  });

  it('rebase range and capacity are validated with reasons', () => {
    const s = setup();
    const f = place(s, 'ARD', N.ardCapital, ['fighter']);
    const r = previewCommand(s, { type: 'rebase', country: 'ARD', stack: f.id, base: { node: N.borCapital } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('no_access');
    const g = place(s, 'ARD', N.ardWestport, Array(5).fill('fighter'));
    const r2 = previewCommand(s, { type: 'rebase', country: 'ARD', stack: g.id, base: { node: N.ardWestport + 0 } });
    expect(r2.ok).toBe(false);
  });
});
