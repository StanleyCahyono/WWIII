/**
 * Atomic resource transfers with per-country ledger entries.
 * Invariant (tested): ledger.initial + Σ ledger.totals == country.stock (spendable).
 * Market escrow moves out of `stock` into `escrow` under category 'market_escrow'.
 */
import type { CountryId } from '../data-types';
import type { CountryState, GameState, LedgerCategory } from '../state';
import { addInto, copy, geq, type ResM, shortfall, zero } from '../fixed';
import { RESOURCES } from '../data-types';
import { LEDGER_DAYS_KEPT } from '../rules';
import { dayOf } from '../time';

function bucket(state: GameState, c: CountryState): Partial<Record<LedgerCategory, ResM>> {
  const day = dayOf(state.clock.tick);
  const days = c.ledger.days;
  let last = days[days.length - 1];
  if (!last || last.day !== day) {
    last = { day, cats: {} };
    days.push(last);
    while (days.length > LEDGER_DAYS_KEPT) days.shift();
  }
  return last.cats;
}

function record(state: GameState, c: CountryState, cat: LedgerCategory, delta: ResM): void {
  const t = (c.ledger.totals[cat] ??= zero());
  addInto(t, delta);
  const b = bucket(state, c);
  const d = (b[cat] ??= zero());
  addInto(d, delta);
}

/** Credit (positive) resources to spendable stock. */
export function credit(state: GameState, country: CountryId, cat: LedgerCategory, v: ResM): void {
  const c = state.countries[country];
  if (!c) return;
  addInto(c.stock, v);
  record(state, c, cat, v);
}

/** Charge a cost atomically: all or nothing. Returns false (no change) if unaffordable. */
export function charge(state: GameState, country: CountryId, cat: LedgerCategory, cost: ResM): boolean {
  const c = state.countries[country];
  if (!c || !geq(c.stock, cost)) return false;
  const d = zero();
  for (const r of RESOURCES) {
    c.stock[r] -= cost[r];
    d[r] = -cost[r];
  }
  record(state, c, cat, d);
  return true;
}

/** Pay as much of `cost` as possible (upkeep). Returns the unpaid shortfall vector. */
export function chargePartial(state: GameState, country: CountryId, cat: LedgerCategory, cost: ResM): ResM {
  const c = state.countries[country];
  const unpaid = zero();
  if (!c) return unpaid;
  const d = zero();
  for (const r of RESOURCES) {
    const pay = Math.min(Math.max(0, c.stock[r]), cost[r]);
    c.stock[r] -= pay;
    d[r] = -pay;
    unpaid[r] = cost[r] - pay;
  }
  record(state, c, cat, d);
  addInto(c.ledger.unpaid, unpaid);
  return unpaid;
}

/** Move resources from stock into escrow (atomic). */
export function reserve(state: GameState, country: CountryId, v: ResM): boolean {
  const c = state.countries[country];
  if (!c || !geq(c.stock, v)) return false;
  const d = zero();
  for (const r of RESOURCES) {
    c.stock[r] -= v[r];
    c.escrow[r] += v[r];
    d[r] = -v[r];
  }
  record(state, c, 'market_escrow', d);
  return true;
}
/** Release escrow back to stock. */
export function release(state: GameState, country: CountryId, v: ResM): void {
  const c = state.countries[country];
  if (!c) return;
  for (const r of RESOURCES) {
    c.escrow[r] -= v[r];
    c.stock[r] += v[r];
  }
  record(state, c, 'market_escrow', copy(v));
}
/** Consume escrow without touching stock (goods/cash leave the country via a fill). */
export function consumeEscrow(state: GameState, country: CountryId, v: ResM): void {
  const c = state.countries[country];
  if (!c) return;
  for (const r of RESOURCES) c.escrow[r] -= v[r];
}

export function affordability(state: GameState, country: CountryId, cost: ResM): { ok: boolean; short: Partial<ResM> } {
  const c = state.countries[country];
  const short = shortfall(c.stock, cost);
  return { ok: Object.keys(short).length === 0, short };
}

/** Σ totals (for reconciliation tests and UI). */
export function ledgerSum(c: CountryState): ResM {
  const s = zero();
  for (const v of Object.values(c.ledger.totals)) if (v) addInto(s, v);
  return s;
}
