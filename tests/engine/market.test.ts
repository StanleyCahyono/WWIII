import { describe, expect, it } from 'vitest';
import { submitCommand, previewCommand, serialize, deserialize, marketView } from '../../src/engine';
import { newMiniGame } from '../fixtures/mini-world';
import { must, reconciled, setStock } from '../fixtures/helpers';
import { validateState } from '../../src/engine/save/index';

describe('market', () => {
  it('A06: two purchases against the same funds — no double spend; exact shortfall reported', () => {
    const s = newMiniGame();
    setStock(s, 'ARD', { money: 1000 });
    const r1 = submitCommand(s, { type: 'marketOrder', country: 'ARD', side: 'buy', resource: 'fuel', qty: 100, price: 8000 });
    expect(r1.ok).toBe(true);
    const r2 = submitCommand(s, { type: 'marketOrder', country: 'ARD', side: 'buy', resource: 'rare', qty: 100, price: 8000 });
    expect(r2.ok).toBe(false);
    if (!r2.ok) {
      expect(r2.code).toBe('insufficient_resources');
      expect(r2.reason).toMatch(/short by 600 money/);
    }
    expect(s.countries.ARD.stock.money).toBe(200_000);
    expect(s.countries.ARD.escrow.money).toBe(800_000);
    expect(reconciled(s, 'ARD')).toBe(true);
  });

  it('price-time priority: higher bid fills first, then older at equal price; seller can receive more than its floor', () => {
    const s = newMiniGame();
    must(s, { type: 'marketOrder', country: 'BOR', side: 'buy', resource: 'fuel', qty: 50, price: 5000 });
    must(s, { type: 'marketOrder', country: 'CEL', side: 'buy', resource: 'fuel', qty: 30, price: 7000 });
    must(s, { type: 'marketOrder', country: 'DUN', side: 'buy', resource: 'fuel', qty: 30, price: 7000 });
    const pv = previewCommand(s, { type: 'marketOrder', country: 'ARD', side: 'sell', resource: 'fuel', qty: 70, price: 4000 });
    expect(pv.ok).toBe(true);
    if (pv.ok) expect((pv.preview as { match: { fills: { qty: number; price: number }[] } }).match.fills).toEqual([{ qty: 30, price: 7000 }, { qty: 30, price: 7000 }, { qty: 10, price: 5000 }]);
    const m0 = s.countries.ARD.stock.money;
    must(s, { type: 'marketOrder', country: 'ARD', side: 'sell', resource: 'fuel', qty: 70, price: 4000 });
    const fills = s.market.fills;
    expect(fills.map((f) => [f.buyer, f.qty, f.price])).toEqual([['CEL', 30, 7000], ['DUN', 30, 7000], ['BOR', 10, 5000]]);
    expect(s.countries.ARD.stock.money - m0).toBe(30 * 7000 + 30 * 7000 + 10 * 5000);
    for (const c of s.countryOrder) expect(reconciled(s, c)).toBe(true);
    expect(validateState(s)).toEqual([]);
  });

  it('A06: cancel a partially filled sale — unfilled remainder returns exactly once; both counterparties reconcile', () => {
    const s = newMiniGame();
    const fuel0 = s.countries.ARD.stock.fuel;
    const r = must(s, { type: 'marketOrder', country: 'ARD', side: 'sell', resource: 'fuel', qty: 100, price: 3000 });
    const oid = (r.result as { order: string }).order;
    expect(s.countries.ARD.stock.fuel).toBe(fuel0 - 100_000);
    expect(s.countries.ARD.escrow.fuel).toBe(100_000);
    // buyer pays limit 3500 but executes at resting 3000 → price improvement released
    const b0 = s.countries.BOR.stock.money;
    must(s, { type: 'marketOrder', country: 'BOR', side: 'buy', resource: 'fuel', qty: 40, price: 3500 });
    expect(b0 - s.countries.BOR.stock.money).toBe(40 * 3000);
    expect(s.countries.BOR.escrow.money).toBe(0);
    const o = s.market.orders[oid];
    expect(o.filled).toBe(40);
    // reload preserves reservation and ordering
    const l = deserialize(serialize(s));
    expect(l.market.orders[oid].escrow).toBe(60_000);
    const c1 = submitCommand(s, { type: 'cancelMarketOrder', country: 'ARD', order: oid });
    expect(c1.ok).toBe(true);
    expect(s.countries.ARD.stock.fuel).toBe(fuel0 - 40_000);
    expect(s.countries.ARD.escrow.fuel).toBe(0);
    const c2 = submitCommand(s, { type: 'cancelMarketOrder', country: 'ARD', order: oid });
    expect(c2.ok).toBe(false);
    if (!c2.ok) expect(c2.reason).toMatch(/already cancelled/);
    expect(s.countries.ARD.stock.fuel).toBe(fuel0 - 40_000);
    expect(o.cancelledQty).toBe(60);
    for (const c of ['ARD', 'BOR']) expect(reconciled(s, c)).toBe(true);
    expect(marketView(s, 'ARD', 'fuel').mine[0].status).toBe('cancelled');
  });

  it('filled order cannot be cancelled; empty book and invalid amounts explained; never self-trade', () => {
    const s = newMiniGame();
    must(s, { type: 'marketOrder', country: 'ARD', side: 'sell', resource: 'rare', qty: 5, price: 9000 });
    const own = previewCommand(s, { type: 'marketOrder', country: 'ARD', side: 'buy', resource: 'rare', qty: 5, price: 9000 });
    expect(own.ok && own.warnings?.[0]).toMatch(/No order crosses/);
    const r = must(s, { type: 'marketOrder', country: 'BOR', side: 'buy', resource: 'rare', qty: 5, price: 9000 });
    const sell = Object.values(s.market.orders).find((o) => o.country === 'ARD')!;
    expect(sell.status).toBe('filled');
    const c = submitCommand(s, { type: 'cancelMarketOrder', country: 'ARD', order: sell.id });
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.reason).toMatch(/completely filled/);
    expect(previewCommand(s, { type: 'marketOrder', country: 'ARD', side: 'buy', resource: 'money', qty: 5, price: 1 }).ok).toBe(false);
    expect(previewCommand(s, { type: 'marketOrder', country: 'ARD', side: 'buy', resource: 'fuel', qty: 0.5, price: 1 }).ok).toBe(false);
    expect(r.ok).toBe(true);
  });
});
