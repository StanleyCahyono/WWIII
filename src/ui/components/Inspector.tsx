import React, { useState } from 'react';
import { useStore } from '../state/store';
import { ui, select, openPanel, centerOn, type Selection } from '../state/ui';
import { useFrame, useQuery, Sym, ActionButton, Modal, FlagChip, useIsMobile } from './common';
import { useObjects, objectToSelection } from '../map/MapView';
import { NODES, unitById, buildingById, countryName, placeName, TERRAIN_LABEL, RESOURCE_LABEL, cityByNode, techById } from '../data/static';
import { gameTime, duration, ageLabel, milli, num, signed, cap, dayOf, hourLabel } from '../format';
import { exec } from '../sim/exec';
import type { StackView } from '../../engine/index';
import type { Frame } from '../sim/protocol';
import type { MapObject } from '../map/objects';
import { RESOURCES } from '../../engine/data-types';

export function Inspector({ mobile = false }: { mobile?: boolean }) {
  const sel = useStore(ui, (s) => s.selection);
  const lost = useStore(ui, (s) => s.lostSelection);
  const expanded = useStore(ui, (s) => s.sheetExpanded);
  const frame = useFrame();
  const objects = useObjects();
  if (!frame) return null;
  let title = 'Nothing selected';
  let body: React.ReactNode = null;
  let sym: React.ReactNode = null;
  if (!sel) {
    body = lost ? (
      <div className="card" role="status" data-testid="lost-selection">
        <strong>Selection lost</strong>
        <p style={{ margin: '4px 0 0' }}>{lost.label}</p>
        <div className="row" style={{ marginTop: 6 }}>
          <button type="button" className="btn small" onClick={() => openPanel('journal')}>
            Open journal
          </button>
          <button type="button" className="btn small" onClick={() => ui.patch({ lostSelection: null })}>
            Dismiss
          </button>
        </div>
      </div>
    ) : (
      <NoSelection frame={frame} />
    );
    if (mobile && !lost) return null;
  } else if (sel.kind === 'stack') {
    const s = frame.view.stacks.find((x) => x.id === sel.id);
    const o = objects.find((x) => x.id === `S:${sel.id}`);
    if (s && o) {
      title = s.name;
      sym = <Sym sidc={o.sidc} size={30} label={o.aria} />;
      body = <StackSheet s={s} o={o} frame={frame} />;
    }
  } else if (sel.kind === 'contact' || sel.kind === 'report') {
    const id = sel.kind === 'contact' ? `C:${sel.id}` : `R:${sel.id}:${sel.ref}`;
    const o = objects.find((x) => x.id === id);
    if (o) {
      title = o.label;
      sym = <Sym sidc={o.sidc} size={30} label={o.aria} />;
      body = sel.kind === 'contact' ? <ContactSheet o={o} frame={frame} /> : <ReportSheet o={o} frame={frame} />;
    }
  } else if (sel.kind === 'city' || sel.kind === 'province') {
    const node = sel.node;
    const n = NODES[node];
    title = sel.kind === 'city' ? cityByNode.get(node)?.name ?? n.name : n.name;
    body = <PlaceSheet node={node} frame={frame} />;
  } else if (sel.kind === 'multi') {
    title = `${sel.ids.length} formations selected`;
    body = <MultiSheet ids={sel.ids} frame={frame} />;
  }

  if (mobile) {
    return (
      <section className={`sheet${expanded ? ' expanded' : ''}`} aria-label="Inspector" data-testid="inspector">
        <div className="sheet-head">
          {sym}
          <h2 style={{ fontSize: 15 }} className="grow" data-testid="inspector-title">{title}</h2>
          <button type="button" className="btn small" aria-expanded={expanded} onClick={() => ui.patch({ sheetExpanded: !expanded })}>
            {expanded ? 'Less' : 'More'}
          </button>
          <button type="button" className="btn small" aria-label="Close inspector" onClick={() => { select(null); ui.patch({ lostSelection: null, sheetExpanded: false }); }} data-testid="sheet-close">
            ✕ Close
          </button>
        </div>
        <div className="sheet-body">{body}</div>
      </section>
    );
  }
  return (
    <div className="col" style={{ gap: 0, height: '100%', minHeight: 0 }} data-testid="inspector">
      <div className="head">
        {sym}
        <div className="grow">
          <h2 style={{ fontSize: 15 }} data-testid="inspector-title">{title}</h2>
          <div className="muted" style={{ fontSize: 12 }}>As of {gameTime(frame.view.tick)}</div>
        </div>
        {sel && (
          <button type="button" className="btn ghost small" aria-label="Clear selection" onClick={() => select(null)}>
            ✕
          </button>
        )}
      </div>
      <div className="body">{body}</div>
    </div>
  );
}

