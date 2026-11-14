/**
 * AI use of the engine features pass: peace terms with territory/resources and multi-round
 * haggling, air-mobile reinforcement, breaking a blockade of an own port.
 */
import { describe, expect, it } from 'vitest';
import { advance, IdleController, submitCommand, validateCommand } from '../../src/engine';
import type { Command, GameState } from '../../src/engine';
import { newMiniGame, N } from '../fixtures/mini-world';
import { clearStacks, must, place, refreshVision, war } from '../fixtures/helpers';
import { UtilityController, getDecisionLog } from '../../src/ai';
import { decideOnce, recording } from './helpers';
import { bumpEconomy } from '../../src/engine/systems/economy';

/** BOR loses five provinces to ARD (as if captured): a clear ARD advantage. */
function lopsidedWar(seed = 13): GameState {
  const s = newMiniGame({ seed, human: null });
  war(s, 'ARD', 'BOR');
  for (const n of [1, 2, 7, 13 + 1, 9]) {
    const p = s.provinces[n]!;
    if (p.owner !== 'BOR') continue;
    p.owner = 'ARD';
    p.status = 'occupied';
    p.changedAt = s.clock.tick;
  }
  s.ids.ownv = (s.ids.ownv ?? 0) + 1;
  bumpEconomy(s);
  return s;
}

describe('AI peace terms and haggling (SPEC §4 peace policy)', () => {
  it('the winner answers a bare peace offer with a counter-offer demanding territory/reparations; the reason is logged', () => {
    const s = lopsidedWar();
    const r = must(s, { type: 'proposeOffer', country: 'BOR', to: 'ARD', give: [{ kind: 'peace' }], receive: [] });
    const id = (r.result as { offer: string }).offer;
    const { cmds, results } = decideOnce(s, 'ARD', ['operational'], { wake: [`offer:${id}`] });
    const counter = cmds.find((c) => c.type === 'proposeOffer' && c.counterTo === id) as Extract<Command, { type: 'proposeOffer' }> | undefined;
    expect(counter, JSON.stringify(cmds)).toBeTruthy();
    expect(results.every((x) => x.ok)).toBe(true);
    // proportional demands: border provinces they still hold and/or reparations
    const demands = (counter!.territory?.receive?.length ?? 0) + counter!.receive.filter((t) => t.kind === 'resource').length;
    expect(demands).toBeGreaterThan(0);
    expect(counter!.reason).toMatch(/counter-offer \(round 2\/4\)/);
    expect(s.offers[id].status).toBe('declined');
    const next = Object.values(s.offers).find((o) => o.counterOf === id)!;
    expect(next.round).toBe(2);
    expect(getDecisionLog('ARD').some((e) => e.kind === 'counter_offer')).toBe(true);
  });

  it('two bots haggle to a settlement (or a reasoned final decline) within the round limit; every command validates', () => {
    const s = lopsidedWar(17);
    const { ctl, log } = recording();
    const r = must(s, { type: 'proposeOffer', country: 'BOR', to: 'ARD', give: [{ kind: 'peace' }], receive: [] });
    const first = (r.result as { offer: string }).offer;
    advance(s, 2 * 1440, { fallback: ctl });
    // follow the chain
    const chain = [s.offers[first]];
    for (;;) {
      const nx = Object.values(s.offers).find((o) => o.counterOf === chain[chain.length - 1].id);
      if (!nx) break;
      chain.push(nx);
    }
    expect(chain.length).toBeGreaterThan(1);
    expect(chain.length).toBeLessThanOrEqual(4);
    expect(chain.map((o) => o.round ?? 1)).toEqual(chain.map((_, i) => i + 1));
    const last = chain[chain.length - 1];
    expect(['accepted', 'declined', 'pending']).toContain(last.status);
    if (last.status !== 'pending') expect(last.responseReason).toBeTruthy();
    // no invalid bot command in the whole run
    for (const c of ['ARD', 'BOR']) expect(Object.values(s.countries[c].stats.rejected).reduce((a, b) => a + b, 0)).toBe(0);
    expect(log.filter((x) => x.cmd.type === 'proposeOffer' && x.cmd.counterTo).length).toBe(chain.length - 1);
  });

  it('a losing bot accepts a human settlement that cedes a border province, and the province changes hands after peace', () => {
    const s = newMiniGame({ seed: 23, human: 'ARD' });
    war(s, 'ARD', 'DUN');
    // DUN has lost its capital already and its forces are gone: the war is hopeless for it
    clearStacks(s, 'DUN');
    const cap = s.provinces[N.dunCapital]!;
    cap.owner = 'ARD';
    cap.status = 'occupied';
    s.ids.ownv = (s.ids.ownv ?? 0) + 1;
    bumpEconomy(s);
    (s.ai.memory.DUN as unknown) = null;
    advance(s, 60, { fallback: UtilityController }); // DUN's memory registers the loss
    const r = must(s, { type: 'proposeOffer', country: 'ARD', to: 'DUN', give: [{ kind: 'peace' }], receive: [], territory: { receive: [21] } });
    const id = (r.result as { offer: string }).offer;
    advance(s, 3 * 60, { fallback: UtilityController });
    const o = s.offers[id];
    const counter = Object.values(s.offers).find((x) => x.counterOf === id);
    expect(o.status === 'accepted' || !!counter).toBe(true);
    if (o.status === 'accepted') {
      expect(o.responseReason).toMatch(/no longer pays off/);
      advance(s, 120, { fallback: UtilityController });
      expect(s.provinces[21]!.owner).toBe('ARD');
      expect(s.relations['ARD|DUN'].war).toBe(false);
    } else {
      // a counter must still be a legal settlement the human can accept
      expect(validateCommand(s, { type: 'respondOffer', country: 'ARD', offer: counter!.id, accept: true }).ok).toBe(true);
    }
  });
});

