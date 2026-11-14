import { describe, expect, it } from 'vitest';
import type { Command, GameState } from '../../src/engine';
import { newMiniGame } from '../fixtures/mini-world';
import { clearStacks, must, place, refreshVision, setStock, war } from '../fixtures/helpers';
import { getDecisionLog } from '../../src/ai';
import { decideOnce, memoryOf, DAY } from './helpers';
import { createCoalitionInternal, joinCoalitionInternal } from '../../src/engine/systems/coalitions';
import { invalidateViewCache } from '../../src/engine/view/country-view';
import { atWar } from '../../src/engine/systems/world';

/** BOR (leader) + DUN in one bloc; FAL at war with DUN, massing inside Dunmark next to its capital Dunholm (node 20). */
function besiegedPartner(seed = 2) {
  const s = newMiniGame({ human: null, seed });
  const co = createCoalitionInternal(s, 'BOR', 'Northern League', '', 'star');
  expect(joinCoalitionInternal(s, co.id, 'DUN', 'test')).toBe(true);
  clearStacks(s, 'DUN');
  place(s, 'DUN', 20, ['inf'], 'Dunholm Guard');
  // Borvia keeps its own capital covered and has a reserve one hop from Dunholm
  place(s, 'BOR', 8, ['tank', 'tank'], 'Borgrad Armour');
  const reserve = place(s, 'BOR', 14, ['inf', 'inf', 'tank'], 'Borvian Reserve');
  war(s, 'FAL', 'DUN');
  place(s, 'FAL', 21, ['inf', 'inf', 'tank', 'tank', 'inf'], 'Falen Assault Group');
  refreshVision(s);
  return { s, co, reserve };
}

const movesTo = (cmds: Command[], dest: number) => cmds.filter((c): c is Extract<Command, { type: 'move' }> => c.type === 'move').filter((m) => m.dest === dest);