function NoSelection({ frame }: { frame: Frame }) {
  const v = frame.view;
  return (
    <div className="col">
      <p className="dim" style={{ margin: 0 }}>Select a city, province, formation or contact on the map, or pick one from the roster or search. Clicking open ocean clears the selection.</p>
      <div className="card">
        <h4>{v.self.name}</h4>
        <dl className="kv" style={{ marginTop: 6 }}>
          <dt>Cities</dt>
          <dd>{v.cities.length}</dd>
          <dt>Provinces</dt>
          <dd>{v.provinces.length}</dd>
          <dt>Formations</dt>
          <dd>{v.stacks.length}</dd>
          <dt>Research</dt>
          <dd>
            {v.self.research.length}/{v.self.researchSlots} slots busy
          </dd>
          <dt>Jobs queued</dt>
          <dd>{v.self.jobs.length}</dd>
        </dl>
      </div>
      <div className="row wrap">
        <button type="button" className="btn small" onClick={() => openPanel('cities')}>
          Cities
        </button>
        <button type="button" className="btn small" onClick={() => openPanel('research')}>
          Research
        </button>
        <button type="button" className="btn small" onClick={() => openPanel('forces')}>
          Forces
        </button>
      </div>
    </div>
  );
}

function hpOf(s: StackView) {
  const hp = s.units.reduce((a, u) => a + u.hp, 0);
  const mx = s.units.reduce((a, u) => a + u.maxHp, 0);
  return { hp, mx, frac: mx ? hp / mx : 0 };
}

function stackSpeed(s: StackView): number {
  let sp = Infinity;
  for (const u of s.units) {
    const ut = unitById.get(u.type);
    const st = ut?.levels[Math.min(ut.levels.length - 1, Math.max(0, u.level - 1))];
    if (st) sp = Math.min(sp, st.speedKmh);
  }
  return Number.isFinite(sp) ? sp : 0;
}