describe('AI air-mobile reinforcement', () => {
  it('lifts an idle helicopter group to a threatened city that land reinforcements reach slowly', () => {
    const s = newMiniGame({ seed: 31, human: null });
    clearStacks(s);
    war(s, 'ARD', 'BOR');
    s.countries.ARD.modifiers.air_operational_range_mult = 2.5; // 1,000 km hops in the small fixture
    const group = place(s, 'ARD', 0, ['heli', 'inf', 'inf'], 'Air Assault Group');
    place(s, 'ARD', N.ardCapital, ['tank', 'tank', 'tank', 'tank', 'inf', 'inf', 'inf', 'inf'], 'Capital Garrison');
    // Borvian infantry next to Westport (24), 4 land hops from node 0
    place(s, 'BOR', 25, ['inf', 'inf', 'inf']);
    refreshVision(s);
    const { cmds, results } = decideOnce(s, 'ARD', ['operational'], { wake: ['war_declared'] });
    const lift = cmds.find((c) => c.type === 'airmobile' && c.stack === group.id) as Extract<Command, { type: 'airmobile' }> | undefined;
    expect(lift, JSON.stringify(cmds.map((c) => c.type))).toBeTruthy();
    expect(lift!.dest).toBe(N.ardWestport);
    expect(lift!.reason).toMatch(/air-mobile reinforcement/);
    expect(results.every((x) => x.ok)).toBe(true);
    expect(s.stacks[group.id].pos.kind).toBe('air');
    const arrive = (s.stacks[group.id].pos as { arrive: number }).arrive;
    advance(s, arrive - s.clock.tick + 15, { fallback: IdleController });
    expect(s.stacks[group.id]?.pos).toEqual({ kind: 'node', node: N.ardWestport });
  });

  it('skips a hop through observed air defence above the risk limit', () => {
    const s = newMiniGame({ seed: 31, human: null });
    clearStacks(s);
    war(s, 'ARD', 'BOR');
    s.countries.ARD.modifiers.air_operational_range_mult = 2.5;
    const group = place(s, 'ARD', 0, ['heli', 'inf', 'inf']);
    place(s, 'ARD', N.ardCapital, ['tank', 'tank', 'tank', 'tank', 'inf', 'inf', 'inf', 'inf'], 'Capital Garrison');
    place(s, 'BOR', 25, ['inf', 'inf', 'inf']);
    place(s, 'BOR', 12, ['sam', 'sam', 'sam', 'sam']); // right under the path 0 → 24, observed in Ardena
    refreshVision(s);
    const { cmds } = decideOnce(s, 'ARD', ['operational'], { wake: ['war_declared'] });
    expect(cmds.some((c) => c.type === 'airmobile' && c.stack === group.id)).toBe(false);
  });
});

describe('AI and blockades', () => {
  it('sends a ship to break the blockade of its own port', () => {
    const s = newMiniGame({ seed: 41, human: null });
    clearStacks(s);
    war(s, 'ARD', 'CEL');
    place(s, 'CEL', N.S_SW, ['frigate']);
    const fleet = place(s, 'ARD', N.ardCapital, ['frigate', 'frigate'], 'Home Fleet');
    advance(s, 60, { fallback: IdleController });
    expect(s.blockades['ARD-westport']).toBeDefined();
    refreshVision(s);
    const { cmds, results } = decideOnce(s, 'ARD', ['operational']);
    const mv = cmds.find((c) => c.type === 'move' && c.stack === fleet.id) as Extract<Command, { type: 'move' }> | undefined;
    expect(mv, JSON.stringify(cmds)).toBeTruthy();
    expect([N.S_W, N.S_SW]).toContain(mv!.dest);
    expect(results.every((x) => x.ok)).toBe(true);
    void submitCommand;
  });
});
