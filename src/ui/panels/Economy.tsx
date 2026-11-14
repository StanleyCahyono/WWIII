import React, { useEffect, useMemo, useState } from 'react';
import { useFrame, useQuery, ActionButton } from '../components/common';
import { getHost } from '../sim/host';
import { ui, openPanel } from '../state/ui';
import { RESOURCE_LABEL, countryName, resourceById } from '../data/static';
import { milli, num, signed, resM, duration, gameTime, cap } from '../format';
import { exec } from '../sim/exec';
import { RESOURCES, type Resource } from '../../engine/data-types';
import { ShortageLedger } from '../components/ResourceStrip';
import { BlockadeReport } from '../components/Features';
import { Icon, RESOURCE_ICON } from '../icons';
import { Expander, SectionHead, IconTabs } from './panelKit';

interface RS { resource: Resource; stock: number; reserved: number; onHand: number; spendable: number; committedJobs: number; grossPerDay: number; consumptionPerDay: number; netPerDay: number; forecast24h: number; forecast72h: number; hoursToDepletion: number | null; insufficientStock: boolean; negativeNet: boolean }
interface Ledger { initial: Record<string, number>; totals: Record<string, Record<string, number>>; days: { day: number; cats: Record<string, Record<string, number>> }[]; stock: Record<string, number>; escrow: Record<string, number>; reconciled: boolean }
interface Profile { name: string; tradeNeeds: string[]; summary: string; openingDecisions: { title: string; detail: string; screen: string }[] }