export function StackSheet({ s, o, frame }: { s: StackView; o: MapObject; frame: Frame }) {
  const [split, setSplit] = useState(false);
  const v = frame.view;
  const { frac } = hpOf(s);
  const node = s.pos.kind === 'node' ? s.pos.node : null;
  const colocated = node !== null ? v.stacks.filter((x) => x.id !== s.id && x.pos.kind === 'node' && x.pos.node === node && x.moveClass === s.moveClass) : [];
  const counts = new Map<string, { n: number; hp: number; mx: number; lvl: number; ready: number }>();
  for (const u of s.units) {
    const c = counts.get(u.type) ?? { n: 0, hp: 0, mx: 0, lvl: u.level, ready: 0 };
    c.n++;
    c.hp += u.hp;
    c.mx += u.maxHp;
    c.ready += u.readiness;
    counts.set(u.type, c);
  }
  const readiness = s.units.length ? Math.round(s.units.reduce((a, u) => a + u.readiness, 0) / s.units.length) : 0;
  const efficiency = s.units.length > 10 ? Math.max(50, 100 - (s.units.length - 10) * 4) : 100;
  const order = s.order;
  const ro = frame.meta.readOnly || frame.meta.reviewMode;
  const remaining = s.eta ? s.eta - v.tick : null;
  return (
    <>
      <div className="sect">
        <div className="row">
          <FlagChip id={v.viewer} />
          <span>{v.self.name} · friendly {o.domain === 'land' ? 'ground' : o.domain} formation</span>
        </div>
        <dl className="kv">
          <dt>Position</dt>
          <dd data-testid="stack-position">{node !== null ? placeName(node) : s.pos.kind === 'edge' ? `${placeName(s.pos.from)} → ${placeName(s.pos.to)}` : 'Airborne'}</dd>
          <dt>Terrain</dt>
          <dd>{node !== null ? TERRAIN_LABEL[NODES[node].terrain] : '—'}</dd>
          <dt>Strength (HP)</dt>
          <dd>{Math.round(frac * 100)}%</dd>
          <dt>Readiness</dt>
          <dd>{readiness}%{readiness < 70 ? ' (not ready)' : ''}</dd>
          <dt>Supply</dt>
          <dd>{cap(s.supply)}</dd>
          <dt>Speed</dt>
          <dd>{stackSpeed(s)} km/h (slowest unit)</dd>
          <dt>Stack efficiency</dt>
          <dd>
            {efficiency}% {s.units.length > 10 ? '(overstacked)' : '(group size OK)'}
          </dd>
          <dt>Fire control</dt>
          <dd>{s.firePolicy === 'hold' ? 'Hold unless ordered' : s.firePolicy === 'return_fire' ? 'Return fire' : 'Engage eligible contacts'}</dd>
          {s.engagement && (
            <>
              <dt>Engagement</dt>
              <dd className="bad">In combat</dd>
            </>
          )}
          {s.refit && (
            <>
              <dt>Maintenance</dt>
              <dd>Refitting (half strength)</dd>
            </>
          )}
        </dl>
      </div>
      <div className="sect" data-testid="active-order">
        <h4>Present activity</h4>
        {order ? (
          <div className="card">
            {order.kind === 'move' ? (
              <>
                <div>
                  Moving to <strong>{placeName(order.dest)}</strong>
                  {order.waypoints.length ? ` via ${order.waypoints.map(placeName).join(', ')}` : ''}
                </div>
                <dl className="kv" style={{ marginTop: 4 }}>
                  <dt>Remaining duration</dt>
                  <dd>{duration(remaining)}</dd>
                  <dt>Arrival time</dt>
                  <dd>{s.eta ? gameTime(s.eta) : '—'}</dd>
                  <dt>Issued</dt>
                  <dd>{gameTime(order.issuedAt)}</dd>
                  {order.warConfirmed.length > 0 && (
                    <>
                      <dt>War accepted with</dt>
                      <dd className="bad">{order.warConfirmed.map(countryName).join(', ')}</dd>
                    </>
                  )}
                </dl>
              </>
            ) : (
              <div>Attack order {order.targetNode !== null ? `on ${placeName(order.targetNode)}` : 'on a contact'}</div>
            )}
          </div>
        ) : (
          <p className="muted" style={{ margin: 0 }}>Holding position — no orders.</p>
        )}
        {s.air && (
          <dl className="kv">
            <dt>Air state</dt>
            <dd>{cap(s.air.state)}</dd>
            <dt>Home base</dt>
            <dd>{'node' in s.air.home ? placeName(s.air.home.node) : 'Carrier'}</dd>
            {s.air.patrol && (
              <>
                <dt>Patrol</dt>
                <dd>
                  {s.air.patrol.radiusKm} km until {gameTime(s.air.patrol.until)}
                </dd>
              </>
            )}
            {s.air.refuelUntil && (
              <>
                <dt>Refuelling until</dt>
                <dd>{gameTime(s.air.refuelUntil)}</dd>
              </>
            )}
          </dl>
        )}
      </div>
      <div className="sect">
        <h4>Authorized actions</h4>
        <div className="actions">
          <ActionButton className="btn primary" disabledReason={ro ? 'Read-only campaign' : null} onClick={() => ui.patch({ mode: { kind: 'move', stacks: [s.id], waypoints: [], dest: null } })} data-testid="action-move">
            Move…
          </ActionButton>
          <ActionButton disabledReason={ro ? 'Read-only campaign' : !order ? 'No active order to stop.' : null} onClick={() => exec({ type: 'stop', stack: s.id }, `${s.name}: orders cancelled.`)}>
            Stop
          </ActionButton>
          <ActionButton disabledReason={ro ? 'Read-only campaign' : s.units.length < 2 ? 'A single unit cannot be split.' : s.pos.kind !== 'node' ? 'Split only at a province or sea zone.' : null} onClick={() => setSplit(true)}>
            Split…
          </ActionButton>
          <ActionButton disabledReason={ro ? 'Read-only campaign' : colocated.length === 0 ? 'No other friendly formation of the same domain here.' : null} onClick={() => exec({ type: 'merge', stacks: [s.id, ...colocated.map((c) => c.id)] }, `Merged ${colocated.length + 1} formations.`)}>
            Merge here ({colocated.length})
          </ActionButton>
          <ActionButton disabledReason={ro ? 'Read-only campaign' : null} onClick={() => exec({ type: 'setRefit', stack: s.id, refit: !s.refit }, s.refit ? 'Refit ended.' : 'Refit started.')}>
            {s.refit ? 'End refit' : 'Refit'}
          </ActionButton>
        </div>
        <label className="row" style={{ gap: 6, fontSize: 13 }}>
          Fire control
          <select value={s.firePolicy} disabled={ro} onChange={(e) => exec({ type: 'setFirePolicy', stack: s.id, policy: e.target.value as 'hold' | 'return_fire' | 'engage' })}>
            <option value="hold">Hold unless ordered</option>
            <option value="return_fire">Return fire</option>
            <option value="engage">Engage eligible contacts</option>
          </select>
        </label>
      </div>
      <div className="sect">
        <h4>Units ({s.units.length})</h4>
        <table className="data">
          <thead>
            <tr>
              <th>Unit</th>
              <th className="num">#</th>
              <th className="num">HP</th>
              <th className="num">Rdy</th>
            </tr>
          </thead>
          <tbody>
            {[...counts.entries()].map(([t, c]) => (
              <tr key={t}>
                <td>
                  <button type="button" className="btn ghost small" style={{ padding: 0, minHeight: 0, textAlign: 'left' }} onClick={() => openPanel('dossier', { unit: t, stack: s.id })} aria-label={`Open dossier for ${unitById.get(t)?.name ?? t}`}>
                    {unitById.get(t)?.name ?? t}
                  </button>
                  <div className="muted" style={{ fontSize: 11 }}>Level {c.lvl}</div>
                </td>
                <td className="num">{c.n}</td>
                <td className="num">{Math.round((c.hp / Math.max(1, c.mx)) * 100)}%</td>
                <td className="num">{Math.round(c.ready / c.n)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {split && <SplitDialog s={s} onClose={() => setSplit(false)} />}
    </>
  );
}

function SplitDialog({ s, onClose }: { s: StackView; onClose: () => void }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const n = picked.size;
  const reason = n === 0 ? 'Pick at least one unit to detach.' : n >= s.units.length ? 'Leave at least one unit in the original formation.' : null;
  return (
    <Modal
      title={`Split ${s.name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <ActionButton className="btn primary" disabledReason={reason} onClick={async () => { const r = await exec({ type: 'split', stack: s.id, units: [...picked] }, `Split ${n} unit(s) from ${s.name}.`); if (r.ok) onClose(); }}>
            Split {n} unit(s)
          </ActionButton>
        </>
      }
    >
      <p className="dim">Before: {s.units.length} units. After: {s.units.length - n} stay, {n} form a new formation. Health is conserved; no unit is duplicated.</p>
      <table className="data">
        <tbody>
          {s.units.map((u) => (
            <tr key={u.id}>
              <td>
                <label className="row" style={{ gap: 6 }}>
                  <input type="checkbox" checked={picked.has(u.id)} onChange={() => setPicked((p) => { const q = new Set(p); q.has(u.id) ? q.delete(u.id) : q.add(u.id); return q; })} />
                  {unitById.get(u.type)?.name ?? u.type} (L{u.level})
                </label>
              </td>
              <td className="num">{Math.round((u.hp / u.maxHp) * 100)}% HP</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

function ContactSheet({ o, frame }: { o: MapObject; frame: Frame }) {
  const c = frame.view.contacts.find((x) => x.id === o.ref)!;
  const levelText: Record<string, string> = {
    contact: 'Radar/sensor contact only — broad domain and position. Owner, type, strength and destination unknown.',
    unidentified: 'Visual contact, not identified — owner and detected count may be known; type unknown.',
    identified: 'Identified — observed unit types and condition as of the observation.',
    stale: 'Stale — last known position; current position unknown.',
  };
  return (
    <>
      <div className="sect" data-testid="contact-sheet">
        <dl className="kv">
          <dt>Knowledge</dt>
          <dd>
            <span className={`tag${c.level === 'stale' ? ' stale' : ''}`}>{cap(c.level)}</span>
          </dd>
          <dt>Domain</dt>
          <dd style={{ textTransform: 'capitalize' }}>{o.domain === 'sea' ? 'Surface' : o.domain}</dd>
          <dt>Owner</dt>
          <dd>{c.owner ? countryName(c.owner) : 'Unknown'}</dd>
          <dt>Affiliation</dt>
          <dd style={{ textTransform: 'capitalize' }}>{o.affiliation}</dd>
          <dt>Last observed</dt>
          <dd>
            {gameTime(c.observedAt)} ({ageLabel(c.ageMin)})
          </dd>
          <dt>Near</dt>
          <dd>{c.node !== null ? placeName(c.node) : 'Open area'}</dd>
          {c.count !== undefined && (
            <>
              <dt>Detected count</dt>
              <dd>{c.count}</dd>
            </>
          )}
        </dl>
        <p className="dim" style={{ margin: 0, fontSize: 12.5 }}>{levelText[c.level]}</p>
      </div>
      {c.units && (
        <div className="sect">
          <h4>Observed units</h4>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {c.units.map((u, i) => (
              <li key={i}>
                {unitById.get(u.type)?.name ?? u.type} — {Math.round(u.hpPct)}% condition
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="sect">
        <h4>Actions</h4>
        <div className="actions">
          <button type="button" className="btn" onClick={() => openPanel('intel', { node: c.node })}>
            Intelligence on this area
          </button>
          {c.owner && (
            <button type="button" className="btn" onClick={() => openPanel('diplomacy', { country: c.owner })}>
              Diplomacy with {countryName(c.owner)}
            </button>
          )}
          <button type="button" className="btn" onClick={() => { const p = ui.get().pinned; ui.patch({ pinned: p.includes(o.id) ? p.filter((x) => x !== o.id) : [...p, o.id] }); }}>
            {ui.get().pinned.includes(o.id) ? 'Unpin' : 'Pin report'}
          </button>
        </div>
        <p className="muted" style={{ fontSize: 12 }}>To attack, select one of your formations and use Move… onto this contact's province; the engine checks visibility, war status and range.</p>
      </div>
    </>
  );
}

function ReportSheet({ o, frame }: { o: MapObject; frame: Frame }) {
  const r = frame.view.reports.find((x) => x.id === o.ref)!;
  const s = r.stacks.find((x) => `R:${r.id}:${x.ref}` === o.id);
  return (
    <div className="sect" data-testid="report-sheet">
      <span className="tag stale">Frozen snapshot</span>
      <dl className="kv">
        <dt>Source</dt>
        <dd>
          {cap(r.source)}
          {r.shared ? ' (shared by partner)' : ''}
        </dd>
        <dt>As of</dt>
        <dd>{gameTime(r.observedAt)}</dd>
        <dt>Expires</dt>
        <dd>{gameTime(r.expiresAt)}</dd>
        <dt>Confidence</dt>
        <dd>{Math.round(r.confidence * 100)}%</dd>
        <dt>Owner</dt>
        <dd>{s ? countryName(s.owner) : '—'}</dd>
        <dt>Reported at</dt>
        <dd>{s?.node != null ? placeName(s.node) : '—'}</dd>
        {s?.destination != null && (
          <>
            <dt>Reported destination</dt>
            <dd>{placeName(s.destination)}</dd>
          </>
        )}
      </dl>
      {s && (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {s.units.map((u, i) => (
            <li key={i}>
              {u.count}× {unitById.get(u.type)?.name ?? u.type}
            </li>
          ))}
        </ul>
      )}
      <p className="muted" style={{ fontSize: 12 }}>The marker stays at the reported position even if the formation has moved since. It is not live.</p>
    </div>
  );
}

interface ProvInfo {
  node: number;
  name: string;
  kind: string;
  terrain: string;
  coastal: boolean;
  deposit: string | null;
  owner: string | null;
  homeland: string | null;
  control: string;
  status: string | null;
  vp: number;
  outside: boolean;
  territory: { code: string; name: string; status: string } | null;
  city: { key: string; name: string; tier: number; capital: boolean; port: boolean } | null;
  private: null | { morale: number; targetMorale: number; factors: { key: string; label: string; value: number }[]; population: number; buildings: { type: string; level: number; condition: number }[]; output: Record<string, number>; condition: number | null; rally: number | null; jobs: { id: string; kind: string; building?: string; unit?: string; startedAt: number | null; endsAt: number | null; enqueuedAt: number; reason?: string }[] };
}

export function PlaceSheet({ node, frame }: { node: number; frame: Frame }) {
  const q = useQuery<ProvInfo>('provinceInspector', [node]);
  const p = q.data;
  const n = NODES[node];
  const v = frame.view;
  const ro = frame.meta.readOnly || frame.meta.reviewMode;
  const own = p?.owner === v.viewer;
  if (n.kind === 'sea')
    return (
      <dl className="kv">
        <dt>Sea sector</dt>
        <dd>{n.name}</dd>
        <dt>Terrain</dt>
        <dd>{TERRAIN_LABEL[n.terrain]}</dd>
      </dl>
    );
  if (!p) return <p className="muted">Loading…</p>;
  if (p.outside)
    return (
      <div className="col">
        <span className="tag">Outside campaign</span>
        <p className="dim" style={{ margin: 0 }}>{p.territory?.name ?? p.name}: drawn for geography only. No seat, production, market account, AI or score; land transit is blocked. International sea lanes remain open.</p>
        {p.territory && <p className="muted" style={{ margin: 0 }}>Status: {p.territory.status.replace(/_/g, ' ')}</p>}
      </div>
    );
  const rel = v.relations.find((r) => r.country === p.owner);
  const status = p.status ?? '—';
  const canMobilize = own && status !== 'occupied';
  return (
    <>
      <div className="sect" data-testid="place-sheet">
        <div className="row">
          <FlagChip id={p.owner} />
          <span>
            {p.city ? 'City' : 'Rural province'} · controlled by <strong>{countryName(p.owner)}</strong>
            {own ? ' (you)' : ''}
          </span>
        </div>
        <dl className="kv">
          {p.city && (
            <>
              <dt>Province</dt>
              <dd>{p.name}</dd>
            </>
          )}
          <dt>Status</dt>
          <dd style={{ textTransform: 'capitalize' }}>
            {p.control === 'rebel' ? 'Rebel control' : status}
            {p.homeland && p.homeland !== p.owner ? ` (homeland of ${countryName(p.homeland)})` : ''}
          </dd>
          <dt>Terrain</dt>
          <dd>{TERRAIN_LABEL[p.terrain]}</dd>
          <dt>Victory value</dt>
          <dd>{p.vp} VP (fixed)</dd>
          {p.city && (
            <>
              <dt>City tier</dt>
              <dd>
                {p.city.tier}
                {p.city.capital ? ' · capital' : ''}
                {p.city.port ? ' · port' : ''}
              </dd>
            </>
          )}
          <dt>Deposit</dt>
          <dd>{p.deposit ? RESOURCE_LABEL[p.deposit as keyof typeof RESOURCE_LABEL] : 'None'}</dd>
          <dt>Coastal</dt>
          <dd>{p.coastal ? 'Yes' : 'No'}</dd>
          {!own && rel && (
            <>
              <dt>Relation</dt>
              <dd>{rel.war ? 'At war' : rel.sameCoalition ? 'Coalition partner' : `You grant ${rel.myStatusToThem.replace(/_/g, ' ')} · they grant ${rel.theirStatusToMe.replace(/_/g, ' ')}`}</dd>
            </>
          )}
        </dl>
      </div>
      {own && p.private && (
        <>
          <div className="sect">
            <h4>Morale & output</h4>
            <dl className="kv">
              <dt>Population</dt>
              <dd>{num(p.private.population)}k</dd>
              <dt>Morale</dt>
              <dd>
                {Math.round(p.private.morale)} → target {Math.round(p.private.targetMorale)} {p.private.morale < 33 ? '(uprising risk)' : ''}
              </dd>
              {p.private.condition !== null && (
                <>
                  <dt>Condition</dt>
                  <dd>{p.private.condition}%</dd>
                </>
              )}
            </dl>
            <details>
              <summary style={{ cursor: 'pointer' }}>Morale factors (signed)</summary>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12.5 }}>
                {p.private.factors.map((f) => (
                  <li key={f.key}>
                    {f.label}: {signed(f.value)}
                  </li>
                ))}
              </ul>
            </details>
            <div style={{ fontSize: 12.5 }}>
              Daily output: {RESOURCES.filter((r) => p.private!.output[r]).map((r) => `${num(milli(p.private!.output[r]))} ${RESOURCE_LABEL[r].toLowerCase()}`).join(', ') || 'none'}
            </div>
          </div>
          <div className="sect">
            <h4>Buildings</h4>
            {p.private.buildings.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>No buildings.</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>
                {p.private.buildings.map((b, i) => (
                  <li key={i}>
                    {buildingById.get(b.type)?.name ?? b.type} L{b.level} · {b.condition}% condition
                  </li>
                ))}
              </ul>
            )}
            <h4>Queue</h4>
            {p.private.jobs.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>Nothing queued.</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }} data-testid="place-queue">
                {p.private.jobs.map((j) => (
                  <li key={j.id}>
                    {j.unit ? unitById.get(j.unit)?.name : j.building ? buildingById.get(j.building)?.name : cap(j.kind)} — {j.startedAt !== null ? `working, done ${j.endsAt ? gameTime(j.endsAt) : '—'}` : j.reason ? `blocked: ${j.reason}` : 'queued'}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="sect">
            <h4>Actions</h4>
            <div className="actions">
              {p.city && (
                <button type="button" className="btn primary" onClick={() => openPanel('cities', { city: p.city!.key })} data-testid="open-city-sheet">
                  Open city sheet
                </button>
              )}
              <ActionButton disabledReason={ro ? 'Read-only campaign' : null} onClick={() => openPanel('cities', { city: p.city?.key, node: p.city ? undefined : node, tab: 'build' })} data-testid="inspector-build">
                Build…
              </ActionButton>
              {p.city && (
                <ActionButton disabledReason={ro ? 'Read-only campaign' : !canMobilize ? 'Occupied cities cannot mobilize. Annex the city first (homeland and annexed cities only).' : null} onClick={() => openPanel('cities', { city: p.city!.key, tab: 'mobilize' })} data-testid="inspector-mobilize">
                  Mobilize…
                </ActionButton>
              )}
              {p.city && (
                <button type="button" className="btn" onClick={() => openPanel('intel', { node })}>
                  Agents
                </button>
              )}
            </div>
            {p.city && (
              <div className="row">
                <button type="button" className="btn small" onClick={() => cycleCity(-1)} aria-label="Previous city">
                  ← Prev city
                </button>
                <button type="button" className="btn small" onClick={() => cycleCity(1)} aria-label="Next city">
                  Next city →
                </button>
              </div>
            )}
          </div>
        </>
      )}
      {!own && (
        <div className="sect">
          <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>Public geography only. Private balances, orders and facilities are not visible without an intelligence report (observed {gameTime(v.tick)}).</p>
          <div className="actions">
            {p.owner && (
              <button type="button" className="btn" onClick={() => openPanel('diplomacy', { country: p.owner })} data-testid="inspect-neighbour">
                Diplomacy with {countryName(p.owner)}
              </button>
            )}
            <button type="button" className="btn" onClick={() => openPanel('intel', { node })}>
              Intelligence mission
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function cycleCity(dir: 1 | -1) {
  void import('../screens/Game').then((m) => m.cycle('city', dir));
}

function MultiSheet({ ids, frame }: { ids: string[]; frame: Frame }) {
  const stacks = ids.map((id) => frame.view.stacks.find((s) => `S:${s.id}` === id)).filter(Boolean) as StackView[];
  const classes = new Set(stacks.map((s) => s.moveClass));
  const nodes = new Set(stacks.map((s) => (s.pos.kind === 'node' ? s.pos.node : -1)));
  const ro = frame.meta.readOnly || frame.meta.reviewMode;
  const mergeReason = nodes.size !== 1 || nodes.has(-1) ? 'Formations must be in the same province to merge.' : classes.size !== 1 ? 'Formations of different domains cannot merge.' : null;
  return (
    <>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {stacks.map((s) => (
          <li key={s.id}>
            <button type="button" className="btn ghost small" onClick={() => select({ kind: 'stack', id: s.id })}>
              {s.name}
            </button>{' '}
            <span className="muted">{s.units.length} units · {s.pos.kind === 'node' ? placeName(s.pos.node) : 'moving'}</span>
          </li>
        ))}
      </ul>
      <div className="sect">
        <h4>Common actions</h4>
        <div className="actions">
          <ActionButton className="btn primary" disabledReason={ro ? 'Read-only campaign' : null} onClick={() => ui.patch({ mode: { kind: 'move', stacks: stacks.map((s) => s.id), waypoints: [], dest: null } })}>
            Move all…
          </ActionButton>
          <ActionButton disabledReason={ro ? 'Read-only campaign' : stacks.every((s) => !s.order) ? 'None of these formations has an order.' : null} onClick={async () => { for (const s of stacks) if (s.order) await exec({ type: 'stop', stack: s.id }); }}>
            Stop all
          </ActionButton>
          <ActionButton disabledReason={ro ? 'Read-only campaign' : mergeReason} onClick={() => exec({ type: 'merge', stacks: stacks.map((s) => s.id) }, 'Merged.')}>
            Merge
          </ActionButton>
        </div>
        {classes.size > 1 && <p className="warn" style={{ fontSize: 12.5 }}>Exceptions: mixed domains ({[...classes].join(', ')}) — moves are validated per formation; some may be refused.</p>}
      </div>
    </>
  );
}

export { objectToSelection, centerOn, techById, dayOf, hourLabel };
export type { Selection };
void useIsMobile;
