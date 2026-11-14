/**
 * Market: continuous double auction per resource (money is the numeraire).
 *  - Quantities are whole units; prices are integer milli-money per unit.
 *  - Bids escrow qty × limit money; asks escrow qty goods — at placement (no double spend).
 *  - Matching: best price first, then oldest (sequence). Never against own orders.
 *  - Execution at the RESTING order's price; a buyer whose limit exceeds the execution price gets
 *    the difference released from escrow immediately (seller may receive more than its floor
 *    when it is the aggressor against a higher bid).
 *  - Partial fills; finite counterparties (only real orders from countries).
 *  - Cancel releases the unfilled remainder exactly once; a filled/cancelled order cannot be
 *    cancelled again (explained).
 */
import type { CountryId, Resource } from '../data-types';
import type { GameState, MarketFill, MarketOrder } from '../state';
import { nextId } from '../ids';
import { consumeEscrow, credit, release, reserve } from './ledger';
import { zero } from '../fixed';
import { emit, toAll } from './events';

export function escrowFor(side: 'buy' | 'sell', resource: Resource, qty: number, price: number) {
  const v = zero();
  if (side === 'buy') v.money = qty * price;
  else v[resource] = qty * 1000;
  return v;
}

export interface FillPreview {
  fills: { qty: number; price: number }[];
  filledQty: number;
  restingQty: number;
  gross: number;
}

// ───────────────────────── open-order index (non-serialized) ─────────────────────────
//
// Every path that mutates `state.market.orders` (placement, execution, cancellation, pruning)
// lives in this module and reports the change (`noteOrder`), which updates a live index in place
// (or just bumps the version when no index is live). The index is validated by that version, the
// saved `seq` and the orders object identity, so a reloaded or cloned state (cold WeakMap) always
// rebuilds from the records. Code that edits orders directly (tests, tools) must call `bumpMarket`.
// List orders equal `Object.values(state.market.orders)` order (record insertion order).

export interface BookLevel {
  price: number;
  qty: number;
  orders: number;
}
export type BookView = { bids: BookLevel[]; asks: BookLevel[]; last: number | null };

interface MarketIndex {
  v: number;
  seq: number;
  orders: object;
  /** Open orders in record (insertion) order. */
  open: MarketOrder[];
  /** All order records (open and recently closed) per country, record order. */
  byCountry: Map<CountryId, MarketOrder[]>;
  openCount: Map<CountryId, number>;
  books: Map<Resource, BookView>;
}
const marketVersion = new WeakMap<GameState, number>();
const marketIndexCache = new WeakMap<GameState, MarketIndex>();
/** Announce an out-of-band mutation of market orders (drops the open-order index and cached books). */
export function bumpMarket(state: GameState): void {
  marketVersion.set(state, (marketVersion.get(state) ?? 0) + 1);
}
function removeFrom<T>(l: T[] | undefined, x: T): void {
  if (!l) return;
  const i = l.indexOf(x);
  if (i >= 0) l.splice(i, 1);
}
/** Record a change of one order: 'add' (new record), 'update' (fill/cancel), 'delete' (pruned). */
function noteOrder(state: GameState, o: MarketOrder, op: 'add' | 'update' | 'delete', wasOpen: boolean): void {
  const v = marketVersion.get(state) ?? 0;
  const c = marketIndexCache.get(state);
  marketVersion.set(state, v + 1);
  if (!c || c.v !== v || c.orders !== state.market.orders) return;
  c.v = v + 1;
  c.seq = state.market.seq;
  c.books.clear();
  const isOpen = op !== 'delete' && o.status === 'open';
  if (op === 'add') (c.byCountry.get(o.country) ?? c.byCountry.set(o.country, []).get(o.country)!).push(o);
  else if (op === 'delete') removeFrom(c.byCountry.get(o.country), o);
  if (isOpen && (op === 'add' || !wasOpen)) {
    c.open.push(o);
    c.openCount.set(o.country, (c.openCount.get(o.country) ?? 0) + 1);
  } else if (!isOpen && wasOpen && op !== 'add') {
    removeFrom(c.open, o);
    c.openCount.set(o.country, (c.openCount.get(o.country) ?? 1) - 1);
  }
}
function marketIndex(state: GameState): MarketIndex {
  const v = marketVersion.get(state) ?? 0;
  const c = marketIndexCache.get(state);
  if (c && c.v === v && c.seq === state.market.seq && c.orders === state.market.orders) return c;
  const open: MarketOrder[] = [];
  const byCountry = new Map<CountryId, MarketOrder[]>();
  const openCount = new Map<CountryId, number>();
  for (const o of Object.values(state.market.orders)) {
    (byCountry.get(o.country) ?? byCountry.set(o.country, []).get(o.country)!).push(o);
    if (o.status !== 'open') continue;
    open.push(o);
    openCount.set(o.country, (openCount.get(o.country) ?? 0) + 1);
  }
  const idx: MarketIndex = { v, seq: state.market.seq, orders: state.market.orders, open, byCountry, openCount, books: new Map() };
  marketIndexCache.set(state, idx);
  return idx;
}
/** Open orders of one country (count), via the index. */
export function openOrderCount(state: GameState, country: CountryId): number {
  return marketIndex(state).openCount.get(country) ?? 0;
}
/** Every order record of one country (open and not yet pruned), in record order. Do not mutate. */
export function ordersOf(state: GameState, country: CountryId): readonly MarketOrder[] {
  return marketIndex(state).byCountry.get(country) ?? [];
}
/** Open orders of one country, in record order. Do not mutate. */
export function openOrdersOf(state: GameState, country: CountryId): MarketOrder[] {
  return ordersOf(state, country).filter((o) => o.status === 'open');
}

