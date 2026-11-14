import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, createStore } from '../state/store';
import { ui, select } from '../state/ui';
import { getHost } from '../sim/host';
import { useFrame, ActionButton } from './common';
import { NODES, placeName, countryName, TERRAIN_LABEL } from '../data/static';
import { gameTime, duration, cap } from '../format';
import { exec } from '../sim/exec';
import type { RouteLine } from '../map/renderer';
import { routeFromSegments } from '../map/MapView';
import { targeting, pointKey } from '../state/targeting';
import { TargetList } from './Orders';

interface Seg { from: number; to: number; mode: string; kind: string; km: number; terrain: string; hours: number; arriveTick: number; owner: string | null; actOfWar: string | null; label?: string }
interface Plan { ok: boolean; segments: Seg[]; arriveTick: number; totalHours: number; actOfWar: string[]; modeChanges: { at: number; from: string; to: string }[]; reason?: string; detail?: string; blockingOwners?: string[] }

const planStore = createStore<{ key: string; plans: Record<string, Plan | null>; validation: Record<string, { ok: boolean; code?: string; reason?: string; warnings?: string[] }> }>({ key: '', plans: {}, validation: {} });

export function useMoveRoutes(): RouteLine[] {
  const mode = useStore(ui, (s) => s.mode);
  const ps = useStore(planStore);
  const frame = useFrame();
  return useMemo(() => {
    if (mode.kind !== 'move' || !frame) return [];
    const out: RouteLine[] = [];
    for (const id of mode.stacks) {
      const p = ps.plans[id];
      const s = frame.view.stacks.find((x) => x.id === id);
      if (!p || !s) continue;
      const pts = routeFromSegments(s.lonlat, p.segments);
      const war = p.segments.filter((g) => g.actOfWar).map((g) => NODES[g.to].center);
      const val = ps.validation[id];
      out.push({ id: `pv-${id}`, points: pts, kind: p.ok && (val?.ok || val?.code === 'act_of_war') ? 'preview' : 'blocked', label: p.ok ? `ETA ${gameTime(p.arriveTick)}` : 'Unreachable', warPoints: war });
    }
    return out;
  }, [mode, ps, frame]);
}

