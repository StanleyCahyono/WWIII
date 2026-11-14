/**
 * Engine features pass: helicopter air-mobile lift, port blockades, peace settlements with
 * territory/resources and multi-round haggling (+ save migration v1 → v2).
 */
import { describe, expect, it } from 'vitest';
import { advance, deserialize, getCountryView, IdleController, serialize, stateHash, submitCommand, validateCommand, cloneState, migrate, SCHEMA_VERSION } from '../../src/engine';
import type { GameState } from '../../src/engine';
import { newMiniGame, N } from '../fixtures/mini-world';
import { clearStacks, must, place, reconciled, refreshVision, setStock, war, grant } from '../fixtures/helpers';
import { interceptionRisk, liftInfo } from '../../src/engine/systems/airmobile';
import { cityOutput } from '../../src/engine/systems/economy';
import { AIRMOBILE, BLOCKADE, PEACE } from '../../src/engine/rules';

const idle = { fallback: IdleController };

function airGame(seed = 42): GameState {
  const s = newMiniGame({ seed, human: 'ARD' });
  clearStacks(s);
  return s;
}

describe('helicopter air-mobile lift', () => {
  it('validates load, lift, range, terrain and acts of war through the shared validator', () => {
    const s = airGame();
    const lift = place(s, 'ARD', 13, ['heli', 'inf', 'inf'], 'Air Group');
    expect(liftInfo(s, lift)).toMatchObject({ lift: 2, passengers: 2, flyers: 1 });
    // a tank cannot ride a helicopter
    const heavy = place(s, 'ARD', 13, ['heli', 'inf', 'tank']);
    expect(validateCommand(s, { type: 'airmobile', country: 'ARD', stack: heavy.id, dest: 19 })).toMatchObject({ ok: false, code: 'invalid_domain' });
    // three infantry, two seats
    const crowded = place(s, 'ARD', 13, ['heli', 'inf', 'inf', 'inf']);
    expect(validateCommand(s, { type: 'airmobile', country: 'ARD', stack: crowded.id, dest: 19 })).toMatchObject({ ok: false, code: 'insufficient_lift' });
    // infantry without helicopters
    const foot = place(s, 'ARD', 13, ['inf']);
    expect(validateCommand(s, { type: 'airmobile', country: 'ARD', stack: foot.id, dest: 19 })).toMatchObject({ ok: false, code: 'missing_facility' });
    // too far (Falen is ~1,000 km away; default helicopter range 400 km), at sea, too close
    expect(validateCommand(s, { type: 'airmobile', country: 'ARD', stack: lift.id, dest: N.falCapital })).toMatchObject({ ok: false, code: 'insufficient_range' });
    expect(validateCommand(s, { type: 'airmobile', country: 'ARD', stack: lift.id, dest: N.S_W })).toMatchObject({ ok: false, code: 'invalid_domain' });
    expect(validateCommand(s, { type: 'airmobile', country: 'ARD', stack: lift.id, dest: 13 })).toMatchObject({ ok: false, code: 'invalid_argument' });
    // Borvia at peace without passage: act of war until confirmed
    const aow = validateCommand(s, { type: 'airmobile', country: 'ARD', stack: lift.id, dest: 14 });
    expect(aow).toMatchObject({ ok: false, code: 'act_of_war' });
    expect(validateCommand(s, { type: 'airmobile', country: 'ARD', stack: lift.id, dest: 14, confirmActOfWar: ['BOR'] }).ok).toBe(true);
    // passage makes it legal without a declaration
    grant(s, 'BOR', 'ARD', 'right_of_way');
    expect(validateCommand(s, { type: 'airmobile', country: 'ARD', stack: lift.id, dest: 14 }).ok).toBe(true);
    // not enough fuel
    setStock(s, 'ARD', { fuel: 0 });
    expect(validateCommand(s, { type: 'airmobile', country: 'ARD', stack: lift.id, dest: 19 })).toMatchObject({ ok: false, code: 'insufficient_resources' });
  });

  it('flies, charges fuel to the ledger, cannot be stopped in mid-air, lands and needs a turnaround', () => {
    const s = airGame();
    const st = place(s, 'ARD', 12, ['heli', 'inf', 'inf'], 'Air Group');
    const fuel0 = s.countries.ARD.stock.fuel;
    const r = must(s, { type: 'airmobile', country: 'ARD', stack: st.id, dest: 19 });
    const p = r.preview as { km: number; arriveAt: number; fuel: { fuel: number }; riskEstimate: number };
    expect(p.km).toBeGreaterThan(250);
    expect(p.fuel.fuel).toBe(1 * Math.ceil(p.km / 100) * AIRMOBILE.fuelPer100Km * 1000);
    expect(s.countries.ARD.stock.fuel).toBe(fuel0 - p.fuel.fuel);
    expect(reconciled(s, 'ARD')).toBe(true);
    expect(s.countries.ARD.ledger.totals.operations?.fuel).toBe(-p.fuel.fuel);
    expect(s.stacks[st.id].pos.kind).toBe('air');
    // view: ETA is the landing time; the order carries the lift marker
    const v = getCountryView(s, 'ARD');
    const sv = v.stacks.find((x) => x.id === st.id)!;
    expect(sv.eta).toBe(p.arriveAt);
    expect(sv.order && sv.order.kind === 'move' && sv.order.airmobile?.from).toBe(12);
    for (const cmd of [{ type: 'stop' }, { type: 'move', dest: 13 }, { type: 'delay', minutes: 60 }, { type: 'split', units: [st.units[1].id] }] as const) {
      expect(validateCommand(s, { ...cmd, country: 'ARD', stack: st.id } as never).ok).toBe(false);
    }
    advance(s, p.arriveAt - s.clock.tick + 15, idle);
    const landed = s.stacks[st.id];
    expect(landed.pos).toEqual({ kind: 'node', node: 19 });
    expect(landed.mode).toBe('land');
    expect(landed.order).toBeNull();
    // turnaround: helicopters refuel before the next hop
    expect(validateCommand(s, { type: 'airmobile', country: 'ARD', stack: st.id, dest: 12 })).toMatchObject({ ok: false, code: 'refueling' });
    advance(s, AIRMOBILE.turnaroundMin, idle);
    expect(validateCommand(s, { type: 'airmobile', country: 'ARD', stack: st.id, dest: 12 }).ok).toBe(true);
  });

  it('captures an undefended enemy province on landing (ordinary capture rule), declares war on a confirmed peace landing', () => {
    const s = airGame();
    const st = place(s, 'ARD', 13, ['heli', 'inf', 'inf'], 'Air Group');
    expect(s.provinces[14]!.owner).toBe('BOR');
    const r = must(s, { type: 'airmobile', country: 'ARD', stack: st.id, dest: 14, confirmActOfWar: ['BOR'] });
    const arrive = (r.preview as { arriveAt: number }).arriveAt;
    // no war yet while airborne
    expect(s.relations['ARD|BOR']?.war ?? false).toBe(false);
    advance(s, arrive - s.clock.tick + 15, idle);
    expect(s.relations['ARD|BOR']?.war).toBe(true);
    expect(s.provinces[14]!.owner).toBe('ARD');
    expect(s.provinces[14]!.status).toBe('occupied');
    expect(s.events.some((e) => e.kind === 'airmobile_landed' && e.private.ARD)).toBe(true);
  });

  it('turns back when the landing zone became illegal in flight (no confirmation on file)', () => {
    const s = airGame();
    grant(s, 'BOR', 'ARD', 'right_of_way');
    const st = place(s, 'ARD', 13, ['heli', 'inf']);
    const r = must(s, { type: 'airmobile', country: 'ARD', stack: st.id, dest: 14 });
    grant(s, 'BOR', 'ARD', 'peace'); // passage withdrawn while airborne
    advance(s, (r.preview as { arriveAt: number }).arriveAt - s.clock.tick + 15, idle);
    expect(s.events.some((e) => e.kind === 'airmobile_aborted')).toBe(true);
    expect(s.relations['ARD|BOR']?.war ?? false).toBe(false);
    advance(s, 6 * 60, idle);
    expect(s.stacks[st.id].pos).toEqual({ kind: 'node', node: 13 });
  });

  it('interception: hostile air defence along the path creates a seeded risk; the preview only uses observed contacts', () => {
    const s = airGame();
    war(s, 'ARD', 'BOR');
    s.countries.ARD.modifiers.air_operational_range_mult = 1.5; // 600 km hops
    const st = place(s, 'ARD', 13, ['heli', 'inf', 'inf']);
    // a Borvian SAM battery right under the flight path 13 → 1 (north), not yet observed
    place(s, 'BOR', 7, ['sam', 'sam', 'sam']);
    const pre = validateCommand(s, { type: 'airmobile', country: 'ARD', stack: st.id, dest: 1 });
    expect(pre.ok).toBe(true);
    const truth = interceptionRisk(s, st, 13, 1);
    expect(truth.p).toBeGreaterThan(0.3);
    expect(truth.defenders).toEqual(['BOR']);
    // unobserved: the estimate does not leak the battery
    expect((pre as { preview: { riskEstimate: number; riskNote: string } }).preview.riskEstimate).toBe(0);
    expect((pre as { preview: { riskNote: string } }).preview.riskNote).toMatch(/unobserved/i);
    // observed: the estimate reflects it
    refreshVision(s);
    const seen = Object.values(s.contacts.ARD ?? {}).some((c) => c.owner === 'BOR' && c.level === 'identified');
    if (seen) expect((validateCommand(s, { type: 'airmobile', country: 'ARD', stack: st.id, dest: 1 }) as { preview: { riskEstimate: number } }).preview.riskEstimate).toBeGreaterThan(0);
  });

  it('interception outcome is a seeded draw: deterministic per seed and inflicts damage when it fires', () => {
    let intercepted = 0, clean = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const run = () => {
        const s = airGame(seed);
        war(s, 'ARD', 'BOR');
        s.countries.ARD.modifiers.air_operational_range_mult = 1.5;
        const st = place(s, 'ARD', 13, ['heli', 'inf', 'inf']);
        place(s, 'BOR', 7, ['sam', 'sam', 'sam']);
        const r = must(s, { type: 'airmobile', country: 'ARD', stack: st.id, dest: 1 });
        advance(s, (r.preview as { arriveAt: number }).arriveAt - s.clock.tick + 15, idle);
        return { s, id: st.id };
      };
      const a = run(), b = run();
      expect(stateHash(a.s)).toBe(stateHash(b.s));
      const hit = a.s.events.some((e) => e.kind === 'airmobile_intercepted');
      if (hit) {
        intercepted++;
        const left = a.s.stacks[a.id];
        if (left) expect(left.units.every((u) => u.hp < u.maxHp)).toBe(true);
        expect(a.s.events.some((e) => e.kind === 'airmobile_intercepted' && e.private.BOR)).toBe(true);
      } else clean++;
    }
    expect(intercepted).toBeGreaterThan(0);
    expect(clean).toBeGreaterThan(0);
  });

  it('determinism: a lift in flight survives save/reload and odd chunking with an identical stateHash', () => {
    const mk = () => {
      const s = airGame(9);
      war(s, 'ARD', 'BOR');
      s.countries.ARD.modifiers.air_operational_range_mult = 1.5;
      const st = place(s, 'ARD', 13, ['heli', 'inf', 'inf']);
      place(s, 'BOR', 7, ['sam']);
      must(s, { type: 'airmobile', country: 'ARD', stack: st.id, dest: 1 });
      return s;
    };
    const a = mk();
    advance(a, 600, idle);
    const b = mk();
    advance(b, 37, idle);
    const c = deserialize(serialize(b));
    advance(c, 101, idle);
    for (let i = 0; i < 462; i += 77) advance(c, Math.min(77, 462 - i), idle);
    expect(stateHash(c)).toBe(stateHash(a));
  });
});

