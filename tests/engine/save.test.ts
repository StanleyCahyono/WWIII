import { describe, expect, it } from 'vitest';
import {
  advance,
  serialize,
  deserialize,
  stateHash,
  SaveError,
  migrate,
  revisionConflict,
  markSaved,
  addDrawing,
  renameDrawing,
  setDrawingHidden,
  deleteDrawing,
  cloneState,
  BasicController,
  submitCommand,
} from '../../src/engine';
import { newMiniGame, N } from '../fixtures/mini-world';
import { must, place, clearStacks } from '../fixtures/helpers';
import { RESOURCES } from '../../src/engine/data-types';

function toV0(json: string): string {
  const env = JSON.parse(json);
  const s = env.state;
  s.schemaVersion = 0;
  s.clock = { minute: s.clock.tick };
  delete s.ui;
  for (const c of Object.values<any>(s.countries)) {
    c.treasury = Object.fromEntries(RESOURCES.map((r) => [r, c.stock[r] / 1000]));
    delete c.stock;
    delete c.escrow;
    delete c.shortages;
  }
  env.schemaVersion = 0;
  return JSON.stringify(env);
}

describe('persistence (A14, W06)', () => {
  it('corrupt imports throw typed errors and leave the caller state untouched', () => {
    const s = newMiniGame();
    advance(s, 300);
    const h = stateHash(s);
    const good = serialize(s);
    const cases: [string, string][] = [
      ['{not json', 'parse'],
      [JSON.stringify({ hello: 1 }), 'format'],
      [good.slice(0, good.length / 2), 'parse'],
    ];
    const bad = JSON.parse(good);
    bad.state.stacks[Object.keys(bad.state.stacks)[0]].owner = 'XXX';
    cases.push([JSON.stringify(bad), 'invalid']);
    const nan = JSON.parse(good);
    nan.state.countries.ARD.stock.money = -5;
    cases.push([JSON.stringify(nan), 'invalid']);
    const future = JSON.parse(good);
    future.state.schemaVersion = 99;
    cases.push([JSON.stringify(future), 'version']);
    const orphan = JSON.parse(good);
    orphan.state.queue = [];
    orphan.state.countries.ARD.research = [{ tech: 'land_infantry_2', startedAt: 0, endsAt: 100, cost: orphan.state.countries.ARD.stock, durationMin: 100 }];
    cases.push([JSON.stringify(orphan), 'invalid']);
    for (const [json, code] of cases) {
      let err: unknown = null;
      try {
        deserialize(json);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(SaveError);
      expect((err as SaveError).code).toBe(code);
    }
    expect(stateHash(s)).toBe(h);
  });

  it('explicit, repeatable v0 → v1 migration', () => {
    const s = newMiniGame();
    advance(s, 500);
    const json = serialize(s);
    const v0 = toV0(json);
    const loaded = deserialize(v0);
    expect(loaded.schemaVersion).toBe(1);
    expect(loaded.countries.ARD.stock).toEqual(s.countries.ARD.stock);
    expect(loaded.clock.tick).toBe(s.clock.tick);
    const raw = JSON.parse(v0).state;
    const m1 = migrate(JSON.parse(JSON.stringify(raw)));
    const m2 = migrate(JSON.parse(JSON.stringify(raw)));
    expect(JSON.stringify(m1)).toBe(JSON.stringify(m2));
    expect(JSON.stringify(migrate(m1))).toBe(JSON.stringify(m1)); // idempotent on current schema
    expect(stateHash(loaded)).toBe(stateHash(s));
  });

  it('save revision detects a second writer', () => {
    const s = newMiniGame();
    const tabA = cloneState(s);
    const tabB = cloneState(s);
    const stored = markSaved(tabA); // tab A writes revision 1
    expect(revisionConflict(tabB.meta.saveRevision, stored)).toBe(true); // B holds 0 < 1 → conflict
    expect(revisionConflict(stored, stored)).toBe(false);
    expect(stateHash(tabA)).toBe(stateHash(tabB)); // revision not part of sim hash
  });

  it('W06: planning drawings live in the UI section, are saved, and never affect simulation hash/RNG/orders', () => {
    const s = newMiniGame({ human: 'ARD' });
    const h0 = stateHash(s);
    const rng0 = JSON.stringify(s.rng);
    const st = Object.values(s.stacks).find((x) => x.owner === 'ARD' && x.moveClass === 'ground')!;
    const d = addDrawing(s, { author: 'ARD', kind: 'route', name: 'Idea', points: [[0, 6], [4, 6]], expiresAt: null });
    expect(renameDrawing(s, d.id, 'Plan B')).toBe(true);
    expect(setDrawingHidden(s, d.id, true)).toBe(true);
    expect(stateHash(s)).toBe(h0);
    expect(JSON.stringify(s.rng)).toBe(rng0);
    expect(st.order).toBeNull();
    const l = deserialize(serialize(s));
    expect(l.ui.planning[0].name).toBe('Plan B');
    expect(deleteDrawing(l, d.id)).toBe(true);
    expect(stateHash(l)).toBe(h0);
    advance(s, 60);
    expect(s.stacks[st.id].order).toBeNull(); // a drawing issues no orders
    must(s, { type: 'move', country: 'ARD', stack: st.id, dest: N.ardWestport });
    expect(s.stacks[st.id].order?.kind).toBe('move');
  });

  it('cross-check 9: saving right before completion / day change and resuming equals an uninterrupted run', () => {
    const base = newMiniGame({ human: null, seed: 8 });
    must(base, { type: 'startResearch', country: 'ARD', tech: 'land_infantry_2' });
    must(base, { type: 'marketOrder', country: 'ARD', side: 'sell', resource: 'fuel', qty: 50, price: 2000 });
    must(base, { type: 'marketOrder', country: 'BOR', side: 'buy', resource: 'fuel', qty: 20, price: 2500 });
    must(base, { type: 'proposeOffer', country: 'CEL', to: 'ESK', give: [{ kind: 'status', level: 'right_of_way' }], receive: [], expiresInMin: 1080 });
    const host = { fallback: BasicController };
    const straight = cloneState(base);
    advance(straight, 3 * 1440, host);
    for (const cut of [1079, 1080, 1439]) {
      const a = cloneState(base);
      advance(a, cut, host);
      const b = deserialize(serialize(a));
      advance(b, 3 * 1440 - cut, host);
      expect(stateHash(b)).toBe(stateHash(straight));
    }
  });

  it('A13-style: export/import keeps seed, clock, roster, economy, pending jobs', () => {
    const s = newMiniGame({ human: 'CEL', seed: 1234 });
    clearStacks(s, 'BOR');
    place(s, 'BOR', 8, ['inf']);
    submitCommand(s, { type: 'build', country: 'CEL', building: 'factory', targets: ['CEL-celesta'] });
    advance(s, 200);
    const l = deserialize(serialize(s));
    expect(l.seed).toBe(1234);
    expect(l.clock.tick).toBe(200);
    expect(l.countryOrder).toEqual(s.countryOrder);
    expect(l.countries.CEL.jobs).toEqual(s.countries.CEL.jobs);
    expect(l.countries.CEL.stock).toEqual(s.countries.CEL.stock);
    expect(l.meta.humanCountry).toBe('CEL');
  });
});