export function MoveOrder() {
  const mode = useStore(ui, (s) => s.mode);
  const frame = useFrame();
  const ps = useStore(planStore);
  const [confirmWar, setConfirmWar] = useState(false);
  const [busy, setBusy] = useState(false);
  const host = getHost();
  const confirmRef = useRef<{ reason: string | null; confirm: () => void } | null>(null);
  useEffect(() => {
    // Enter on the focused map confirms (same validation as the button)
    const f = () => {
      const c = confirmRef.current;
      if (c && !c.reason && !busyRef.current) c.confirm();
    };
    window.addEventListener('wc-confirm-order', f);
    return () => window.removeEventListener('wc-confirm-order', f);
  }, []);
  const busyRef = useRef(false);
  busyRef.current = busy;
  const m = mode.kind === 'move' ? mode : null;
  const key = m ? JSON.stringify([m.stacks, m.waypoints, m.dest, frame?.view.tick]) : '';

  useEffect(() => {
    if (!m || m.dest === null) {
      planStore.set({ key: '', plans: {}, validation: {} });
      return;
    }
    let alive = true;
    (async () => {
      const plans: Record<string, Plan | null> = {};
      const validation: Record<string, { ok: boolean; code?: string; reason?: string; warnings?: string[] }> = {};
      for (const id of m.stacks) {
        plans[id] = await host.query<Plan | null>('planRoute', id, m.dest, m.waypoints).catch(() => null);
        const v = await host.preview({ type: 'move', stack: id, dest: m.dest!, waypoints: m.waypoints });
        validation[id] = v.ok ? { ok: true, warnings: v.warnings } : { ok: false, code: v.code, reason: v.reason };
      }
      if (alive) planStore.set({ key, plans, validation });
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    setConfirmWar(false);
  }, [m?.dest, m?.waypoints.length]);
  useMoveHoverPreview(m);

  useEffect(() => {
    const cancel = () => {
      const cur = ui.get().mode;
      if (cur.kind === 'move') {
        // cancel restores the original selection, consumes no time
        ui.patch({ mode: { kind: 'idle' } });
        if (cur.stacks.length === 1) select({ kind: 'stack', id: cur.stacks[0] });
        planStore.set({ key: '', plans: {}, validation: {} });
      }
    };
    window.addEventListener('wc-cancel-mode', cancel);
    return () => window.removeEventListener('wc-cancel-mode', cancel);
  }, []);

  if (!m || !frame) return null;
  const stacks = m.stacks.map((id) => frame.view.stacks.find((s) => s.id === id)).filter(Boolean);
  const first = m.stacks[0];
  const plan = ps.plans[first];
  const val = ps.validation[first];
  const war = [...new Set(m.stacks.flatMap((id) => ps.plans[id]?.actOfWar ?? []))];
  const needsWar = war.length > 0 || m.stacks.some((id) => ps.validation[id]?.code === 'act_of_war');
  const blocked = m.stacks.filter((id) => ps.validation[id] && !ps.validation[id].ok && ps.validation[id].code !== 'act_of_war');
  const stale = ps.key !== key;
  const cancel = () => window.dispatchEvent(new CustomEvent('wc-cancel-mode'));
  const confirm = async () => {
    setBusy(true);
    let okCount = 0;
    for (const id of m.stacks) {
      const r = await exec({ type: 'move', stack: id, dest: m.dest!, waypoints: m.waypoints, confirmActOfWar: needsWar ? war : undefined });
      if (r.ok) okCount++;
    }
    setBusy(false);
    ui.patch({ mode: { kind: 'idle' } });
    planStore.set({ key: '', plans: {}, validation: {} });
    if (m.stacks.length === 1) select({ kind: 'stack', id: m.stacks[0] });
    else select({ kind: 'multi', ids: m.stacks.map((s) => `S:${s}`) });
    void okCount;
  };
  const reason = m.dest === null ? 'Pick a destination on the map (Shift-click adds a waypoint).' : stale ? 'Computing route preview…' : blocked.length === m.stacks.length ? val?.reason ?? 'No legal route.' : needsWar && !confirmWar ? 'Confirm the border consequence first.' : null;
  confirmRef.current = { reason, confirm };

  return (
    <div className="mode-banner" role="dialog" aria-label="Move order" style={{ flexDirection: 'column', alignItems: 'stretch', width: 'min(560px, calc(100% - 20px))', top: 'auto', bottom: 12 }} data-testid="move-panel" onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), cancel())}>
      <div className="row">
        <strong>Move {stacks.length === 1 ? stacks[0]!.name : `${stacks.length} formations`}</strong>
        <span className="muted" style={{ fontSize: 12 }}>Hover to preview · click destination · Shift-click waypoint · Right-click or Esc cancels</span>
      </div>
      <div className="row wrap" style={{ fontSize: 13 }}>
        <span>
          Destination: <strong data-testid="move-dest">{m.dest !== null ? placeName(m.dest) : '—'}</strong>
        </span>
        {m.waypoints.length > 0 && <span>via {m.waypoints.map(placeName).join(' → ')}</span>}
      </div>
      <TargetList>
        <DestPicker />
      </TargetList>
      {m.dest !== null && plan && !stale && (
        <div className="col" style={{ gap: 4, fontSize: 12.5 }}>
          {plan.ok ? (
            <div className="row wrap">
              <span>
                Arrival <strong data-testid="move-eta">{gameTime(plan.arriveTick)}</strong> ({duration(plan.totalHours * 60)})
              </span>
              <span>· {plan.segments.length} legs · {Math.round(plan.segments.reduce((a, s) => a + s.km, 0))} km</span>
              {plan.modeChanges.length > 0 && <span>· mode changes: {plan.modeChanges.map((c) => `${cap(c.from)}→${cap(c.to)} at ${placeName(c.at)}`).join(', ')}</span>}
            </div>
          ) : (
            <div className="bad">Route impossible: {plan.detail ?? plan.reason}</div>
          )}
          {plan.ok && (
            <details>
              <summary style={{ cursor: 'pointer' }}>Terrain cost by leg</summary>
              <table className="data">
                <thead>
                  <tr>
                    <th>Leg</th>
                    <th>Terrain</th>
                    <th>Mode</th>
                    <th className="num">km</th>
                    <th className="num">Hours</th>
                    <th>Owner</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.segments.slice(0, 30).map((s, i) => (
                    <tr key={i}>
                      <td>{placeName(s.to)}{s.label ? ` (${s.label})` : ''}</td>
                      <td>{TERRAIN_LABEL[s.terrain] ?? s.terrain}</td>
                      <td>{cap(s.mode)}</td>
                      <td className="num">{Math.round(s.km)}</td>
                      <td className="num">{s.hours.toFixed(1)}</td>
                      <td className={s.actOfWar ? 'bad' : ''}>{s.owner ? countryName(s.owner) : '—'}{s.actOfWar ? ' ⚠' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
          {needsWar && (
            <div className="card" style={{ borderColor: 'var(--bad)' }} role="alert" data-testid="war-warning">
              <strong className="bad">Border consequence</strong>
              <p style={{ margin: '4px 0' }}>
                This route enters territory of <strong>{war.map(countryName).join(', ') || 'a country'}</strong> without passage rights. Entering will be treated as a <strong>declaration of war</strong> on {war.length > 1 ? 'them' : 'it'}. Cancelling keeps the previous route and relations unchanged.
              </p>
              <label className="row" style={{ gap: 6 }}>
                <input type="checkbox" checked={confirmWar} onChange={(e) => setConfirmWar(e.target.checked)} data-testid="confirm-war" />I accept going to war with {war.map(countryName).join(', ')}
              </label>
            </div>
          )}
          {blocked.length > 0 && (
            <ul className="bad" style={{ margin: 0, paddingLeft: 18 }}>
              {blocked.map((id) => (
                <li key={id}>
                  {frame.view.stacks.find((s) => s.id === id)?.name}: {ps.validation[id].reason}
                </li>
              ))}
            </ul>
          )}
          {val?.warnings?.map((w) => <div key={w} className="warn">{w}</div>)}
        </div>
      )}
      <div className="row">
        <ActionButton className="btn primary" disabledReason={busy ? 'Submitting…' : reason} onClick={confirm} data-testid="confirm-move">
          Confirm move
        </ActionButton>
        <button type="button" className="btn" onClick={cancel} data-testid="cancel-move">
          Cancel
        </button>
        {m.waypoints.length > 0 && (
          <button type="button" className="btn small" onClick={() => ui.patch({ mode: { ...m, waypoints: m.waypoints.slice(0, -1) } })}>
            Remove last waypoint
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Live hover preview while picking a move destination on the map: route ETA / distance for the
 * first formation, or the exact reason (unreachable, illegal), and a border-consequence warning.
 */
function useMoveHoverPreview(m: { stacks: string[]; waypoints: number[]; dest: number | null } | null) {
  const hover = useStore(targeting, (s) => s.hover);
  const host = getHost();
  const tick = useFrame()?.view.tick;
  const cache = useRef(new Map<string, { plan: Plan | null; v: { ok: boolean; code?: string; reason?: string } }>());
  useEffect(() => cache.current.clear(), [tick]);
  const first = m?.stacks[0];
  const wps = m ? m.waypoints.join(',') : '';
  useEffect(() => {
    if (!m || !first || !hover) return;
    const key = pointKey(hover);
    const node = hover.node;
    if (node === null) {
      targeting.patch({ tip: { key, title: 'Off the map', lines: ['Not a destination.'], ok: false, node: null } });
      return;
    }
    const title = `Move to ${placeName(node)}`;
    const show = (r: { plan: Plan | null; v: { ok: boolean; code?: string; reason?: string } }) => {
      if (pointKey(targeting.get().hover) !== key) return;
      const p = r.plan;
      if (!p || !p.ok) return targeting.patch({ tip: { key, title, lines: [p ? `Route impossible: ${p.detail ?? p.reason ?? 'no legal route'}` : 'No legal route.'], ok: false, node } });
      if (!r.v.ok && r.v.code !== 'act_of_war') return targeting.patch({ tip: { key, title, lines: [r.v.reason ?? 'Not possible.'], ok: false, node } });
      const km = Math.round(p.segments.reduce((a, g) => a + g.km, 0));
      const lines = [`Arrives ${gameTime(p.arriveTick)} (${duration(p.totalHours * 60)})`, `${p.segments.length} legs · ${km} km`];
      const war = p.actOfWar.length > 0 || r.v.code === 'act_of_war';
      if (war) lines.push(`Border: entering ${p.actOfWar.map(countryName).join(', ') || 'foreign territory'} is a declaration of war — you confirm in the move bar`);
      if (m.stacks.length > 1) lines.push(`Preview for ${m.stacks.length} formations shows the first; each is validated on confirm`);
      targeting.patch({ tip: { key, title, lines, ok: true, warn: war, node } });
    };
    const ck = `${first}|${node}|${wps}`;
    const hit = cache.current.get(ck);
    if (hit) return show(hit);
    targeting.patch({ tip: { key, title, lines: ['Computing route…'], ok: null, node } });
    let alive = true;
    const t = setTimeout(async () => {
      const wp = wps ? wps.split(',').map(Number) : [];
      const plan = await host.query<Plan | null>('planRoute', first, node, wp).catch(() => null);
      const v = await host.preview({ type: 'move', stack: first, dest: node, waypoints: wp }).catch(() => ({ ok: false, code: 'error', reason: 'Preview failed.' }));
      const r = { plan, v: v.ok ? { ok: true } : { ok: false, code: (v as { code: string }).code, reason: (v as { reason: string }).reason } };
      cache.current.set(ck, r);
      if (alive) show(r);
    }, 70);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hover, first, wps]);
}

/** Accessible list alternative to precise map clicks: choose destination from nearby places. */
function DestPicker() {
  const mode = useStore(ui, (s) => s.mode);
  const frame = useFrame();
  const [q, setQ] = useState('');
  if (mode.kind !== 'move' || !frame) return null;
  const s = frame.view.stacks.find((x) => x.id === mode.stacks[0]);
  const base = s?.lonlat ?? [0, 0];
  const naval = s?.moveClass === 'naval';
  const cands = NODES.filter((n) => !n.outside && (naval ? n.kind === 'sea' || n.coastal : true) && (!q || n.name.toLowerCase().includes(q.toLowerCase())))
    .map((n) => ({ n, d: Math.hypot(n.center[0] - base[0], n.center[1] - base[1]) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 40);
  return (
    <span className="row" style={{ gap: 4 }}>
      <label className="sr-only" htmlFor="dest-filter">Filter destinations</label>
      <input id="dest-filter" type="search" placeholder="Find destination…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 150, minHeight: 28 }} />
      <label className="sr-only" htmlFor="dest-select">Destination</label>
      <select
        id="dest-select"
        value={mode.dest ?? ''}
        onChange={(e) => ui.patch({ mode: { ...mode, dest: e.target.value === '' ? null : Number(e.target.value) } })}
        style={{ maxWidth: 200, minHeight: 28 }}
        data-testid="dest-select"
      >
        <option value="">Choose from list…</option>
        {cands.map(({ n }) => (
          <option key={n.id} value={n.id}>
            {placeName(n.id)}{n.kind === 'sea' ? ' (sea)' : ''}
          </option>
        ))}
      </select>
    </span>
  );
}