describe('AI coalition mutual defence', () => {
  it("a partner's threatened capital draws a reinforcement from a capable coalition member", () => {
    const { s, reserve } = besiegedPartner();
    const { cmds, results } = decideOnce(s, 'BOR', ['strategic', 'operational']);
    const m = movesTo(cmds, 20);
    expect(m.map((x) => x.stack)).toContain(reserve.id);
    expect(results.every((r) => r.ok)).toBe(true);
    // combat only happens between belligerents: BOR joins DUN's war against the attacker first
    expect(cmds.findIndex((c) => c.type === 'declareWar' && c.target === 'FAL')).toBeLessThan(cmds.findIndex((c) => c.type === 'move' && c.dest === 20));
    expect(atWar(s, 'BOR', 'FAL')).toBe(true);
    expect(getDecisionLog('BOR').find((e) => e.kind === 'join_defence')?.reason).toMatch(/join the defence of DUN against FAL/);
    // its own capital garrison stays home
    expect(cmds.some((c) => c.type === 'move' && (c as { stack: string }).stack !== reserve.id && s.stacks[(c as { stack: string }).stack]?.pos.kind === 'node' && (s.stacks[(c as { stack: string }).stack].pos as { node: number }).node === 8 && (c as { dest: number }).dest === 20)).toBe(false);
    const log = getDecisionLog('BOR').find((e) => e.kind === 'ally_defend');
    expect(log?.reason).toMatch(/defend partner DUN capital Dunholm/);
    const mem = memoryOf(s, 'BOR');
    expect(mem.commitments.DUN?.node).toBe(20);
    expect(mem.commitments.DUN?.stacks).toContain(reserve.id);
    // the commitment window holds the formation: a second review does not re-task it
    const again = decideOnce(s, 'BOR', ['operational']);
    expect(again.cmds.filter((c) => c.type === 'move' && (c as { stack: string }).stack === reserve.id)).toEqual([]);
  });

  it('a member whose own capital is exposed keeps its forces home and says so', () => {
    const { s } = besiegedPartner();
    war(s, 'FAL', 'BOR');
    place(s, 'FAL', 9, ['tank', 'tank', 'tank', 'inf', 'inf'], 'Falen Northern Group');
    refreshVision(s);
    const { cmds } = decideOnce(s, 'BOR', ['strategic', 'operational'], { wake: ['war_declared:e1'] });
    expect(movesTo(cmds, 20)).toEqual([]);
    expect(getDecisionLog('BOR').some((e) => e.kind === 'ally_defence_declined' && /home defence first/.test(e.reason))).toBe(true);
  });

  it('the besieged member asks the bloc for help; the partner accepts and honours the request', () => {
    const { s, co, reserve } = besiegedPartner(3);
    const dun = decideOnce(s, 'DUN', ['strategic', 'operational'], { wake: ['war_declared:e1'] });
    expect(dun.cmds.some((c) => c.type === 'sendMessage' && (c as { intent?: string }).intent === 'request_operation')).toBe(true);
    const req = (s.messages[`co:${co.id}`] ?? []).find((m) => m.from === 'DUN' && m.intent === 'request_operation');
    expect(req?.reason).toMatch(/defend Dunholm \(node 20\) against FAL/);
    expect(memoryOf(s, 'DUN').help?.node).toBe(20);
    const bor = decideOnce(s, 'BOR', ['operational']);
    const reply = Object.values(s.messages).flat().find((m) => m.from === 'BOR' && m.intent === 'accept');
    expect(reply?.reason).toMatch(/help defend Dunholm/);
    expect(memoryOf(s, 'BOR').assist.some((x) => x.partner === 'DUN' && x.node === 20)).toBe(true);
    expect(movesTo(bor.cmds, 20).map((x) => x.stack)).toContain(reserve.id);
    expect(getDecisionLog('BOR').some((e) => e.kind === 'ally_defend' && /honour request/.test(e.reason))).toBe(true);
    // DUN records the promise
    decideOnce(s, 'DUN', ['diplomatic']);
    expect(memoryOf(s, 'DUN').help?.accepted).toContain('BOR');
  });

  it('a defence request from a country outside the bloc is declined with a reason', () => {
    const { s } = besiegedPartner();
    must(s, { type: 'sendMessage', country: 'CEL', to: 'BOR', intent: 'request_operation', text: 'Please defend Celesta against ARD.' });
    decideOnce(s, 'BOR', ['operational']);
    const reply = (s.messages['dm:BOR|CEL'] ?? []).find((m) => m.from === 'BOR');
    expect(reply?.intent).toBe('decline');
    expect(reply?.reason).toMatch(/no mutual-defence commitment/);
  });

  it('broken commitments become grievances; kept ones become favours', () => {
    const { s } = besiegedPartner();
    decideOnce(s, 'DUN', ['strategic', 'diplomatic']);
    const mem0 = s.ai.memory.DUN as { help: unknown; grievance: Record<string, number> };
    const g0 = mem0.grievance.ESK ?? 0;
    // DUN asked for help two days ago; BOR and ESK both promised it. Only BOR's formation came.
    mem0.help = { at: s.clock.tick - 2 * DAY, node: 20, foe: 'FAL', until: s.clock.tick, accepted: ['BOR', 'ESK'], arrived: [] };
    const co = Object.values(s.coalitions)[0];
    expect(joinCoalitionInternal(s, co.id, 'ESK', 'test')).toBe(true);
    place(s, 'BOR', 20, ['inf', 'tank'], 'Borvian Relief');
    refreshVision(s);
    decideOnce(s, 'DUN', ['diplomatic']);
    const mem = memoryOf(s, 'DUN');
    expect(mem.help).toBeNull();
    expect((mem.grievance.ESK ?? 0) - g0).toBeGreaterThanOrEqual(9.9);
    expect(mem.favour.BOR ?? 0).toBeGreaterThan(0);
    expect(getDecisionLog('DUN').some((e) => e.kind === 'broken_commitment' && /ESK accepted our call/.test(e.reason))).toBe(true);
  });
});

