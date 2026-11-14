import React, { useState } from 'react';
import { useFrame, useQuery } from './common';
import { ui, openPanel } from '../state/ui';
import { useStore } from '../state/store';
import { RESOURCE_LABEL, RESOURCE_SHORT } from '../data/static';
import { milli, num, signed, duration } from '../format';
import type { Resource } from '../../engine/data-types';

interface RS {
  resource: Resource;
  stock: number;
  reserved: number;
  onHand: number;
  spendable: number;
  committedJobs: number;
  grossPerDay: number;
  consumptionPerDay: number;
  netPerDay: number;
  forecast24h: number;
  forecast72h: number;
  hoursToDepletion: number | null;
  insufficientStock: boolean;
  negativeNet: boolean;
}

export function ResourceDetail({ r }: { r: RS }) {
  return (
    <div className="col" style={{ gap: 4 }}>
      <strong>{RESOURCE_LABEL[r.resource]}</strong>
      <dl className="kv">
        <dt>On hand</dt>
        <dd>{num(milli(r.onHand))}</dd>
        <dt>Spendable</dt>
        <dd>{num(milli(r.spendable))}</dd>
        <dt>Reserved (market escrow)</dt>
        <dd>{num(milli(r.reserved))}</dd>
        <dt>Committed to queued jobs</dt>
        <dd>{num(milli(r.committedJobs))}</dd>
        <dt>Gross production</dt>
        <dd>+{num(milli(r.grossPerDay))} /day</dd>
        <dt>Consumption (upkeep)</dt>
        <dd>−{num(milli(r.consumptionPerDay))} /day</dd>
        <dt>Net change</dt>
        <dd>
          {signed(milli(r.netPerDay))} /day ({signed(milli(r.netPerDay) / 24, 1)} /h)
        </dd>
        <dt>Forecast</dt>
        <dd>
          {num(milli(r.forecast24h))} in 24 h · {num(milli(r.forecast72h))} in 72 h
        </dd>
        {r.hoursToDepletion !== null && (
          <>
            <dt>Depleted in</dt>
            <dd className="bad">{duration(r.hoursToDepletion * 60)}</dd>
          </>
        )}
      </dl>
      {r.insufficientStock && <div className="bad">Insufficient stock: upkeep went unpaid in the last hour.</div>}
      {!r.insufficientStock && r.negativeNet && <div className="warn">Negative net production (stock still available).</div>}
    </div>
  );
}

export function ShortageLedger({ resource, onClose }: { resource: Resource; onClose: () => void }) {
  const q = useQuery<{ city: string; name: string; produces: number; localUpkeep: number; net: number; jobsUsing: string[] }[]>('shortageBreakdown', [resource]);
  const frame = useFrame();
  const r = frame?.view.self.resources.find((x) => x.resource === resource) as RS | undefined;
  return (
    <div className="card" role="region" aria-label={`${RESOURCE_LABEL[resource]} ledger row`} style={{ margin: 6, maxHeight: 260, overflow: 'auto' }} data-testid="ledger-row">
      <div className="row">
        <strong>{RESOURCE_LABEL[resource]} — city-by-city</strong>
        <span className="muted">net {signed(milli(r?.netPerDay ?? 0))}/day{r?.hoursToDepletion != null ? ` · depleted in ${duration(r.hoursToDepletion * 60)}` : ''}</span>
        <button type="button" className="btn small close-x" onClick={onClose} aria-label="Close ledger row">
          Close
        </button>
        <button type="button" className="btn small" onClick={() => openPanel('market', resource)}>
          Market
        </button>
      </div>
      {!q.data ? (
        <p className="muted">Loading…</p>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>City</th>
              <th className="num">Produces /day</th>
              <th className="num">Local upkeep /day</th>
              <th className="num">Net /day</th>
              <th className="num">Jobs using</th>
            </tr>
          </thead>
          <tbody>
            {q.data.slice(0, 40).map((c) => (
              <tr key={c.city}>
                <td>{c.name}</td>
                <td className="num">{num(milli(c.produces))}</td>
                <td className="num">{num(milli(c.localUpkeep))}</td>
                <td className="num">{signed(milli(c.net))}</td>
                <td className="num">{c.jobsUsing.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function ResourceStrip({ open }: { open: boolean }) {
  const frame = useFrame()!;
  const ledgerOpen = useStore(ui, (s) => s.ledgerOpen);
  const [tip, setTip] = useState<{ r: RS; x: number; y: number } | null>(null);
  const res = frame.view.self.resources as RS[];
  return (
    <>
      <div className={`resstrip${open ? ' open' : ''}`} role="toolbar" aria-label="Resources (stock and net change per day)" data-testid="resource-strip">
        {res.map((r) => {
          const short = r.insufficientStock;
          const neg = r.negativeNet;
          const label = `${RESOURCE_LABEL[r.resource]}: ${num(milli(r.spendable))} spendable, net ${signed(milli(r.netPerDay))} per day${short ? ', shortage' : neg ? ', negative net' : ''}. Open market.`;
          return (
            <span key={r.resource} style={{ display: 'flex' }}>
              <button
                type="button"
                className={`res${short ? ' short' : neg ? ' negative' : ''}`}
                aria-label={label}
                aria-describedby={tip?.r.resource === r.resource ? 'res-tip' : undefined}
                onMouseEnter={(e) => setTip({ r, x: e.currentTarget.getBoundingClientRect().left, y: e.currentTarget.getBoundingClientRect().bottom })}
                onMouseLeave={() => setTip(null)}
                onFocus={(e) => setTip({ r, x: e.currentTarget.getBoundingClientRect().left, y: e.currentTarget.getBoundingClientRect().bottom })}
                onBlur={() => setTip(null)}
                onClick={() => openPanel('market', r.resource)}
                data-testid={`res-${r.resource}`}
              >
                <span className="rlabel">{RESOURCE_SHORT[r.resource]}</span>
                <span className="rstock">{num(milli(r.spendable))}</span>
                <span className={`rnet ${r.netPerDay < 0 ? 'bad' : 'ok'}`}>
                  {signed(milli(r.netPerDay))}/d
                </span>
                {short && <span className="tag bad" aria-hidden>short</span>}
                {open && <span className="muted" style={{ fontSize: 11 }}>gross +{num(milli(r.grossPerDay))} · use −{num(milli(r.consumptionPerDay))}</span>}
              </button>
              {(short || neg) && (
                <button type="button" className="res" aria-expanded={ledgerOpen === r.resource} aria-label={`Expand ${RESOURCE_LABEL[r.resource]} ledger row: users by city and time until depletion`} onClick={() => ui.patch({ ledgerOpen: ledgerOpen === r.resource ? null : r.resource })} data-testid={`ledger-${r.resource}`}>
                  ▾
                </button>
              )}
            </span>
          );
        })}
      </div>
      {ledgerOpen && (
        <div style={{ position: 'fixed', top: 'calc(var(--top-h) + var(--strip-h))', left: 'var(--rail-w)', zIndex: 55, width: 640, maxWidth: '100%' }}>
          <ShortageLedger resource={ledgerOpen as Resource} onClose={() => ui.patch({ ledgerOpen: null })} />
        </div>
      )}
      {tip && (
        <div className="res-tip" id="res-tip" role="tooltip" style={{ left: Math.min(tip.x, window.innerWidth - 310), top: tip.y + 4 }}>
          <ResourceDetail r={tip.r} />
          <div className="muted" style={{ marginTop: 4 }}>Click: open market with this good</div>
        </div>
      )}
    </>
  );
}