export function EconomyPanel() {
  const frame = useFrame()!;
  const led = useQuery<Ledger>('ledgerModel');
  const prof = useQuery<Profile | null>('profile');
  const [res, setRes] = useState<Resource | null>(null);
  const rs = frame.view.self.resources as RS[];
  const report = useMemo(() => {
    const worst = [...rs].filter((r) => r.resource !== 'money').sort((a, b) => a.netPerDay / Math.max(1, a.grossPerDay) - b.netPerDay / Math.max(1, b.grossPerDay))[0];
    const need = prof.data?.tradeNeeds?.[0] as Resource | undefined;
    return { worst, need };
  }, [rs, prof.data]);
  const cats = led.data ? Object.keys(led.data.totals) : [];
  return (
    <div className="col p-root" data-testid="economy-panel">
      <div className="p-advisor" data-testid="economic-report">
        <span className="p-advisor-ico" aria-hidden="true"><Icon name="economy" size={26} /></span>
        <div className="grow" style={{ minWidth: 0 }}>
          <h4>Economic report — {frame.view.self.name}, {gameTime(frame.view.tick)}</h4>
          <p style={{ margin: '6px 0 0' }}>
            {report.need ? (
              <>
                {frame.view.self.name}'s authored trade need is <strong>{RESOURCE_LABEL[report.need]}</strong>: daily net {signed(milli(rs.find((r) => r.resource === report.need)?.netPerDay ?? 0))}. Buying it on the market preserves construction capacity for {RESOURCE_LABEL[report.worst?.resource ?? 'supplies'].toLowerCase()}-hungry projects; producing it domestically ties up a construction slot.{' '}
              </>
            ) : null}
            {report.worst && (
              <>
                Your tightest account is <strong>{RESOURCE_LABEL[report.worst.resource]}</strong> (gross +{num(milli(report.worst.grossPerDay))}/day vs upkeep −{num(milli(report.worst.consumptionPerDay))}/day
                {report.worst.hoursToDepletion !== null ? `; depleted in ${duration(report.worst.hoursToDepletion * 60)}` : ''}). Choice: expand production in a city with that output, trade for it, or delay upkeep-heavy mobilization.
              </>
            )}
          </p>
          <div className="row wrap" style={{ marginTop: 8 }}>
            {report.worst && (
              <button type="button" className="btn small" onClick={() => setRes(report.worst!.resource)}>
                Show users by city
              </button>
            )}
            <button type="button" className="btn small primary" onClick={() => openPanel('market', report.need ?? report.worst?.resource)}>
              <Icon name="market" size={14} /> Open market
            </button>
            <button type="button" className="btn small" onClick={() => openPanel('cities')}>
              <Icon name="cities" size={14} /> Cities by net production
            </button>
          </div>
        </div>
      </div>
      <BlockadeReport />
      <div className="p-restiles" aria-label="Resource balances">
        {rs.map((r) => {
          const net = milli(r.netPerDay);
          const tone = r.insufficientStock ? 'bad' : r.negativeNet ? 'warn' : 'ok';
          return (
            <button key={r.resource} type="button" className={`p-restile ${tone}${res === r.resource ? ' sel' : ''}`} aria-pressed={res === r.resource} onClick={() => setRes(res === r.resource ? null : r.resource)} title={`${RESOURCE_LABEL[r.resource]}: show producers and users by city`}>
              <span className="p-restile-top">
                <Icon name={RESOURCE_ICON[r.resource]} size={26} />
                <span className="p-restile-name">{RESOURCE_LABEL[r.resource]}</span>
                {r.insufficientStock ? <span className="p-pill bad raw">short</span> : r.negativeNet ? <span className="p-pill warn raw">negative</span> : null}
              </span>
              <span className="p-restile-v">{num(milli(r.onHand))}</span>
              <span className={`p-restile-net ${net < 0 ? 'neg' : 'pos'}`}>
                {net < 0 ? '▼' : net > 0 ? '▲' : '■'} {signed(net)} /day
              </span>
              <span className="p-restile-sub">24 h: {num(milli(r.forecast24h))} · 72 h: {num(milli(r.forecast72h))}</span>
            </button>
          );
        })}
      </div>
      {res && <ShortageLedger resource={res} onClose={() => setRes(null)} />}
      <Expander summary="Detailed balances and forecast (table)">
        <table className="data" data-testid="balance-table">
          <thead>
            <tr>
              <th>Resource</th>
              <th className="num">On hand</th>
              <th className="num">Spendable</th>
              <th className="num">Reserved (market)</th>
              <th className="num">Committed (jobs)</th>
              <th className="num">Gross /day</th>
              <th className="num">Upkeep /day</th>
              <th className="num">Net /day</th>
              <th className="num">In 24 h</th>
              <th className="num">In 72 h</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rs.map((r) => (
              <tr key={r.resource} className={res === r.resource ? 'sel' : ''}>
                <td>
                  <span className="row" style={{ gap: 5 }}><Icon name={RESOURCE_ICON[r.resource]} size={16} />{RESOURCE_LABEL[r.resource]}</span> {r.insufficientStock && <span className="tag bad">short</span>}
                  {!r.insufficientStock && r.negativeNet && <span className="tag warn">negative</span>}
                </td>
                <td className="num">{num(milli(r.onHand))}</td>
                <td className="num">{num(milli(r.spendable))}</td>
                <td className="num">{num(milli(r.reserved))}</td>
                <td className="num">{num(milli(r.committedJobs))}</td>
                <td className="num">+{num(milli(r.grossPerDay))}</td>
                <td className="num">−{num(milli(r.consumptionPerDay))}</td>
                <td className="num">{signed(milli(r.netPerDay))}</td>
                <td className="num">{num(milli(r.forecast24h))}</td>
                <td className="num">{num(milli(r.forecast72h))}</td>
                <td>
                  <button type="button" className="btn small" onClick={() => setRes(res === r.resource ? null : r.resource)} aria-expanded={res === r.resource}>
                    By city
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Expander>
      <SectionHead icon={<Icon name="journal" size={18} />} title="Ledger (cumulative since start)" level={4} />
      {led.data ? (
        <>
          <p className={`p-reconcile ${led.data.reconciled ? 'ok' : 'bad'}`} style={{ margin: 0 }}>
            <Icon name={led.data.reconciled ? 'check' : 'alert'} size={16} /> {led.data.reconciled ? 'Ledger reconciles exactly to the national stockpile.' : 'Ledger does not reconcile — please export a diagnostics report.'}
          </p>
          <Expander summary="Ledger by category">
            <table className="data">
              <thead>
                <tr>
                  <th>Category</th>
                  {RESOURCES.map((r) => (
                    <th key={r} className="num" title={RESOURCE_LABEL[r]}><Icon name={RESOURCE_ICON[r]} size={16} title={RESOURCE_LABEL[r]} /></th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Initial stock</td>
                  {RESOURCES.map((r) => (
                    <td key={r} className="num">{num(milli(led.data!.initial[r]))}</td>
                  ))}
                </tr>
                {cats.map((c) => (
                  <tr key={c}>
                    <td>{cap(c)}</td>
                    {RESOURCES.map((r) => (
                      <td key={r} className="num">{led.data!.totals[c]?.[r] ? signed(milli(led.data!.totals[c][r])) : '—'}</td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <td><strong>Spendable stock</strong></td>
                  {RESOURCES.map((r) => (
                    <td key={r} className="num"><strong>{num(milli(led.data!.stock[r]))}</strong></td>
                  ))}
                </tr>
              </tbody>
            </table>
          </Expander>
        </>
      ) : (
        <p className="muted">Loading…</p>
      )}
    </div>
  );
}

interface Book { bids: { price: number; qty: number; orders: number }[]; asks: { price: number; qty: number; orders: number }[]; last: number | null }
interface MarketData { book: Book; mine: { id: string; side: string; resource: string; qty: number; filled: number; price: number; status: string; createdAt: number; cancelledQty: number; closedAt: number | null; escrow: number }[]; fills: { id: string; at: number; resource: string; qty: number; price: number; buyer: string; seller: string }[] }

const TRADEABLE = RESOURCES.filter((r) => r !== 'money');

export function MarketPanel({ resource }: { resource: string | null }) {
  const frame = useFrame()!;
  const [r, setR] = useState<Resource>((resource && resource !== 'money' ? resource : 'supplies') as Resource);
  const [tab, setTab] = useState<'best' | 'all' | 'mine'>('best');
  const q = useQuery<MarketData>('marketView', [r]);
  useEffect(() => {
    if (resource && resource !== 'money') setR(resource as Resource);
  }, [resource]);
  const v = frame.view;
  const book = v.market.books[r] ?? q.data?.book;
  const myOrders = v.market.myOrders;
  const ro = frame.meta.readOnly || frame.meta.reviewMode;
  return (
    <div className="p-root p-market" data-testid="market-panel">
      <div className="col" style={{ minWidth: 0 }}>
        <div className="p-markethead">
          <Icon name={RESOURCE_ICON[r]} size={34} />
          <label className="row" style={{ gap: 6 }}>
            Good
            <select value={r} onChange={(e) => { setR(e.target.value as Resource); ui.patch({ panelArg: e.target.value }); }} data-testid="market-resource">
              {TRADEABLE.map((x) => (
                <option key={x} value={x}>
                  {RESOURCE_LABEL[x]}
                </option>
              ))}
            </select>
          </label>
          <div className="grow" />
          <span className="p-lasttrade">
            <span className="p-kicker">Last trade</span>
            <strong>{book?.last ? `${(book.last / 1000).toFixed(3)}` : 'none yet'}</strong>
            {book?.last ? <span className="muted"> money/unit</span> : null}
          </span>
        </div>
        <IconTabs
          compact
          label="Market views"
          value={tab}
          onChange={setTab}
          tabs={[
            { key: 'best', label: 'Best offers', icon: <Icon name="star" size={16} /> },
            { key: 'all', label: 'All offers', icon: <Icon name="roster" size={16} /> },
            { key: 'mine', label: 'My trades', icon: <Icon name="journal" size={16} />, badge: myOrders.filter((o) => o.status === 'open').length || undefined },
          ]}
        />
        {tab !== 'mine' && book && (
          <div className="row wrap" style={{ alignItems: 'flex-start' }}>
            {(['asks', 'bids'] as const).map((side) => {
              const lv = tab === 'best' ? book[side].slice(0, 5) : book[side];
              return (
                <div key={side} className={`p-book ${side}`} style={{ flex: '1 1 220px' }}>
                  <h4>{side === 'asks' ? 'Sell offers (you can buy)' : 'Buy bids (you can sell)'}</h4>
                  {lv.length === 0 ? (
                    <div className="empty">Empty book: no {side === 'asks' ? 'sellers' : 'buyers'} for {RESOURCE_LABEL[r].toLowerCase()} right now. A resting order waits for computer countries.</div>
                  ) : (
                    <table className="data">
                      <thead>
                        <tr>
                          <th className="num">Price /unit</th>
                          <th className="num">Quantity</th>
                          <th className="num">Orders</th>
                          <th className="num">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lv.map((l) => (
                          <tr key={l.price}>
                            <td className="num">{(l.price / 1000).toFixed(3)}</td>
                            <td className="num">{num(l.qty)}</td>
                            <td className="num">{l.orders}</td>
                            <td className="num">{num((l.qty * l.price) / 1000)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {tab === 'mine' && (
          <div className="col">
            <h4>Open orders</h4>
            {myOrders.filter((o) => o.status === 'open').length === 0 ? (
              <div className="empty">No open orders.</div>
            ) : (
              <table className="data" data-testid="open-orders">
                <thead>
                  <tr>
                    <th>Side</th>
                    <th>Good</th>
                    <th className="num">Ordered</th>
                    <th className="num">Filled</th>
                    <th className="num">Remaining</th>
                    <th className="num">Limit</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {myOrders.filter((o) => o.status === 'open').map((o) => (
                    <tr key={o.id}>
                      <td>{o.side}</td>
                      <td>{RESOURCE_LABEL[o.resource]}</td>
                      <td className="num">{o.qty}</td>
                      <td className="num">{o.filled}</td>
                      <td className="num">{o.qty - o.filled}</td>
                      <td className="num">{(o.price / 1000).toFixed(3)}</td>
                      <td>
                        <ActionButton className="btn small" disabledReason={ro ? 'Read-only campaign' : null} onClick={() => exec({ type: 'cancelMarketOrder', order: o.id }, `Order aborted; unfilled ${o.qty - o.filled} released.`)}>
                          Abort
                        </ActionButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <h4>Completed and cancelled</h4>
            {myOrders.filter((o) => o.status !== 'open').length === 0 ? (
              <div className="empty">No completed orders yet.</div>
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>Side</th>
                    <th>Good</th>
                    <th className="num">Ordered</th>
                    <th className="num">Filled</th>
                    <th className="num">Cancelled</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {myOrders.filter((o) => o.status !== 'open').map((o) => (
                    <tr key={o.id}>
                      <td>{o.side}</td>
                      <td>{RESOURCE_LABEL[o.resource]}</td>
                      <td className="num">{o.qty}</td>
                      <td className="num">{o.filled}</td>
                      <td className="num">{o.cancelledQty}</td>
                      <td>{o.status}{o.closedAt ? ` · ${gameTime(o.closedAt)}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <h4>Executions</h4>
            {v.market.myFills.length === 0 ? (
              <div className="empty">No executions yet.</div>
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Good</th>
                    <th className="num">Qty</th>
                    <th className="num">Price</th>
                    <th>Counterparty</th>
                  </tr>
                </thead>
                <tbody>
                  {v.market.myFills.slice().reverse().slice(0, 50).map((f) => (
                    <tr key={f.id}>
                      <td>{gameTime(f.at)}</td>
                      <td>{RESOURCE_LABEL[f.resource]}</td>
                      <td className="num">{f.qty}</td>
                      <td className="num">{(f.price / 1000).toFixed(3)}</td>
                      <td>{f.buyer === v.viewer ? `bought from ${countryName(f.seller)}` : `sold to ${countryName(f.buyer)}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
      <OrderForm r={r} setR={setR} />
    </div>
  );
}

function OrderForm({ r, setR }: { r: Resource; setR: (r: Resource) => void }) {
  const frame = useFrame()!;
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [qty, setQty] = useState('100');
  const [price, setPrice] = useState('');
  const [pv, setPv] = useState<{ ok: boolean; reason?: string; preview?: { escrow: Record<string, number>; match: { fills: { qty: number; price: number }[]; filledQty: number; restingQty: number; gross: number }; available: number }; warnings?: string[] } | null>(null);
  const book = frame.view.market.books[r];
  const ref = side === 'buy' ? book?.asks[0]?.price : book?.bids[0]?.price;
  const ro = frame.meta.readOnly || frame.meta.reviewMode;
  const q = Math.floor(Number(qty));
  const p = Math.round(Number(price) * 1000);
  const self = frame.view.self.resources.find((x) => x.resource === (side === 'buy' ? 'money' : r));
  useEffect(() => {
    const fallback = (resourceById.get(r)?.referencePrice ?? 1) * 1000;
    setPrice(((ref ?? book?.last ?? fallback) / 1000).toFixed(3));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r, side]);
  useEffect(() => {
    let alive = true;
    if (!q || !p) {
      setPv(null);
      return;
    }
    void getHost()
      .preview<NonNullable<typeof pv>['preview']>({ type: 'marketOrder', side, resource: r, qty: q, price: p })
      .then((v) => alive && setPv(v.ok ? { ok: true, preview: v.preview, warnings: v.warnings } : { ok: false, reason: v.reason }));
    return () => {
      alive = false;
    };
  }, [side, r, q, p, frame.view.tick]);
  const invalid = !Number.isInteger(Number(qty)) || q < 1 ? 'Amount must be a whole number of at least 1.' : !(p >= 1) ? 'Enter a limit price above 0.' : null;
  return (
    <form className="p-card p-orderform" onSubmit={(e) => e.preventDefault()} aria-label="New market order" data-testid="order-form">
      <h4>New order</h4>
      <div className="p-seg" role="radiogroup" aria-label="Side">
        <label className={side === 'buy' ? 'on buy' : ''}>
          <input type="radio" checked={side === 'buy'} onChange={() => setSide('buy')} /> Buy
        </label>
        <label className={side === 'sell' ? 'on sell' : ''}>
          <input type="radio" checked={side === 'sell'} onChange={() => setSide('sell')} /> Sell
        </label>
      </div>
      <label className="field">
        Resource
        <select value={r} onChange={(e) => setR(e.target.value as Resource)}>
          {TRADEABLE.map((x) => (
            <option key={x} value={x}>
              {RESOURCE_LABEL[x]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Amount (units)
        <input type="number" min={1} step={1} value={qty} onChange={(e) => setQty(e.target.value)} data-testid="order-qty" />
      </label>
      <label className="field">
        Limit price (money per unit)
        <input type="number" min={0.001} step={0.001} value={price} onChange={(e) => setPrice(e.target.value)} data-testid="order-price" />
      </label>
      <dl className="kv">
        <dt>Available {side === 'buy' ? 'cash' : RESOURCE_LABEL[r].toLowerCase()}</dt>
        <dd>{num(milli(self?.spendable ?? 0))}</dd>
        <dt>Gross at limit</dt>
        <dd>{q && p ? num((q * p) / 1000) : '—'} money</dd>
        {pv?.ok && pv.preview && (
          <>
            <dt>Crosses now</dt>
            <dd>
              {pv.preview.match.filledQty} units for {num(pv.preview.match.gross / 1000)} money
            </dd>
            <dt>Rests in book</dt>
            <dd>{pv.preview.match.restingQty} units</dd>
            <dt>Reserved now</dt>
            <dd style={{ fontSize: 12 }}>{resM(pv.preview.escrow)}</dd>
          </>
        )}
      </dl>
      {pv && !pv.ok && <p className="bad" role="alert" style={{ margin: 0 }}>{pv.reason}</p>}
      {pv?.warnings?.map((w) => <p key={w} className="muted" style={{ margin: 0 }}>{w}</p>)}
      <ActionButton
        className="btn primary"
        disabledReason={ro ? 'Read-only campaign' : invalid ?? (pv && !pv.ok ? pv.reason ?? 'Invalid order.' : null)}
        onClick={async () => { const res = await exec({ type: 'marketOrder', side, resource: r, qty: q, price: p }, `${cap(side)} order placed for ${q} ${RESOURCE_LABEL[r].toLowerCase()}.`); if (res.ok) setPv(null); }}
        data-testid="place-order"
      >
        Place {side} order
      </ActionButton>
      <p className="muted" style={{ fontSize: 11.5, margin: 0 }}>Best price first, then oldest order. A seller may receive more than the limit. Sell orders reserve goods; buy orders reserve cash; aborting releases the unfilled remainder.</p>
    </form>
  );
}