describe('port blockade (AI request #12)', () => {
  function blockadeGame(): GameState {
    const s = newMiniGame({ seed: 5, human: 'ARD' });
    clearStacks(s);
    war(s, 'ARD', 'CEL');
    return s;
  }

  it('hostile warships off a port with no friendly naval presence blockade it: output cut, shipyards closed, journal and view explain it', () => {
    const s = blockadeGame();
    const city = s.cities['ARD-westport'];
    const before = cityOutput(s, city).money;
    place(s, 'CEL', N.S_SW, ['frigate'], 'CEL Raiders'); // sea zone 34 touches Westport (24)
    advance(s, 60, idle);
    expect(s.blockades['ARD-westport']).toMatchObject({ by: ['CEL'], zones: [N.S_SW] });
    expect(s.blockades['ARD-ardena']).toBeUndefined(); // Ardena's sea zone (30) is empty
    const after = cityOutput(s, city).money;
    expect(Math.abs(after - before * BLOCKADE.outputFactor)).toBeLessThanOrEqual(2); // milli rounding
    expect(after).toBeLessThan(before);
    // naval mobilization refused there, still allowed in an open port
    expect(validateCommand(s, { type: 'mobilize', country: 'ARD', unit: 'frigate', cities: ['ARD-westport'] })).toMatchObject({ ok: false });
    const why = validateCommand(s, { type: 'mobilize', country: 'ARD', unit: 'frigate', cities: ['ARD-westport'] });
    expect(JSON.stringify(why)).toMatch(/blockaded/);
    // journal + views: the victim is not told who blockades; the blockader is told whose port
    const ev = s.events.find((e) => e.kind === 'blockade_started')!;
    expect(ev.private.ARD.text).toMatch(/blockaded by hostile warships/);
    expect(ev.private.ARD.text).not.toMatch(/CEL/);
    expect(ev.private.CEL.text).toMatch(/Westport/);
    const va = getCountryView(s, 'ARD');
    expect(va.blockades).toEqual([{ city: 'ARD-westport', name: 'Westport', node: 24, since: s.blockades['ARD-westport'].since, role: 'blockaded', owner: 'ARD', outputFactor: BLOCKADE.outputFactor }]);
    expect(JSON.stringify(va.blockades)).not.toMatch(/CEL/);
    expect(getCountryView(s, 'CEL').blockades.map((b) => b.role)).toEqual(['enforcing']);
    expect(getCountryView(s, 'BOR').blockades).toEqual([]);
    expect(reconciled(s, 'ARD')).toBe(true);
  });

  it('a friendly ship in an adjacent zone lifts it; peace lifts it; deterministic across save/reload', () => {
    const s = blockadeGame();
    place(s, 'CEL', N.S_SW, ['frigate']);
    advance(s, 60, idle);
    expect(s.blockades['ARD-westport']).toBeDefined();
    const copy = deserialize(serialize(s));
    const relief = place(s, 'ARD', N.S_W, ['frigate'], 'Relief');
    place(copy, 'ARD', N.S_W, ['frigate'], 'Relief');
    advance(s, 60, idle);
    advance(copy, 60, idle);
    expect(s.blockades['ARD-westport']).toBeUndefined();
    expect(s.events.some((e) => e.kind === 'blockade_lifted' && e.private.ARD)).toBe(true);
    expect(stateHash(copy)).toBe(stateHash(s));
    // remove the relief: blockade returns; then peace ends it
    delete s.stacks[relief.id];
    advance(s, 60, idle);
    expect(s.blockades['ARD-westport']).toBeDefined();
    const r = must(s, { type: 'proposeOffer', country: 'ARD', to: 'CEL', give: [{ kind: 'peace' }], receive: [] });
    must(s, { type: 'respondOffer', country: 'CEL', offer: (r.result as { offer: string }).offer, accept: true });
    advance(s, 180, idle);
    expect(s.blockades['ARD-westport']).toBeUndefined();
  });
});