function counterOrders(state: GameState, side: 'buy' | 'sell', resource: Resource, country: CountryId, price: number): MarketOrder[] {
  const opp = side === 'buy' ? 'sell' : 'buy';
  return marketIndex(state)
    .open.filter((o) => o.status === 'open' && o.resource === resource && o.side === opp && o.country !== country && (side === 'buy' ? o.price <= price : o.price >= price))
    .sort((a, b) => (side === 'buy' ? a.price - b.price : b.price - a.price) || a.seq - b.seq);
}

export function previewMatch(state: GameState, country: CountryId, side: 'buy' | 'sell', resource: Resource, qty: number, price: number): FillPreview {
  let rem = qty;
  const fills: { qty: number; price: number }[] = [];
  let gross = 0;
  for (const o of counterOrders(state, side, resource, country, price)) {
    if (rem <= 0) break;
    const q = Math.min(rem, o.qty - o.filled);
    if (q <= 0) continue;
    fills.push({ qty: q, price: o.price });
    gross += q * o.price;
    rem -= q;
  }
  return { fills, filledQty: qty - rem, restingQty: rem, gross };
}

export function placeOrderInternal(state: GameState, country: CountryId, side: 'buy' | 'sell', resource: Resource, qty: number, price: number): MarketOrder | null {
  const esc = escrowFor(side, resource, qty, price);
  if (!reserve(state, country, esc)) return null;
  const o: MarketOrder = {
    id: nextId(state, 'market'),
    seq: ++state.market.seq,
    country,
    side,
    resource,
    qty,
    filled: 0,
    price,
    createdAt: state.clock.tick,
    status: 'open',
    escrow: side === 'buy' ? esc.money : esc[resource],
    cancelledQty: 0,
    closedAt: null,
  };
  state.market.orders[o.id] = o;
  noteOrder(state, o, 'add', false);
  matchOrder(state, o);
  return o;
}

