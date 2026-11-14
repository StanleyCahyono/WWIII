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

function counterOrders(state: GameState, side: 'buy' | 'sell', resource: Resource, country: CountryId, price: number): MarketOrder[] {
  const opp = side === 'buy' ? 'sell' : 'buy';
  return Object.values(state.market.orders)
    .filter((o) => o.status === 'open' && o.resource === resource && o.side === opp && o.country !== country && (side === 'buy' ? o.price <= price : o.price >= price))
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
  return { released, qty: o.cancelledQty };
}

export interface BookLevel {
  price: number;
  qty: number;
  orders: number;
}
export function bookView(state: GameState, resource: Resource): { bids: BookLevel[]; asks: BookLevel[]; last: number | null } {
  const agg = (side: 'buy' | 'sell') => {
    const m = new Map<number, BookLevel>();
    for (const o of Object.values(state.market.orders)) {
      if (o.status !== 'open' || o.resource !== resource || o.side !== side) continue;
      const l = m.get(o.price) ?? { price: o.price, qty: 0, orders: 0 };
      l.qty += o.qty - o.filled;
      l.orders++;
      m.set(o.price, l);
    }
    return [...m.values()].sort((a, b) => (side === 'buy' ? b.price - a.price : a.price - b.price));
  };
  return { bids: agg('buy'), asks: agg('sell'), last: state.market.lastPrice[resource] ?? null };
}

/** Remove closed orders older than `keepMin` minutes to bound save size. */
export function pruneMarket(state: GameState, keepMin: number): void {
  for (const id of Object.keys(state.market.orders)) {
    const o = state.market.orders[id];
    if (o.status !== 'open' && o.closedAt !== null && state.clock.tick - o.closedAt > keepMin) delete state.market.orders[id];
  }
}