describe('peace settlements: territory, resources, haggling', () => {
  function warGame(): GameState {
    const s = newMiniGame({ seed: 11, human: null });
    war(s, 'ARD', 'BOR');
    return s;
  }

  it('validates territory clauses: peace required, giver must hold it, no capitals, no duplicates, never everything', () => {
    const s = warGame();
    const base = { type: 'proposeOffer' as const, country: 'ARD', to: 'BOR', give: [{ kind: 'peace' as const }], receive: [] };
    expect(validateCommand(s, { ...base, give: [], territory: { receive: [14] } })).toMatchObject({ ok: false, reason: expect.stringMatching(/peace settlement/) });
    expect(validateCommand(s, { ...base, territory: { receive: [N.borCapital] } })).toMatchObject({ ok: false, reason: expect.stringMatching(/capital/) });
    expect(validateCommand(s, { ...base, territory: { receive: [13] } })).toMatchObject({ ok: false, reason: expect.stringMatching(/does not hold/) });
    expect(validateCommand(s, { ...base, territory: { receive: [14, 14] } })).toMatchObject({ ok: false, reason: expect.stringMatching(/twice/) });
    expect(validateCommand(s, { ...base, territory: { receive: [N.S_W] } })).toMatchObject({ ok: false });
    expect(validateCommand(s, { ...base, territory: { receive: [1, 2, 3, 7, 9, 14, 15] } })).toMatchObject({ ok: false, reason: expect.stringMatching(/At most/) });
    expect(validateCommand(s, { ...base, territory: { receive: [14] } }).ok).toBe(true);
    // DUN (landlocked) holds 3 provinces; after losing its capital it cannot cede the last two
    war(s, 'ARD', 'DUN');
    expect(validateCommand(s, { ...base, to: 'DUN', territory: { receive: [21, 26] } }).ok).toBe(true);
    s.provinces[N.dunCapital]!.owner = 'ARD';
    s.ids.ownv = (s.ids.ownv ?? 0) + 1;
    expect(validateCommand(s, { ...base, to: 'DUN', territory: { receive: [21, 26] } })).toMatchObject({ ok: false, reason: expect.stringMatching(/every province/) });
  });

  it('haggling: counter-offers decline the previous round, rounds are capped, the accepted settlement transfers territory and resources after peace', () => {
    const s = warGame();
    const r1 = must(s, { type: 'proposeOffer', country: 'ARD', to: 'BOR', give: [{ kind: 'peace' }], receive: [{ kind: 'resource', resource: 'money', amount: 1_000_000 }], territory: { receive: [14, 15] } });
    const o1 = (r1.result as { offer: string }).offer;
    expect(s.offers[o1].territory).toEqual({ give: [], receive: [14, 15] });
    expect(s.messages['dm:ARD|BOR'].some((m) => m.offer === o1 && /cession of/.test(m.text))).toBe(true);
    // only the recipient can counter, and only back to the sender
    expect(validateCommand(s, { type: 'proposeOffer', country: 'DUN', to: 'ARD', give: [], receive: [{ kind: 'resource', resource: 'money', amount: 1000 }], counterTo: o1 })).toMatchObject({ ok: false, code: 'not_recipient' });
    const r2 = must(s, { type: 'proposeOffer', country: 'BOR', to: 'ARD', give: [{ kind: 'peace' }, { kind: 'resource', resource: 'money', amount: 300_000 }], receive: [], counterTo: o1 });
    const o2 = (r2.result as { offer: string }).offer;
    expect(s.offers[o1].status).toBe('declined');
    expect(s.offers[o1].responseReason).toMatch(/countered/);
    expect(s.offers[o2]).toMatchObject({ round: 2, counterOf: o1, status: 'pending' });
    const r3 = must(s, { type: 'proposeOffer', country: 'ARD', to: 'BOR', give: [{ kind: 'peace' }], receive: [{ kind: 'resource', resource: 'money', amount: 500_000 }], territory: { receive: [15] }, counterTo: o2 });
    const o3 = (r3.result as { offer: string }).offer;
    const r4 = must(s, { type: 'proposeOffer', country: 'BOR', to: 'ARD', give: [{ kind: 'peace' }, { kind: 'resource', resource: 'money', amount: 400_000 }], receive: [], territory: { give: [15] }, counterTo: o3 });
    const o4 = (r4.result as { offer: string }).offer;
    expect(s.offers[o4].round).toBe(PEACE.maxRounds);
    expect(validateCommand(s, { type: 'proposeOffer', country: 'ARD', to: 'BOR', give: [{ kind: 'peace' }], receive: [], counterTo: o4 })).toMatchObject({ ok: false, code: 'negotiation_limit' });
    // accept the final round
    const borMoney = s.countries.BOR.stock.money, ardMoney = s.countries.ARD.stock.money;
    must(s, { type: 'respondOffer', country: 'ARD', offer: o4, accept: true });
    expect(s.countries.BOR.stock.money).toBe(borMoney - 400_000);
    expect(s.countries.ARD.stock.money).toBe(ardMoney + 400_000);
    expect(s.provinces[15]!.owner).toBe('BOR'); // territory moves at the effective time
    advance(s, 61, idle);
    expect(s.relations['ARD|BOR'].war).toBe(false);
    expect(s.provinces[15]!.owner).toBe('ARD');
    expect(s.provinces[15]!.status).toBe('annexed');
    expect(s.events.some((e) => e.kind === 'territory_ceded' && e.node === 15 && e.public)).toBe(true);
    expect(reconciled(s, 'ARD') && reconciled(s, 'BOR')).toBe(true);
  });

  it('a cession is refused at acceptance if the giver lost the province meanwhile, and survives save/reload while pending', () => {
    const s = warGame();
    const r = must(s, { type: 'proposeOffer', country: 'ARD', to: 'BOR', give: [{ kind: 'peace' }], receive: [], territory: { receive: [14] } });
    const id = (r.result as { offer: string }).offer;
    const loaded = deserialize(serialize(s));
    expect(loaded.offers[id].territory).toEqual({ give: [], receive: [14] });
    expect(stateHash(loaded)).toBe(stateHash(s));
    // DUN takes the province from BOR before BOR answers
    war(s, 'DUN', 'BOR');
    clearStacks(s, 'BOR');
    place(s, 'DUN', 14, ['inf']);
    advance(s, 15, idle);
    expect(s.provinces[14]!.owner).toBe('DUN');
    const v = validateCommand(s, { type: 'respondOffer', country: 'BOR', offer: id, accept: true });
    expect(v).toMatchObject({ ok: false, reason: expect.stringMatching(/does not hold/) });
  });
});

describe('save migration v1 → v2', () => {
  it('adds the blockade section and keeps the state hash of a v1 save', () => {
    const s = newMiniGame({ seed: 3 });
    advance(s, 240, idle);
    const env = JSON.parse(serialize(s));
    env.schemaVersion = 1;
    env.state.schemaVersion = 1;
    delete env.state.blockades;
    const loaded = deserialize(JSON.stringify(env));
    expect(loaded.schemaVersion).toBe(SCHEMA_VERSION);
    expect(loaded.blockades).toEqual({});
    const ref = cloneState(s);
    expect(stateHash(loaded)).toBe(stateHash(ref));
    const m = migrate(JSON.parse(JSON.stringify(env.state)));
    expect(JSON.stringify(migrate(m))).toBe(JSON.stringify(m));
    // the resumed run equals the uninterrupted one
    advance(loaded, 300, idle);
    advance(s, 300, idle);
    expect(stateHash(loaded)).toBe(stateHash(s));
    void submitCommand;
  });
});
