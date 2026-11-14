/**
 * Caches and scheduler hooks added for the planner-cost pass (docs/ENGINE.md "AI-phase cost"):
 * every memo must equal a naive recomputation, lite views must equal full views minus the skipped
 * fields, the `wants` pre-check and message wakes must be deterministic, and a stack stranded on an
 * edge with both ends illegal must settle once (no route flip-flop).
 */
import { describe, expect, it } from 'vitest';
import { advance, BasicController, deserialize, getCountryView, serialize, stateHash, submitCommand } from '../../src/engine';
import type { CountryController, PlannerContext, WantsInfo } from '../../src/engine';
import type { GameState, MarketOrder } from '../../src/engine/state';
import { RESOURCES } from '../../src/engine/data-types';
import { bookView, ordersOf, openOrderCount } from '../../src/engine/systems/market';
import { invalidateViewCache, journalFor } from '../../src/engine/view/country-view';
import { makePeace, trustOf, trustRow, addTrust } from '../../src/engine/systems/diplomacy';
import { streamRng } from '../../src/engine/rng';
import { newMiniGame } from '../fixtures/mini-world';
import { clearStacks, grant, must, place, setStock, war } from '../fixtures/helpers';

function naiveBook(s: GameState, r: string) {
  const agg = (side: 'buy' | 'sell') => {
    const m = new Map<number, { price: number; qty: number; orders: number }>();
    for (const o of Object.values(s.market.orders)) {
      if (o.status !== 'open' || o.resource !== r || o.side !== side) continue;
      const l = m.get(o.price) ?? { price: o.price, qty: 0, orders: 0 };
      l.qty += o.qty - o.filled;
      l.orders++;
      m.set(o.price, l);
    }
    return [...m.values()].sort((a, b) => (side === 'buy' ? b.price - a.price : a.price - b.price));
  };
  return { bids: agg('buy'), asks: agg('sell'), last: s.market.lastPrice[r as 'fuel'] ?? null };
}
function checkMarket(s: GameState) {
  for (const r of RESOURCES) if (r !== 'money') expect(JSON.parse(JSON.stringify(bookView(s, r)))).toEqual(naiveBook(s, r));
  for (const c of s.countryOrder) {
    const naive: MarketOrder[] = Object.values(s.market.orders).filter((o) => o.country === c);
    expect(ordersOf(s, c).map((o) => o.id)).toEqual(naive.map((o) => o.id));
    expect(openOrderCount(s, c)).toBe(naive.filter((o) => o.status === 'open').length);
  }
}