function execute(state: GameState, buy: MarketOrder, sell: MarketOrder, qty: number, price: number): MarketFill {
  const res = buy.resource;
  // buyer: consume escrowed cash at its limit, release price improvement
  const atLimit = qty * buy.price;
  const paid = qty * price;
  const cash = zero();
  cash.money = atLimit;
  consumeEscrow(state, buy.country, cash);
  buy.escrow -= atLimit;
  if (atLimit > paid) {
    const imp = zero();
    imp.money = atLimit - paid;
    // put the improvement back into escrow accounting then release it (ledger: market_escrow +)
    state.countries[buy.country].escrow.money += imp.money;
    release(state, buy.country, imp);
  }
  // seller: consume escrowed goods
  const goods = zero();
  goods[res] = qty * 1000;
  consumeEscrow(state, sell.country, goods);
  sell.escrow -= qty * 1000;
  // deliver
  credit(state, buy.country, 'market_fill', goods);
  const proceeds = zero();
  proceeds.money = paid;
  credit(state, sell.country, 'market_fill', proceeds);
  buy.filled += qty;
  sell.filled += qty;
  for (const o of [buy, sell]) if (o.filled >= o.qty) {
    o.status = 'filled';
    o.closedAt = state.clock.tick;
    if (o.escrow !== 0 && o.side === 'buy') {
      const rest = zero();
      rest.money = o.escrow;
      release(state, o.country, rest);
      o.escrow = 0;
    }
  }
  const f: MarketFill = { id: nextId(state, 'fill'), at: state.clock.tick, resource: res, qty, price, buyer: buy.country, seller: sell.country, buyOrder: buy.id, sellOrder: sell.id };
  state.market.fills.push(f);
  if (state.market.fills.length > 600) state.market.fills.splice(0, state.market.fills.length - 600);
  state.market.lastPrice[res] = price;
  noteOrder(state, buy, 'update', true);
  noteOrder(state, sell, 'update', true);
  emit(state, { kind: 'market_fill', category: 'economy', routine: true, private: { ...toAll([buy.country], `Bought ${qty} ${res} at ${(price / 1000).toFixed(3)} (order ${buy.id}).`, { order: buy.id, qty, price }), ...toAll([sell.country], `Sold ${qty} ${res} at ${(price / 1000).toFixed(3)} (order ${sell.id}).`, { order: sell.id, qty, price }) } });
  return f;
}

export function matchOrder(state: GameState, o: MarketOrder): void {
  for (const r of counterOrders(state, o.side, o.resource, o.country, o.price)) {
    if (o.status !== 'open') break;
    const q = Math.min(o.qty - o.filled, r.qty - r.filled);
    if (q <= 0) continue;
    if (o.side === 'buy') execute(state, o, r, q, r.price);
    else execute(state, r, o, q, r.price);
  }
}

export function cancelOrderInternal(state: GameState, id: string): { released: number; qty: number } | null {
  const o = state.market.orders[id];
  if (!o || o.status !== 'open') return null;
  const rest = zero();
  if (o.side === 'buy') rest.money = o.escrow;
  else rest[o.resource] = o.escrow;
  release(state, o.country, rest);
  const released = o.escrow;
  o.escrow = 0;
  o.cancelledQty = o.qty - o.filled;
  o.status = 'cancelled';
  o.closedAt = state.clock.tick;
  noteOrder(state, o, 'update', true);
  return { released, qty: o.cancelledQty };
}

/**
 * Aggregated book of one resource (price levels). Cached per market version and shared between
 * callers: the result is frozen (read-only).
 */
export function bookView(state: GameState, resource: Resource): BookView {
  const idx = marketIndex(state);
  const hit = idx.books.get(resource);
  if (hit) return hit;
  const agg = (side: 'buy' | 'sell') => {
    const m = new Map<number, BookLevel>();
    for (const o of idx.open) {
      if (o.resource !== resource || o.side !== side) continue;
      const l = m.get(o.price) ?? { price: o.price, qty: 0, orders: 0 };
      l.qty += o.qty - o.filled;
      l.orders++;
      m.set(o.price, l);
    }
    return Object.freeze([...m.values()].sort((a, b) => (side === 'buy' ? b.price - a.price : a.price - b.price)).map((l) => Object.freeze(l))) as BookLevel[];
  };
  const b: BookView = Object.freeze({ bids: agg('buy'), asks: agg('sell'), last: state.market.lastPrice[resource] ?? null });
  idx.books.set(resource, b);
  return b;
}

/** Remove closed orders older than `keepMin` minutes to bound save size. */
export function pruneMarket(state: GameState, keepMin: number): void {
  for (const id of Object.keys(state.market.orders)) {
    const o = state.market.orders[id];
    if (o.status !== 'open' && o.closedAt !== null && state.clock.tick - o.closedAt > keepMin) {
      delete state.market.orders[id];
      noteOrder(state, o, 'delete', false);
    }
  }
}