/** Dunmark with a fuel deficit created by fielded armour (upkeep) and almost no fuel left. */
function fuelShort(tanks: number, seed = 13): GameState {
  const s = newMiniGame({ human: null, seed });
  clearStacks(s, 'DUN');
  for (let i = 0; i < tanks / 5; i++) place(s, 'DUN', i % 2 ? 26 : 20, ['tank', 'tank', 'tank', 'tank', 'tank']);
  setStock(s, 'DUN', { fuel: 20, supplies: 20000, components: 6000, money: 40000 });
  invalidateViewCache(s); // upkeep rates of the placed armour
  return s;
}
function tradeOffer(s: GameState) {
  const { cmds } = decideOnce(s, 'DUN', ['strategic', 'diplomatic']);
  return cmds.find((c) => c.type === 'proposeOffer' && c.receive.some((x) => x.kind === 'resource')) as Extract<(typeof cmds)[number], { type: 'proposeOffer' }> | undefined;
}

describe('AI trade agreements sized to surplus and deficit', () => {
  it('asks for what covers the forecast deficit and pays from actual surpluses', () => {
    const s = fuelShort(30);
    const offer = tradeOffer(s);
    expect(offer).toBeTruthy();
    const want = offer!.receive.find((x) => x.kind === 'resource') as { resource: string; amount: number };
    expect(want.resource).toBe('fuel');
    expect(want.amount).not.toBe(100_000); // no fixed-size swap
    expect(want.amount % 1000).toBe(0);
    // every resource given comes from a surplus, never from the deficit resource, within stock
    for (const g of offer!.give) {
      expect(g.kind).toBe('resource');
      const r = g as { resource: 'supplies' | 'components' | 'money' | 'fuel'; amount: number };
      expect(r.resource).not.toBe('fuel');
      expect(r.amount).toBeLessThanOrEqual(s.countries.DUN.stock[r.resource]);
    }
    expect(offer!.reason).toMatch(/cover fuel deficit of \d+ over 6 days/);
    // value-balanced: what we give is worth the reference value of what we receive + 25 %
    const price: Record<string, number> = { supplies: 1, components: 2, electronics: 4, fuel: 1.5, rare: 5, manpower: 1, money: 1 };
    const giveV = offer!.give.reduce((a, g) => a + ((g as { amount: number }).amount / 1000) * price[(g as { resource: string }).resource], 0);
    const wantV = (want.amount / 1000) * price.fuel * 1.25;
    expect(giveV).toBeGreaterThanOrEqual(wantV - 0.01);
    expect(giveV).toBeLessThanOrEqual(wantV + 5);
  });

  it('a larger deficit asks for more; a thin surplus scales the request down', () => {
    const small = tradeOffer(fuelShort(20))!;
    const large = tradeOffer(fuelShort(60))!;
    const amt = (o: NonNullable<ReturnType<typeof tradeOffer>>) => (o.receive.find((x) => x.kind === 'resource') as { amount: number }).amount;
    expect(amt(large)).toBeGreaterThan(amt(small));
    // same deficit, but almost nothing to pay with → a smaller (affordable) request
    const poor = fuelShort(60);
    setStock(poor, 'DUN', { supplies: 900, components: 300, money: 3000, manpower: 200, electronics: 50, rare: 10 });
    invalidateViewCache(poor);
    const p = tradeOffer(poor);
    expect(p).toBeTruthy();
    expect(amt(p!)).toBeLessThan(amt(large));
    for (const g of p!.give) expect((g as { amount: number }).amount).toBeLessThanOrEqual(poor.countries.DUN.stock[(g as { resource: 'supplies' }).resource]);
  });

  it('the recipient refuses to give beyond its own reserve and says so', () => {
    const s = newMiniGame({ human: 'ARD', seed: 4 });
    const r = must(s, { type: 'proposeOffer', country: 'ARD', to: 'CEL', give: [{ kind: 'resource', resource: 'money', amount: 2_000_000 }], receive: [{ kind: 'resource', resource: 'fuel', amount: 2_400_000 }] });
    const id = (r.result as { offer: string }).offer;
    decideOnce(s, 'CEL', ['diplomatic']);
    expect(s.offers[id].status).toBe('declined');
    expect(s.offers[id].responseReason).toMatch(/beyond our reserve/);
  });
});