describe('engine caches for the AI phase', () => {
  it('market: the incremental open-order index and cached books equal a full scan (place, fill, cancel, prune, reload)', () => {
    const s = newMiniGame({ human: null, seed: 5 });
    for (const c of s.countryOrder) setStock(s, c, { money: 1_000_000, fuel: 5_000, supplies: 5_000, electronics: 2_000 });
    const rng = streamRng(9, 'test', 'market');
    const res = ['fuel', 'supplies', 'electronics'] as const;
    for (let i = 0; i < 160; i++) {
      const c = s.countryOrder[Math.floor(rng.next() * s.countryOrder.length)];
      if (rng.next() < 0.25) {
        const open = ordersOf(s, c).filter((o) => o.status === 'open');
        if (open.length) submitCommand(s, { type: 'cancelMarketOrder', country: c, order: open[0].id });
      } else {
        submitCommand(s, { type: 'marketOrder', country: c, side: rng.next() < 0.5 ? 'buy' : 'sell', resource: res[Math.floor(rng.next() * 3)], qty: 1 + Math.floor(rng.next() * 40), price: 800 + Math.floor(rng.next() * 400) });
      }
      if (i % 20 === 0) checkMarket(s);
      if (i === 80) advance(s, 4 * 1440); // day changes prune closed orders
    }
    checkMarket(s);
    const loaded = deserialize(serialize(s));
    checkMarket(loaded);
    expect(stateHash(loaded)).toBe(stateHash(s));
  });

  it('lite views equal full views except the documented skipped fields', () => {
    const s = newMiniGame({ human: 'ARD', seed: 3 });
    advance(s, 2 * 1440, { fallback: BasicController });
    for (const c of s.countryOrder) {
      const full = JSON.parse(JSON.stringify(getCountryView(s, c, { journalLimit: 15, journalScan: 400 })));
      const lite = JSON.parse(JSON.stringify(getCountryView(s, c, { journalLimit: 15, journalScan: 400, lite: true })));
      expect(lite.lite).toBe(true);
      expect(lite.observedNodes).toEqual([]);
      expect(lite.market.myFills).toEqual([]);
      expect(lite.self.force.fielded).toBe(0);
      for (const v of [full, lite]) {
        delete v.lite;
        delete v.observedNodes;
        delete v.market.myFills;
        delete v.self.force;
        delete v.self.lift;
        delete v.self.liftBreakdown;
        for (const st of v.stacks) {
          delete st.sightKm;
          delete st.radarKm;
        }
      }
      expect(lite).toEqual(full);
    }
  });

  it('journal index equals a scan of the event log for any limit/window', () => {
    const s = newMiniGame({ human: 'ARD', seed: 4 });
    advance(s, 3 * 1440, { fallback: BasicController });
    const naive = (c: string, limit: number, scan: number) => {
      const out: string[] = [];
      for (let i = s.events.length - 1; i >= 0 && out.length < limit && s.events.length - i <= scan; i--) if (s.events[i].private[c]) out.push(s.events[i].id);
      return out;
    };
    for (const c of s.countryOrder) for (const [limit, scan] of [[15, 400], [40, 4000], [5, 20], [200, s.events.length]] as const) {
      expect(journalFor(s, c, limit, scan).map((e) => e.id)).toEqual(naive(c, limit, scan));
    }
    // after pruning the front of the log the index still agrees
    s.events.splice(0, Math.floor(s.events.length / 2));
    advance(s, 60, { fallback: BasicController });
    for (const c of s.countryOrder) expect(journalFor(s, c, 40, 4000).map((e) => e.id)).toEqual(naive(c, 40, 4000));
  });

  it('trust rows equal per-pair trustOf (lazy, decayed and event-touched pairs)', () => {
    const s = newMiniGame({ human: 'ARD', seed: 6 });
    addTrust(s, 'ARD', 'BOR', -20, 'test', 'test');
    s.trust['DUN>BOR'] = { value: -40, history: [] }; // direct edit (tests do this) is seen live
    advance(s, 3 * 1440);
    for (const a of s.countryOrder) {
      const row = trustRow(s, a);
      s.countryOrder.forEach((b, i) => expect(row[i]).toBe(a === b ? 0 : trustOf(s, a, b)));
    }
    const rel = getCountryView(s, 'ARD').relations.find((r) => r.country === 'BOR')!;
    expect(rel.trustHistory?.map((h) => h.kind)).toEqual(['test']);
    expect(Object.keys(rel.trustHistory![0]).sort()).toEqual(['at', 'delta', 'kind']); // no free-text reason
  });

  it('wants() pre-check: declined calls build no view; the hook sees the saved memory; deterministic across save/reload', () => {
    const calls: { c: string; reviews: string[]; wake: string[]; hadMemory: boolean }[] = [];
    const seen: WantsInfo[] = [];
    const ctl: CountryController = {
      liteView: true,
      wants(info) {
        seen.push(info);
        // skip operational-only calls without wakes once we have memory
        return !(info.memory && info.wake.length === 0 && info.reviews.length === 1 && info.reviews[0] === 'operational');
      },
      decide(view, ctx: PlannerContext) {
        expect(view.lite).toBe(true);
        calls.push({ c: view.viewer, reviews: ctx.reviews, wake: ctx.wake, hadMemory: ctx.memory !== null });
        ctx.setMemory({ n: ((ctx.memory as { n: number } | null)?.n ?? 0) + 1, at: ctx.now });
        return [];
      },
    };
    const s = newMiniGame({ human: 'ARD', seed: 8 });
    advance(s, 1440, { fallback: ctl });
    expect(seen.length).toBeGreaterThan(calls.length);
    expect(calls.length).toBeGreaterThan(0);
    // every declined shape never reached decide
    expect(calls.filter((x) => x.hadMemory && x.wake.length === 0 && x.reviews.length === 1 && x.reviews[0] === 'operational')).toEqual([]);
    expect(seen.some((i) => i.memory !== null && (i.memory as { n: number }).n > 0)).toBe(true);
    // same history continued directly vs. through a save/reload
    const a = deserialize(serialize(s));
    advance(s, 1440, { fallback: ctl });
    advance(a, 1440, { fallback: ctl });
    expect(stateHash(a)).toBe(stateHash(s));
  });

  it('a coordinate / request_operation message wakes the AI recipient (and coalition members) at the next AI phase', () => {
    const s = newMiniGame({ human: 'ARD', seed: 2 });
    advance(s, 60);
    must(s, { type: 'sendMessage', country: 'ARD', to: 'BOR', intent: 'coordinate', reason: 'hold the canal' });
    const msgId = s.messages['dm:ARD|BOR'].at(-1)!.id;
    expect(s.ai.schedule.BOR.wake).toContain(`message:${msgId}`);
    must(s, { type: 'sendMessage', country: 'ARD', to: 'DUN', intent: 'greet' });
    expect(s.ai.schedule.DUN.wake.some((w) => w.startsWith('message:'))).toBe(false);
    const woke: string[][] = [];
    advance(s, 15, { fallback: { decide: (v, ctx) => (v.viewer === 'BOR' && woke.push(ctx.wake), []) } });
    expect(woke.some((w) => w.includes(`message:${msgId}`))).toBe(true);
  });

  it('a stack on an edge whose both ends became illegal (peace inside the former enemy) settles once — no flip-flop', () => {
    const s = newMiniGame({ human: 'ARD', seed: 1 });
    clearStacks(s);
    war(s, 'ARD', 'BOR');
    const st = place(s, 'ARD', 14, ['inf']);
    must(s, { type: 'move', country: 'ARD', stack: st.id, dest: 15 });
    advance(s, 30);
    expect(s.stacks[st.id].pos.kind).toBe('edge');
    makePeace(s, 'ARD', 'BOR');
    const before = s.events.length;
    // unrelated grant changes elsewhere force a route re-check every step (as 119 bots do)
    for (let i = 0; i < 40; i++) {
      grant(s, 'ESK', 'FAL', i % 2 ? 'peace' : 'right_of_way');
      advance(s, 15);
    }
    advance(s, 2 * 1440);
    const revoked = s.events.slice(before).filter((e) => e.kind === 'route_revoked' && e.private.ARD);
    expect(revoked.length).toBe(1);
    expect(s.stacks[st.id].pos).toEqual({ kind: 'node', node: 14 }); // nearer end (it had barely left)
    expect(s.stacks[st.id].order).toBeNull();
    // same outcome when the strand is resolved after a reload
    const t = newMiniGame({ human: 'ARD', seed: 1 });
    clearStacks(t);
    war(t, 'ARD', 'BOR');
    const st2 = place(t, 'ARD', 14, ['inf']);
    must(t, { type: 'move', country: 'ARD', stack: st2.id, dest: 15 });
    advance(t, 30);
    makePeace(t, 'ARD', 'BOR');
    advance(t, 45);
    const u = deserialize(serialize(t)); // cold route-revalidation cache: must reach the same state
    for (const x of [t, u]) for (let i = 0; i < 8; i++) {
      grant(x, 'ESK', 'FAL', i % 2 ? 'peace' : 'right_of_way');
      advance(x, 15);
    }
    advance(t, 1440);
    advance(u, 1440);
    expect(stateHash(u)).toBe(stateHash(t));
  });

  it('views from a warm state (every cross-call memo alive) equal views of a cold reload, across commands, coalition changes and direct edits', () => {
    const s = newMiniGame({ human: null, seed: 11 });
    for (const c of s.countryOrder) setStock(s, c, { money: 2_000_000, fuel: 5_000, supplies: 5_000 });
    const viewAll = (x: GameState, lite: boolean) => x.countryOrder.map((c) => JSON.stringify(getCountryView(x, c, { journalLimit: 15, journalScan: 400, lite })));
    /** first differing path of two JSON values (for a readable failure) */
    const firstDiff = (a: unknown, b: unknown, path = ''): string | null => {
      if (JSON.stringify(a) === JSON.stringify(b)) return null;
      if (a && b && typeof a === 'object' && typeof b === 'object') {
        for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
          const d = firstDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
          if (d) return d;
        }
      }
      return `${path}: ${JSON.stringify(a)?.slice(0, 300)} != ${JSON.stringify(b)?.slice(0, 300)}`;
    };
    const check = (label: string) => {
      // direct test edits must announce themselves to the per-step memo (derived); every
      // cross-call memo under test (relation rows, coalition entries, allied units, offer index,
      // sorted contact ids, stacks per owner, market books) stays warm
      invalidateViewCache(s);
      const cold = deserialize(serialize(s));
      for (const lite of [true, false]) {
        const warm = viewAll(s, lite);
        const fresh = viewAll(cold, lite);
        warm.forEach((v, i) => {
          if (v !== fresh[i]) expect.fail(`${label} ${s.countryOrder[i]} lite=${lite}: ${firstDiff(JSON.parse(v), JSON.parse(fresh[i]))}`);
        });
      }
    };
    check('start');
    // coalition: founder, applications (only the leader sees them), joins, departure notice
    must(s, { type: 'createCoalition', country: 'ARD', name: 'West bloc', description: 'test' });
    const co = Object.values(s.coalitions)[0];
    must(s, { type: 'applyCoalition', country: 'DUN', coalition: co.id });
    check('application');
    must(s, { type: 'respondApplication', country: 'ARD', coalition: co.id, applicant: 'DUN', accept: true });
    must(s, { type: 'applyCoalition', country: 'CEL', coalition: co.id });
    check('joined');
    must(s, { type: 'leaveCoalition', country: 'DUN' });
    check('departure announced');
    // offers (pending, answered), grants, trust (engine and direct edits), a war
    must(s, { type: 'proposeOffer', country: 'BOR', to: 'ESK', give: [], receive: [{ kind: 'status', level: 'right_of_way' }] });
    must(s, { type: 'proposeOffer', country: 'FAL', to: 'ESK', give: [], receive: [{ kind: 'status', level: 'right_of_way' }] });
    check('offers pending');
    const o = Object.values(s.offers).find((x) => x.from === 'BOR')!;
    must(s, { type: 'respondOffer', country: 'ESK', offer: o.id, accept: true });
    grant(s, 'FAL', 'BOR', 'shared_intel');
    addTrust(s, 'BOR', 'ESK', -7, 'test', 'test');
    check('offer answered');
    s.trust['ESK>FAL'] = { value: -33, history: [] }; // direct edit: seen live
    s.trust['BOR>ESK'].value = 12; // in-place edit of an existing entry
    check('trust edited');
    war(s, 'BOR', 'ESK');
    const bor = place(s, 'BOR', 3, ['inf', 'inf']);
    place(s, 'ARD', 12, ['inf', 'scout']);
    check('war + new stacks');
    // allied HP change in place (allied stacks are projected live), then removals
    const ardStack = Object.values(s.stacks).find((x) => x.owner === 'ARD')!;
    ardStack.units[0].hp = Math.max(1, Math.floor(ardStack.units[0].hp / 3));
    check('allied hp');
    delete s.stacks[bor.id];
    clearStacks(s, 'CEL');
    check('stacks removed');
    advance(s, 3 * 1440, { fallback: BasicController });
    check('after three bot days');
    advance(s, 8 * 1440, { fallback: BasicController }); // day-change prunes answered offers
    check('after pruning');
  });

  it('war events carry structured actors; the view lists coalition join ticks and public wars', () => {
    const s = newMiniGame({ human: 'ARD', seed: 1 });
    war(s, 'ARD', 'BOR');
    const e = s.events.filter((x) => x.kind === 'war_declared').at(-1)!;
    expect(e.private.BOR.data).toMatchObject({ by: 'ARD', target: 'BOR' });
    must(s, { type: 'createCoalition', country: 'ARD', name: 'Test bloc' });
    const v = getCountryView(s, 'ARD');
    const co = v.coalitions.find((c) => c.members.includes('ARD'))!;
    expect(co.joinedAt.ARD).toBe(s.clock.tick);
    expect(getCountryView(s, 'DUN').wars).toEqual([['ARD', 'BOR']]); // public war list, any viewer
    makePeace(s, 'ARD', 'BOR');
    expect(getCountryView(s, 'DUN').wars).toEqual([]);
  });
});