describe('AI naval escort, blockade and carriers', () => {
  it('a warship escorts an embarked formation at sea', () => {
    const s = newMiniGame({ human: null, seed: 6 });
    clearStacks(s, 'ARD');
    const ships = place(s, 'ARD', 24, ['frigate', 'frigate'], 'Western Squadron');
    const convoy = place(s, 'ARD', 30, ['inf', 'inf'], '2nd Landing Group');
    expect(s.stacks[convoy.id].mode).toBe('embarked');
    refreshVision(s);
    const { cmds, results } = decideOnce(s, 'ARD', ['strategic', 'operational']);
    expect(cmds.some((c) => c.type === 'move' && c.stack === ships.id && c.dest === 30)).toBe(true);
    expect(results.every((x) => x.ok)).toBe(true);
    expect(getDecisionLog('ARD').some((e) => e.kind === 'escort')).toBe(true);
  });

  it('blockades an enemy port only with sea superiority', () => {
    const s = newMiniGame({ human: null, seed: 6 });
    clearStacks(s, 'ARD');
    const sq = place(s, 'ARD', 24, ['frigate'], 'Western Squadron');
    war(s, 'ARD', 'FAL');
    place(s, 'FAL', 33, ['frigate', 'frigate'], 'Falen Home Fleet');
    refreshVision(s);
    const weak = decideOnce(s, 'ARD', ['strategic', 'operational'], { submit: false });
    expect(weak.cmds.some((c) => c.type === 'move' && c.stack === sq.id)).toBe(false);
    expect(getDecisionLog('ARD').some((e) => e.kind === 'blockade_held' && /no sea superiority/.test(e.reason))).toBe(true);
    // reinforce: four more frigates → superiority → blockade from the sea zone off the port
    place(s, 'ARD', 24, ['frigate', 'frigate', 'frigate', 'frigate'], 'Second Squadron');
    refreshVision(s);
    const strong = decideOnce(s, 'ARD', ['operational']);
    const bl = strong.cmds.filter((c) => c.type === 'move') as { stack: string; dest: number }[];
    expect(bl.length).toBeGreaterThan(0);
    expect(strong.results.every((x) => x.ok)).toBe(true);
    const e = getDecisionLog('ARD').find((x) => x.kind === 'blockade');
    expect(e?.reason).toMatch(/blockade FAL port .* sea superiority/);
  });

  it('carrier-qualified aircraft embark on a carrier with free deck slots', () => {
    const s = newMiniGame({ human: null, seed: 6 });
    clearStacks(s, 'ARD');
    const cv = place(s, 'ARD', 12, ['carrier', 'frigate'], 'Carrier Group');
    const wing = place(s, 'ARD', 12, ['fighter', 'fighter'], '1st Air Wing');
    place(s, 'ARD', 12, ['bomber'], 'Heavy Wing');
    refreshVision(s);
    const { cmds, results } = decideOnce(s, 'ARD', ['strategic', 'operational']);
    const rb = cmds.filter((c) => c.type === 'rebase') as { stack: string; base: { stack?: string } }[];
    expect(rb.some((c) => c.stack === wing.id && c.base.stack === cv.id)).toBe(true);
    // the bomber family is not carrier-capable in this catalog: never offered a deck
    expect(rb.every((c) => c.stack === wing.id)).toBe(true);
    expect(results.every((x) => x.ok)).toBe(true);
    expect(s.stacks[wing.id].air?.state).not.toBe('landed');
  });
});

describe('alliance layer keeps the contract', () => {
  it('zero invalid commands in a mini campaign with a bloc under attack', async () => {
    const { s } = besiegedPartner(9);
    const { advance } = await import('../../src/engine');
    const { UtilityController } = await import('../../src/ai');
    advance(s, 3 * DAY, { fallback: UtilityController });
    for (const c of s.countryOrder) expect(Object.values(s.countries[c].stats.rejected).reduce((x, y) => x + y, 0), `${c} ${JSON.stringify(s.countries[c].stats.rejected)}`).toBe(0);
  });
});
