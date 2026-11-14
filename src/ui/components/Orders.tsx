/**
 * Stack order dialogs (attack, retreat, delay, embark/disembark, patrol, rebase, deployables) and
 * the missile launch dialog. Every dialog previews through the engine validator on each change,
 * shows the exact reason when the order is not possible, and commits through exec().
 *
 * Orders that need a target (patrol area, rebase base, attack target, landing zone, missile sector,
 * rally point, embark/retreat destination) use DIRECT MAP TARGETING: the dialog is a compact,
 * non-modal order bar; the map shows a crosshair, hovering a target previews it live (validator
 * answer: ETA / time on station / risk, or the exact reason it is not possible), one click sets the
 * target, and Confirm commits. Esc or right-click cancels. The previous list selectors stay as an
 * accessible fallback ("Choose from a list"), collapsed unless the order was started from the
 * keyboard.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getHost } from '../sim/host';
import { exec } from '../sim/exec';
import { useStore } from '../state/store';
import { ui, startOrder } from '../state/ui';
import { targeting, pointKey, clearTargetHover, type MapPoint } from '../state/targeting';
import { useFrame, useQuery, Modal, ActionButton } from './common';
import { NODES, placeName, countryName, unitById, missileById, TERRAIN_LABEL } from '../data/static';
import { gameTime, duration, resM, pct, cap } from '../format';
import { Icon } from '../icons';
import type { StackView } from '../../engine/index';
import type { CommandInput } from '../sim/host';

export function distKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const toR = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toR;
  const dLon = (b[0] - a[0]) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toR) * Math.cos(b[1] * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** List-based sector picker: the accessible alternative to clicking the map. */
export function NodePicker({ id, origin, value, onChange, maxKm, filter, label = 'Target sector', limit = 60 }: { id: string; origin: [number, number]; value: number | null; onChange: (n: number) => void; maxKm?: number; filter?: (n: (typeof NODES)[number]) => boolean; label?: string; limit?: number }) {
  const [q, setQ] = useState('');
  const cands = useMemo(
    () =>
      NODES.filter((n) => !n.outside && (!filter || filter(n)) && (!q || n.name.toLowerCase().includes(q.toLowerCase()) || placeName(n.id).toLowerCase().includes(q.toLowerCase())))
        .map((n) => ({ n, d: distKm(origin, n.center) }))
        .filter((x) => maxKm === undefined || x.d <= maxKm)
        .sort((a, b) => a.d - b.d)
        .slice(0, limit),
    [q, origin, maxKm, filter, limit],
  );
  return (
    <fieldset>
      <legend>{label}</legend>
      <div className="row wrap">
        <label className="sr-only" htmlFor={`${id}-q`}>Filter {label}</label>
        <input id={`${id}-q`} type="search" placeholder="Filter by name…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 160 }} />
        <label className="sr-only" htmlFor={`${id}-sel`}>{label}</label>
        <select id={`${id}-sel`} value={value ?? ''} onChange={(e) => e.target.value !== '' && onChange(Number(e.target.value))} data-testid={`${id}-select`} style={{ maxWidth: 260 }}>
          <option value="">Choose ({cands.length} in range)…</option>
          {value !== null && !cands.some((c) => c.n.id === value) && <option value={value}>{placeName(value)}</option>}
          {cands.map(({ n, d }) => (
            <option key={n.id} value={n.id}>
              {placeName(n.id)}
              {n.kind === 'sea' ? ' (sea)' : ''} · {Math.round(d)} km
            </option>
          ))}
        </select>
      </div>
    </fieldset>
  );
}

type V = { ok: true; preview: Record<string, unknown>; warnings?: string[] } | { ok: false; code: string; reason: string; details?: unknown };

/** What a map point means for the active order: a candidate command (+ how to adopt it as the
 *  target) or the reason it cannot be a target. */
export interface TargetResolution {
  label: string;
  cmd?: CommandInput | null;
  apply?: () => void;
  reason?: string;
  /** Map highlight: the targeted sector (default: the hovered one) and/or object ids. */
  node?: number | null;
  ids?: string[];
}

export interface TargetingSpec {
  /** Pick purpose; the list fallback keeps its `${id}-select` style test ids. */
  id: string;
  /** What to click ("Click a patrol area centre on the map"). */
  prompt: string;
  resolve: (p: MapPoint) => TargetResolution | null;
  /** Short hover lines from a successful preview (ETA, time on station, risk…). */
  brief?: (p: Record<string, unknown>) => string[];
  /** Current target label, or null. */
  chosen: string | null;
  /** Accessible list fallback (collapsed by default). */
  list: React.ReactNode;
}

function actOfWarList(v: V | null): string[] {
  if (!v || v.ok || v.code !== 'act_of_war') return [];
  const a = (v.details as { actOfWar?: string[] | string } | undefined)?.actOfWar ?? [];
  return Array.isArray(a) ? a : a ? [a] : [];
}

/**
 * Live hover preview for the active targeting bar: resolves the hovered map point, asks the
 * validator (debounced, cached per command) and publishes a short answer for the map tooltip.
 */
function useHoverPreview(spec: TargetingSpec | undefined, tick: number | undefined) {
  const hover = useStore(targeting, (s) => s.hover);
  const cache = useRef(new Map<string, V>());
  const specRef = useRef(spec);
  specRef.current = spec;
  useEffect(() => {
    cache.current.clear();
  }, [tick]);
  useEffect(() => {
    const sp = specRef.current;
    if (!sp || !hover) return;
    const key = pointKey(hover);
    const res = sp.resolve(hover);
    if (!res) {
      targeting.patch({ tip: { key, title: hover.node !== null ? placeName(hover.node) : 'Off the map', lines: ['Not a target for this order.'], ok: false, node: hover.node } });
      return;
    }
    const base = { key, title: res.label, node: res.node === undefined ? hover.node : res.node, ids: res.ids };
    if (!res.cmd) {
      targeting.patch({ tip: { ...base, lines: [res.reason ?? 'Not a target for this order.'], ok: false } });
      return;
    }
    const ck = JSON.stringify(res.cmd);
    const show = (v: V) => {
      if (pointKey(targeting.get().hover) !== key) return;
      const aow = actOfWarList(v);
      if (v.ok) targeting.patch({ tip: { ...base, lines: (sp.brief?.(v.preview) ?? []).concat(v.warnings ?? []).slice(0, 4), ok: true } });
      else if (aow.length) targeting.patch({ tip: { ...base, lines: [`Act of war: ${aow.map(countryName).join(', ')} — you confirm in the order bar`], ok: true, warn: true } });
      else targeting.patch({ tip: { ...base, lines: [v.reason], ok: false } });
    };
    const hit = cache.current.get(ck);
    if (hit) return show(hit);
    targeting.patch({ tip: { ...base, lines: ['Checking…'], ok: null } });
    let alive = true;
    const t = setTimeout(() => {
      void getHost()
        .preview(res.cmd!)
        .then((v) => {
          cache.current.set(ck, v as V);
          if (alive) show(v as V);
        })
        .catch(() => undefined);
    }, 60);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [hover]);
}

/** Generic previewed command dialog. `build(war)` returns the command (or null while incomplete).
 *  With `targeting` it renders as the non-modal map-targeting order bar instead of a modal. */
export function CommandDialog({ title, build, describe, onClose, onDone, children, okLabel, testid, targeting: spec }: { title: string; build: (war: string[] | undefined) => CommandInput | null; describe?: (p: Record<string, unknown>) => React.ReactNode; onClose: () => void; onDone?: (res: unknown) => void; children?: React.ReactNode; okLabel: string; testid?: string; targeting?: TargetingSpec }) {
  const frame = useFrame();
  const [v, setV] = useState<V | null>(null);
  const [war, setWar] = useState(false);
  // The act-of-war requirement of the current target, remembered once the plain preview reports it:
  // after the player ticks the box the re-preview (with confirmation) succeeds and no longer lists it,
  // but the committed command must still carry the confirmation.
  const [warFor, setWarFor] = useState<{ key: string; list: string[]; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const cmd = build(undefined);
  const key = JSON.stringify(cmd);
  const aowNow = actOfWarList(v);
  const sticky = warFor && warFor.key === key ? warFor : null;
  const aowList = aowNow.length ? aowNow : sticky?.list ?? [];
  useEffect(() => {
    if (v && !v.ok && v.code === 'act_of_war' && aowNow.length) setWarFor({ key, list: aowNow, reason: v.reason });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);
  useEffect(() => {
    // a different target never inherits an earlier war confirmation
    setWar(false);
  }, [key]);
  useEffect(() => {
    let alive = true;
    if (!cmd) {
      setV(null);
      return;
    }
    const withWar = war && aowList.length ? build(aowList) : cmd;
    void getHost()
      .preview(withWar!)
      .then((r) => alive && setV(r as V));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, war, frame?.view.tick]);
  useHoverPreview(spec, frame?.view.tick);
  const ro = frame?.meta.readOnly || frame?.meta.reviewMode;
  const needWar = aowList.length > 0;
  const okReason = ro ? 'Read-only campaign' : busy ? 'Submitting…' : !cmd ? (spec ? 'Pick a target on the map (or from the list).' : 'Complete the form.') : !v ? 'Checking…' : needWar && !war ? 'Confirm the declaration of war first.' : !v.ok && v.code !== 'act_of_war' ? v.reason : null;
  const commit = async () => {
    if (okReason) return;
    setBusy(true);
    const c = needWar ? build(aowList) : cmd;
    const r = await exec(c!, `${title}: ordered.`);
    setBusy(false);
    if (r.ok) {
      onDone?.(r.result);
      if (!onDone) onClose();
    }
  };
  const confirmBtn = (
    <ActionButton className="btn primary" disabledReason={okReason} onClick={commit} data-testid={testid ? `${testid}-confirm` : undefined}>
      {okLabel}
    </ActionButton>
  );
  const body = (
    <>
      {v && v.ok && describe && <div className="card" style={{ marginTop: 8 }}>{describe(v.preview)}</div>}
      {v && !v.ok && v.code !== 'act_of_war' && (
        <p className="bad" role="alert" style={{ marginBottom: 0 }}>
          Not possible: {v.reason}
        </p>
      )}
      {needWar && (
        <div className="card" style={{ borderColor: 'var(--bad)', marginTop: 8 }} role="alert">
          <strong className="bad">Act of war</strong>
          <p style={{ margin: '4px 0' }}>{v && !v.ok && v.code === 'act_of_war' ? v.reason : sticky?.reason}</p>
          <label className="row" style={{ gap: 6 }}>
            <input type="checkbox" checked={war} onChange={(e) => setWar(e.target.checked)} data-testid={testid ? `${testid}-war` : undefined} /> I accept going to war with {aowList.map(countryName).join(', ')}
          </label>
        </div>
      )}
      {v && v.ok && v.warnings?.map((w) => <p key={w} className="warn">{w}</p>)}
    </>
  );
  if (spec)
    return (
      <TargetBar title={title} spec={spec} testid={testid} onClose={onClose} commit={commit} canCommit={!okReason} confirm={confirmBtn}>
        {children}
        {body}
      </TargetBar>
    );
  return (
    <Modal
      title={title}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          {confirmBtn}
        </>
      }
    >
      <div data-testid={testid}>
        {children}
        {body}
      </div>
    </Modal>
  );
}

/** "Choose from a list" disclosure: the accessible fallback to clicking the map. */
export function TargetList({ children, label = 'Choose from a list' }: { children: React.ReactNode; label?: string }) {
  const [open, setOpen] = useState(() => targeting.get().listOpen);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // started from the keyboard: the list is the primary way in — focus its first control
    if (targeting.get().listOpen) ref.current?.querySelector<HTMLElement>('select, input')?.focus();
  }, []);
  return (
    <div className="target-list">
      <button type="button" className="btn small ghost" aria-expanded={open} aria-controls="target-list-body" onClick={() => setOpen((o) => !o)} data-testid="target-list-toggle">
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} /> {open ? 'Hide list' : label}
      </button>
      <div id="target-list-body" ref={ref} hidden={!open}>
        {children}
      </div>
    </div>
  );
}

/** Non-modal order bar of a map-targeted order. Owns the targeting mode while mounted. */
function TargetBar({ title, spec, testid, onClose, commit, canCommit, confirm, children }: { title: string; spec: TargetingSpec; testid?: string; onClose: () => void; commit: () => void; canCommit: boolean; confirm: React.ReactNode; children: React.ReactNode }) {
  const mode = useStore(ui, (s) => s.mode);
  const [notice, setNotice] = useState<string | null>(null);
  const specRef = useRef(spec);
  specRef.current = spec;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const commitRef = useRef({ commit, canCommit });
  commitRef.current = { commit, canCommit };
  const id = spec.id;
  // enter targeting mode while mounted; any other map mode (move, drawing) ends this order
  useEffect(() => {
    if (mode.kind === 'idle') ui.patch({ mode: { kind: 'pick', purpose: id, prompt: spec.prompt } });
    else if (mode.kind !== 'pick' || mode.purpose !== id) closeRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, id]);
  useEffect(() => {
    const onPick = (e: Event) => {
      const d = (e as CustomEvent<MapPoint & { purpose: string }>).detail;
      if (d.purpose !== id) return;
      const r = specRef.current.resolve({ node: d.node ?? null, objects: d.objects ?? [], lonlat: d.lonlat ?? [0, 0] });
      if (r?.apply) r.apply();
      setNotice(!r ? 'Not a target for this order.' : r.reason ? `${r.label}: ${r.reason}` : null);
    };
    const onCancel = () => closeRef.current();
    const onConfirm = () => commitRef.current.canCommit && commitRef.current.commit();
    window.addEventListener('wc-pick', onPick);
    window.addEventListener('wc-cancel-mode', onCancel);
    window.addEventListener('wc-confirm-order', onConfirm);
    return () => {
      window.removeEventListener('wc-pick', onPick);
      window.removeEventListener('wc-cancel-mode', onCancel);
      window.removeEventListener('wc-confirm-order', onConfirm);
      const m = ui.get().mode;
      if (m.kind === 'pick' && m.purpose === id) ui.patch({ mode: { kind: 'idle' } });
      clearTargetHover();
    };
  }, [id]);
  return (
    <div
      className="order-bar"
      role="dialog"
      aria-modal="false"
      aria-label={title}
      data-testid="order-bar"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div className="ob-head">
        <Icon name="target" size={18} />
        <strong className="ob-title">{title}</strong>
        <span className="ob-target" data-testid="order-target">
          {spec.chosen ? (
            <>
              Target: <strong>{spec.chosen}</strong>
            </>
          ) : (
            spec.prompt
          )}
        </span>
        <span className="ob-hint muted">Hover to preview · click to set · Esc or right-click cancels</span>
      </div>
      <div className="ob-body" data-testid={testid}>
        {notice && (
          <p className="bad" role="status" style={{ margin: 0 }} data-testid="order-notice">
            {notice}
          </p>
        )}
        {children}
        <TargetList>{spec.list}</TargetList>
      </div>
      <div className="ob-foot">
        <button type="button" className="btn" onClick={onClose} data-testid="order-cancel">
          Cancel
        </button>
        {confirm}
      </div>
    </div>
  );
}

/** Contact label as the attack list shows it (viewer-safe: only what the observation recorded). */
function contactLabel(c: { level: string; domain: string; owner?: string | null }): string {
  return c.level === 'contact' ? `Unknown ${c.domain} contact` : `${c.owner ? countryName(c.owner) : 'Unknown'} ${c.level} contact`;
}

// ───────────────────────── ground / naval orders ─────────────────────────

export function AttackDialog({ s, onClose }: { s: StackView; onClose: () => void }) {
  const frame = useFrame()!;
  const [target, setTarget] = useState<{ contact?: string; node?: number } | null>(null);
  // only targets the viewer can legitimately see: current (non-stale) contacts, or a province
  const visibleContacts = frame.view.contacts.filter((c) => c.level !== 'stale' && c.domain !== 'air');
  const contacts = visibleContacts.map((c) => ({ c, d: distKm(s.lonlat, c.lonlat) })).sort((a, b) => a.d - b.d).slice(0, 40);
  const chosenContact = target?.contact ? visibleContacts.find((c) => c.id === target.contact) : undefined;
  const spec: TargetingSpec = {
    id: 'attack-node',
    prompt: 'Click a contact or a foreign province on the map',
    chosen: chosenContact ? `${contactLabel(chosenContact)}${chosenContact.node !== null ? ` near ${placeName(chosenContact.node)}` : ''}` : target?.node !== undefined ? placeName(target.node) : null,
    resolve: (p) => {
      const cid = p.objects.find((i) => i.startsWith('C:'));
      const c = cid ? visibleContacts.find((x) => `C:${x.id}` === cid) : undefined;
      if (c) return { label: `${contactLabel(c)}${c.node !== null ? ` near ${placeName(c.node)}` : ''}`, cmd: { type: 'attack', stack: s.id, targetContact: c.id }, apply: () => setTarget({ contact: c.id }), ids: [cid!], node: c.node };
      if (p.node === null) return null;
      const n = p.node;
      if (frame.view.owners[n] === frame.view.viewer) return { label: placeName(n), reason: 'Your own territory — pick a contact or a foreign province.' };
      if (NODES[n].outside) return { label: placeName(n), reason: 'Outside the campaign map.' };
      return { label: placeName(n), cmd: { type: 'attack', stack: s.id, targetNode: n }, apply: () => setTarget({ node: n }) };
    },
    brief: (p) => [p.mode === 'ranged' ? 'Ranged fire from current position' : 'Assault: move to the target and engage', p.distanceKm !== null ? `${Math.round(p.distanceKm as number)} km` : '', (p.route as { arriveTick?: number } | null)?.arriveTick !== undefined ? `Arrival ${gameTime((p.route as { arriveTick: number }).arriveTick)}` : ''].filter(Boolean),
    list: (
      <>
        <fieldset>
          <legend>Observed contacts (current observations only)</legend>
          {contacts.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>No current contacts. You can still attack a province.</p>
          ) : (
            <select value={target?.contact ?? ''} onChange={(e) => setTarget(e.target.value ? { contact: e.target.value } : null)} data-testid="attack-contact">
              <option value="">Choose a contact…</option>
              {contacts.map(({ c, d }) => (
                <option key={c.id} value={c.id}>
                  {contactLabel(c)} near {c.node !== null ? placeName(c.node) : 'open area'} · {Math.round(d)} km
                </option>
              ))}
            </select>
          )}
        </fieldset>
        <NodePicker id="attack-node" origin={s.lonlat} value={target?.node ?? null} onChange={(n) => setTarget({ node: n })} label="…or a province / sea sector" filter={(n) => frame.view.owners[n.id] !== frame.view.viewer} maxKm={3000} />
      </>
    ),
  };
  return (
    <CommandDialog
      title={`Attack with ${s.name}`}
      testid="attack"
      okLabel="Confirm attack"
      onClose={onClose}
      targeting={spec}
      build={(war) => (target ? { type: 'attack', stack: s.id, targetContact: target.contact, targetNode: target.node, confirmActOfWar: war } : null)}
      describe={(p) => (
        <dl className="kv">
          <dt>Mode</dt>
          <dd>{p.mode === 'ranged' ? 'Ranged fire from current position' : 'Assault (move to the target and engage)'}</dd>
          <dt>Target sector</dt>
          <dd>{p.targetNode !== null ? placeName(p.targetNode as number) : '—'}</dd>
          <dt>Distance</dt>
          <dd>{p.distanceKm !== null ? `${Math.round(p.distanceKm as number)} km` : '—'}</dd>
          {(p.route as { arriveTick?: number } | null)?.arriveTick !== undefined && (
            <>
              <dt>Arrival</dt>
              <dd>{gameTime((p.route as { arriveTick: number }).arriveTick)}</dd>
            </>
          )}
        </dl>
      )}
    />
  );
}

export function RetreatDialog({ s, onClose }: { s: StackView; onClose: () => void }) {
  const opts = useQuery<{ adjacent: { node: number; kind: string; name: string }[] } | null>('stackOptions', [s.id]);
  const [dest, setDest] = useState<number | null>(null);
  const hp = s.units.reduce((a, u) => a + u.hp, 0);
  const adj = opts.data?.adjacent ?? [];
  const spec: TargetingSpec = {
    id: 'retreat-node',
    prompt: 'Click an adjacent province or sea zone to withdraw to',
    chosen: dest !== null ? placeName(dest) : null,
    resolve: (p) => {
      if (p.node === null) return null;
      const n = p.node;
      if (!adj.some((a) => a.node === n)) return { label: placeName(n), reason: opts.data ? 'Not adjacent — a retreat withdraws to a neighbouring sector.' : 'Loading the adjacent sectors…' };
      return { label: placeName(n), cmd: { type: 'retreat', stack: s.id, dest: n }, apply: () => setDest(n) };
    },
    brief: (p) => [`Forecast HP cost ${((p.hpCost as number) / 100).toFixed(1)} (${pct((p.hpCost as number) / Math.max(1, hp), 0)})`, `Arrival ${gameTime((p.route as { arriveTick: number }).arriveTick)}`],
    list: (
      <label className="field">
        Adjacent destination
        <select value={dest ?? ''} onChange={(e) => setDest(e.target.value === '' ? null : Number(e.target.value))} data-testid="retreat-dest">
          <option value="">Choose…</option>
          {adj.map((a) => (
            <option key={a.node + a.kind} value={a.node}>
              {placeName(a.node)} ({a.kind})
            </option>
          ))}
        </select>
      </label>
    ),
  };
  return (
    <CommandDialog
      title={`Retreat ${s.name}`}
      testid="retreat"
      okLabel="Confirm retreat"
      onClose={onClose}
      targeting={spec}
      build={() => (dest !== null ? { type: 'retreat', stack: s.id, dest } : null)}
      describe={(p) => (
        <dl className="kv">
          <dt>Withdraw to</dt>
          <dd>{placeName(p.dest as number)}</dd>
          <dt>Forecast HP cost</dt>
          <dd data-testid="retreat-cost">
            {((p.hpCost as number) / 100).toFixed(1)} HP ({pct((p.hpCost as number) / Math.max(1, hp), 0)} of current)
          </dd>
          <dt>Arrival</dt>
          <dd>{gameTime((p.route as { arriveTick: number }).arriveTick)}</dd>
          <dt>Fire control after</dt>
          <dd>Return fire</dd>
        </dl>
      )}
    />
  );
}

export function DelayDialog({ s, onClose }: { s: StackView; onClose: () => void }) {
  const [h, setH] = useState(2);
  return (
    <CommandDialog title={`Delay ${s.name}`} testid="delay" okLabel="Confirm delay" onClose={onClose} build={() => ({ type: 'delay', stack: s.id, minutes: Math.round(h * 60) })} describe={(p) => <span>Holds its current order until {gameTime(p.until as number)}.</span>}>
      <label className="field">
        Hold for (game hours)
        <input type="number" min={0.25} max={168} step={0.25} value={h} onChange={(e) => setH(Math.max(0.25, Number(e.target.value) || 0.25))} />
      </label>
    </CommandDialog>
  );
}

export function EmbarkDialog({ s, onClose }: { s: StackView; onClose: () => void }) {
  const opts = useQuery<{ land: boolean; coastal: boolean; adjacent: { node: number; kind: string; name: string }[] } | null>('stackOptions', [s.id]);
  const [n, setN] = useState<number | null>(null);
  const atSea = opts.data ? !opts.data.land : false;
  const list = (opts.data?.adjacent ?? []).filter((a) => a.kind === 'coast');
  const build = (node: number, war?: string[]): CommandInput => (atSea ? { type: 'disembark', stack: s.id, land: node, confirmActOfWar: war } : { type: 'embark', stack: s.id, sea: node });
  const spec: TargetingSpec = {
    id: 'embark-node-map',
    prompt: atSea ? 'Click an adjacent coast to land on' : 'Click an adjacent sea zone to embark into',
    chosen: n !== null ? placeName(n) : null,
    resolve: (p) => {
      if (p.node === null) return null;
      const node = p.node;
      if (!list.some((a) => a.node === node)) return { label: placeName(node), reason: !opts.data ? 'Loading the adjacent sectors…' : atSea ? 'Not an adjacent coast of this sea zone.' : 'Not a sea zone adjacent to this coast.' };
      return { label: placeName(node), cmd: build(node), apply: () => setN(node) };
    },
    brief: (p) => {
      const r = p.route as { arriveTick: number } | undefined;
      return r ? [`Arrival ${gameTime(r.arriveTick)}`] : [];
    },
    list: (
      <label className="field">
        {atSea ? 'Adjacent coast' : 'Adjacent sea zone'}
        <select value={n ?? ''} onChange={(e) => setN(e.target.value === '' ? null : Number(e.target.value))} data-testid="embark-node">
          <option value="">Choose…</option>
          {list.map((a) => (
            <option key={a.node} value={a.node}>
              {placeName(a.node)}
            </option>
          ))}
        </select>
      </label>
    ),
  };
  return (
    <CommandDialog
      title={atSea ? `Disembark ${s.name}` : `Embark ${s.name}`}
      testid="embark"
      okLabel={atSea ? 'Confirm landing' : 'Confirm embarkation'}
      onClose={onClose}
      targeting={spec}
      build={(war) => (n === null ? null : build(n, war))}
      describe={(p) => {
        const r = p.route as { arriveTick: number; modeChanges: { at: number; from: string; to: string }[] };
        return (
          <dl className="kv">
            <dt>Arrival</dt>
            <dd>{gameTime(r.arriveTick)}</dd>
            <dt>Mode change</dt>
            <dd>{r.modeChanges.map((m) => `${cap(m.from)} → ${cap(m.to)} at ${placeName(m.at)}`).join(', ') || '—'}</dd>
          </dl>
        );
      }}
    >
      {opts.data && !atSea && !opts.data.coastal && <p className="bad">Embarking requires a coastal province.</p>}
    </CommandDialog>
  );
}

export function DeployableDialog({ s, unitId, onClose }: { s: StackView; unitId: string; onClose: () => void }) {
  const frame = useFrame()!;
  const u = s.units.find((x) => x.id === unitId);
  const ut = u ? unitById.get(u.type) : undefined;
  const [n, setN] = useState<number | null>(null);
  if (!u || !ut) return null;
  const st = ut.levels[Math.max(0, Math.min(ut.levels.length - 1, u.level - 1))];
  const range = Math.max(st.rangeKm, 50);
  const cd = u.cooldownUntil && u.cooldownUntil > frame.view.tick ? u.cooldownUntil : null;
  const spec: TargetingSpec = {
    id: 'deploy-node',
    prompt: `Click a sector within ${range} km`,
    chosen: n !== null ? placeName(n) : null,
    resolve: (p) => (p.node === null ? null : NODES[p.node].outside ? { label: placeName(p.node), reason: 'Outside the campaign map.' } : { label: placeName(p.node), cmd: { type: 'useDeployable', stack: s.id, unit: unitId, target: p.node }, apply: () => setN(p.node) }),
    brief: (p) => [`Effect: ${String(p.effect)}`, `${Math.round(p.distanceKm as number)} km of ${range} km`],
    list: <NodePicker id="deploy-node" origin={s.lonlat} value={n} onChange={setN} maxKm={range} />,
  };
  return (
    <CommandDialog title={`Use ${ut.name}`} testid="deploy" okLabel="Use deployable" onClose={onClose} targeting={spec} build={() => (n === null ? null : { type: 'useDeployable', stack: s.id, unit: unitId, target: n })} describe={(p) => <span>Effect: {String(p.effect)} at {Math.round(p.distanceKm as number)} km. One use is consumed; cooldown {duration(ut.deployable?.cooldownMin ?? 60)}.</span>}>
      <dl className="kv">
        <dt>Uses remaining</dt>
        <dd>{u.uses ?? 0} of {ut.deployable?.uses ?? '—'}</dd>
        <dt>Cooldown</dt>
        <dd>{cd ? `until ${gameTime(cd)}` : 'Ready'}</dd>
        <dt>Placement range</dt>
        <dd>{range} km</dd>
      </dl>
    </CommandDialog>
  );
}

// ───────────────────────── aircraft ─────────────────────────

interface AirInfo { enduranceMin: number; rangeKm: number; refuelMin: number; defaultRadiusKm: number; bases: { base: { node: number } | { stack: string }; name: string; ok: boolean; reason: string | null; km: number }[] }

export function PatrolDialog({ s, onClose }: { s: StackView; onClose: () => void }) {
  const info = useQuery<AirInfo | null>('airInfo', [s.id]);
  const [n, setN] = useState<number | null>(null);
  const [r, setR] = useState(150);
  const speed = Math.min(...s.units.map((u) => unitById.get(u.type)?.levels[Math.max(0, u.level - 1)]?.speedKmh ?? 600));
  const station = useCallback(
    (d: number) => {
      const transit = Math.ceil((d / Math.max(1, speed)) * 60);
      return { transit, onStation: Math.max(0, (info.data?.enduranceMin ?? 240) - 2 * transit) };
    },
    [speed, info.data],
  );
  const spec: TargetingSpec = {
    id: 'patrol-node',
    prompt: 'Click the patrol area centre on the map',
    chosen: n !== null ? `${placeName(n)} · ${r} km radius` : null,
    resolve: (p) => (p.node === null ? null : NODES[p.node].outside ? { label: placeName(p.node), reason: 'Outside the campaign map.' } : { label: placeName(p.node), cmd: { type: 'patrol', stack: s.id, center: p.node, radiusKm: r }, apply: () => setN(p.node) }),
    brief: (p) => {
      const d = p.distanceKm as number;
      const { transit, onStation } = station(d);
      return [`${Math.round(d)} km from home · transit ≈ ${duration(transit)} each way`, `Time on station ≈ ${duration(onStation)} of ${duration(info.data?.enduranceMin ?? 0)}`];
    },
    list: <NodePicker id="patrol-node" origin={s.lonlat} value={n} onChange={setN} maxKm={info.data ? info.data.rangeKm / 2 : 1500} label="Patrol area centre" />,
  };
  return (
    <CommandDialog
      title={`Patrol with ${s.name}`}
      testid="patrol"
      okLabel="Launch patrol"
      onClose={onClose}
      targeting={spec}
      build={() => (n === null ? null : { type: 'patrol', stack: s.id, center: n, radiusKm: r })}
      describe={(p) => {
        const d = p.distanceKm as number;
        const { transit, onStation } = station(d);
        return (
          <dl className="kv" data-testid="patrol-preview">
            <dt>Patrol area</dt>
            <dd>{placeName(n!)} · radius {p.radiusKm as number} km</dd>
            <dt>Distance from home</dt>
            <dd>{Math.round(d)} km (transit ≈ {duration(transit)} each way)</dd>
            <dt>Time on station</dt>
            <dd>≈ {duration(onStation)} of {duration(info.data?.enduranceMin ?? 0)} endurance</dd>
            <dt>Then</dt>
            <dd>Returns to home base, refuels {duration(info.data?.refuelMin ?? 60)}</dd>
            <dt>Home base stays</dt>
            <dd>{s.air && 'node' in s.air.home ? placeName(s.air.home.node) : 'carrier'} (patrol does not change home)</dd>
          </dl>
        );
      }}
    >
      <div className="row wrap" style={{ gap: 10 }}>
        <label className="field" style={{ margin: 0 }}>
          Patrol radius (km, 10–400)
          <input type="number" min={10} max={400} value={r} onChange={(e) => setR(Math.max(10, Math.min(400, Number(e.target.value) || 10)))} data-testid="patrol-radius" style={{ width: 90 }} />
        </label>
        {info.data && (
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            Operational range {info.data.rangeKm} km → patrol areas up to {Math.round(info.data.rangeKm / 2)} km from home (round trip). Endurance {duration(info.data.enduranceMin)}.
          </p>
        )}
      </div>
    </CommandDialog>
  );
}

export function RebaseDialog({ s, onClose }: { s: StackView; onClose: () => void }) {
  const info = useQuery<AirInfo | null>('airInfo', [s.id]);
  const [i, setI] = useState<number | null>(null);
  const base = i !== null ? info.data?.bases[i]?.base ?? null : null;
  const bases = info.data?.bases ?? [];
  const spec: TargetingSpec = {
    id: 'rebase-node',
    prompt: 'Click an air base or carrier on the map',
    chosen: i !== null ? bases[i]?.name ?? null : null,
    resolve: (p) => {
      // a carrier (own naval formation) under the pointer, else an air base in the sector
      let k = bases.findIndex((b) => 'stack' in b.base && p.objects.includes(`S:${b.base.stack}`));
      if (k < 0 && p.node !== null) k = bases.findIndex((b) => 'node' in b.base && b.base.node === p.node);
      if (k < 0) return p.node === null ? null : { label: placeName(p.node), reason: info.data ? 'No air base or carrier of yours here.' : 'Loading bases…' };
      const b = bases[k];
      const hl = 'stack' in b.base ? { ids: [`S:${b.base.stack}`], node: null } : { node: b.base.node };
      if (!b.ok) return { label: b.name, reason: b.reason ?? 'Not usable.', ...hl };
      return { label: b.name, cmd: { type: 'rebase', stack: s.id, base: b.base }, apply: () => setI(k), ...hl };
    },
    brief: (p) => [`${Math.round(p.distanceKm as number)} km · lands ${gameTime(p.arriveEstimate as number)}`, 'Becomes the new home base'],
    list: (
      <label className="field">
        Base
        <select value={i ?? ''} onChange={(e) => setI(e.target.value === '' ? null : Number(e.target.value))} data-testid="rebase-base">
          <option value="">Choose a base…</option>
          {bases.map((b, k) => (
            <option key={k} value={k} disabled={!b.ok}>
              {b.name}
              {b.km ? ` · ${b.km} km` : ''}
              {b.ok ? '' : ` — ${b.reason}`}
            </option>
          ))}
        </select>
      </label>
    ),
  };
  return (
    <CommandDialog
      title={`Rebase ${s.name}`}
      testid="rebase"
      okLabel="Confirm rebase"
      onClose={onClose}
      targeting={spec}
      build={() => (base ? { type: 'rebase', stack: s.id, base } : null)}
      describe={(p) => (
        <dl className="kv">
          <dt>New home base</dt>
          <dd>{info.data?.bases[i!]?.name}</dd>
          <dt>Distance</dt>
          <dd>{Math.round(p.distanceKm as number)} km</dd>
          <dt>Landing</dt>
          <dd>{gameTime(p.arriveEstimate as number)}</dd>
        </dl>
      )}
    >
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>Rebasing (ferry) moves the aircraft's home permanently after landing; a patrol returns to the current home.</p>
    </CommandDialog>
  );
}

export function AircraftPanel({ s }: { s: StackView }) {
  const frame = useFrame()!;
  const info = useQuery<AirInfo | null>('airInfo', [s.id]);
  const a = s.air!;
  const now = frame.view.tick;
  const elapsed = a.airborneSince !== null ? now - a.airborneSince : 0;
  const events = frame.view.journal.filter((e) => (e.kind === 'aircraft_diverted' || e.kind === 'aircraft_lost' || e.kind === 'aircraft_landed') && (e.data as { stack?: string } | undefined)?.stack === s.id || (e.kind.startsWith('aircraft') && e.text.includes(s.name))).slice(0, 5);
  const label: Record<string, string> = { landed: 'Landed (ready)', outbound: 'Outbound to patrol area', on_station: 'On station (patrolling)', returning: 'Returning to base', refueling: 'Refuelling', rebasing: 'Rebasing (ferry to new home)' };
  return (
    <div className="sect" data-testid="aircraft-panel">
      <h4>Aircraft</h4>
      <dl className="kv">
        <dt>Mission</dt>
        <dd data-testid="air-state">{label[a.state] ?? a.state}{a.grounded ? ' · GROUNDED (base disabled)' : ''}</dd>
        <dt>Home base</dt>
        <dd>{'node' in a.home ? placeName(a.home.node) : `Carrier ${frame.view.stacks.find((x) => 'stack' in a.home && x.id === a.home.stack)?.name ?? ''}`}</dd>
        {a.dest && (
          <>
            <dt>Destination</dt>
            <dd>{'node' in a.dest ? placeName(a.dest.node) : 'Carrier'}</dd>
          </>
        )}
        <dt>Airborne</dt>
        <dd>{a.airborneSince !== null ? `${duration(elapsed)} of ${duration(info.data?.enduranceMin ?? 0)} endurance` : 'No'}</dd>
        {a.patrol && (
          <>
            <dt>Patrol footprint</dt>
            <dd>
              {a.patrol.node !== null ? placeName(a.patrol.node) : 'area'} · {a.patrol.radiusKm} km · until {gameTime(a.patrol.until)}
            </dd>
          </>
        )}
        <dt>Refuel interval</dt>
        <dd>{a.refuelUntil ? `refuelling until ${gameTime(a.refuelUntil)}` : `${duration(info.data?.refuelMin ?? 60)} after each sortie`}</dd>
        <dt>Range</dt>
        <dd>{info.data ? `${info.data.rangeKm} km operational` : '—'}</dd>
      </dl>
      {events.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>
          {events.map((e) => (
            <li key={e.id}>
              {gameTime(e.at)} — {e.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ───────────────────────── missiles ─────────────────────────

interface MissileInfo { types: { id: string; inv: { maturity: string; ready: number; expended: number; produced: number; launched: number } | null; backlog: { id: string; batch: number; startedAt: number | null; endsAt: number | null }[]; platforms: { from: { stack: string }; name: string }[]; sites: { from: { node: number }; name: string; slots: number }[]; techs: { blueprint: string; blueprintDone: boolean; qualify: string | null; qualifyDone: boolean } }[] }

const OUTCOME_TEXT: Record<string, { label: string; tip: string }> = {
  arrived_effect: { label: 'Arrived with effect', tip: 'The item reached the sector and produced its full abstract effect (building/condition damage, unit damage, morale change).' },
  arrived_limited: { label: 'Arrived, limited effect', tip: 'Reached the sector but only half of the abstract effect applied.' },
  intercepted: { label: 'Intercepted', tip: 'Stopped by the target sector’s air and missile defences (a separate seeded draw; depends on the defender’s rating there).' },
  failed: { label: 'Failed', tip: 'Malfunction or loss before arrival (boost, guidance, or flight failure). Counted inside the headline chance.' },
};

export function MaturityBadge({ m }: { m: string }) {
  const styles: Record<string, React.CSSProperties> = {
    prototype: { borderStyle: 'dashed', backgroundImage: 'repeating-linear-gradient(135deg, rgba(230,180,80,.25) 0 3px, transparent 3px 7px)', color: 'var(--warn)' },
    qualified: { borderColor: 'var(--accent)', color: 'var(--accent)' },
    in_production: { borderColor: 'var(--accent)', backgroundImage: 'repeating-linear-gradient(90deg, rgba(106,167,232,.25) 0 4px, transparent 4px 8px)' },
    ready: { background: 'var(--ok)', color: '#08140c', borderColor: 'var(--ok)' },
    expended: { textDecoration: 'line-through', opacity: 0.7 },
  };
  return (
    <span className="tag" style={styles[m] ?? {}} data-maturity={m}>
      <MissileToken m={m} /> {m.replace('_', ' ')}
    </span>
  );
}

/** Abstract token art: a prototype is a dashed outline; a ready item is a solid token. */
export function MissileToken({ m, size = 14 }: { m: string; size?: number }) {
  const solid = m === 'ready' || m === 'in_production';
  return (
    <svg width={size * 2} height={size} viewBox="0 0 28 14" aria-hidden="true">
      <path d="M2 7 L18 3 L26 7 L18 11 Z M2 7 L6 2 M2 7 L6 12" fill={solid ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.4" strokeDasharray={m === 'prototype' ? '2 2' : m === 'expended' ? '1 3' : undefined} />
    </svg>
  );
}

export function useMissileInfo() {
  return useQuery<MissileInfo>('missileInfo');
}

/** `target` pre-selects a sector (e.g. from a contact or report sheet); the engine still validates
 *  range, inventory, war status and eligibility on every preview and on commit. */
export function LaunchDialog({ missile: initial, target: initialTarget, onClose }: { missile?: string; target?: number | null; onClose: () => void }) {
  const frame = useFrame()!;
  const q = useMissileInfo();
  const [missile, setMissile] = useState<string>(initial ?? '');
  const [fromIdx, setFromIdx] = useState<number | null>(null);
  const [target, setTarget] = useState<number | null>(initialTarget ?? null);
  const [launched, setLaunched] = useState<{ ready: number; arriveAt: number } | null>(null);
  const t = q.data?.types.find((x) => x.id === missile);
  const mt = missileById.get(missile);
  const froms = t ? [...t.sites.map((x) => ({ from: x.from as { node: number } | { stack: string }, name: `${x.name} (missile complex)`, ll: NODES[x.from.node].center })), ...t.platforms.map((p) => ({ from: p.from as { node: number } | { stack: string }, name: `${p.name} (launch platform)`, ll: frame.view.stacks.find((s) => s.id === p.from.stack)?.lonlat ?? [0, 0] }))] : [];
  const from = fromIdx !== null ? froms[fromIdx] : null;
  const ready = (q.data?.types ?? []).filter((x) => (x.inv?.ready ?? 0) > 0);
  const spec: TargetingSpec = {
    id: 'launch-node',
    prompt: !missile || !from ? 'Choose the missile and launch facility, then click the target sector' : `Click a target sector within ${mt?.rangeKm ?? '—'} km`,
    chosen: target !== null ? placeName(target) : null,
    resolve: (p) => {
      if (p.node === null) return null;
      const n = p.node;
      if (frame.view.owners[n] === frame.view.viewer) return { label: placeName(n), reason: 'Your own territory.' };
      if (NODES[n].outside) return { label: placeName(n), reason: 'Outside the campaign map.' };
      if (!missile || !from) return { label: placeName(n), reason: 'Choose the missile and launch facility first.', apply: () => setTarget(n), cmd: null };
      return { label: placeName(n), cmd: { type: 'launchMissile', missile, from: from.from, target: n }, apply: () => setTarget(n) };
    },
    brief: (p) => [`${Math.round(p.km as number)} km of ${mt?.rangeKm} km range`, `Arrives ${gameTime(p.arriveAt as number)}`, `Headline useful-effect chance ${pct(p.headlineChance as number)} before defences`],
    list: from && mt ? <NodePicker id="launch-node" origin={from.ll as [number, number]} value={target} onChange={setTarget} maxKm={mt.rangeKm} label={`Target sector (within ${mt.rangeKm} km)`} filter={(n) => frame.view.owners[n.id] !== frame.view.viewer} /> : <p className="muted" style={{ margin: 0 }}>Choose the missile and launch facility first.</p>,
  };
  if (launched)
    return (
      <Modal title="Launch committed" onClose={onClose} footer={<button type="button" className="btn primary" onClick={onClose}>Close</button>}>
        <p data-testid="launch-done">
          {mt?.name} launched at {placeName(target)}. Expected arrival {gameTime(launched.arriveAt)}. <strong>Ready inventory now: {launched.ready}</strong>.
        </p>
        <p className="muted">The map shows an abstract origin → sector line; it has no steering controls. The outcome report shows only what your observation allows (possibly “effect unconfirmed”).</p>
      </Modal>
    );
  return (
    <CommandDialog
      title="Launch missile"
      testid="launch"
      targeting={spec}
      okLabel="Commit launch"
      onClose={onClose}
      onDone={(res) => {
        const r = res as { ready: number; arriveAt: number };
        setLaunched(r);
      }}
      build={(war) => (missile && from && target !== null ? { type: 'launchMissile', missile, from: from.from, target, confirmActOfWar: war } : null)}
      describe={(p) => (
        <div className="col" style={{ gap: 6 }} data-testid="launch-preview">
          <dl className="kv">
            <dt>Distance</dt>
            <dd>{Math.round(p.km as number)} km of {mt?.rangeKm} km range</dd>
            <dt>Arrival</dt>
            <dd>{gameTime(p.arriveAt as number)} (flight {duration((p.arriveAt as number) - frame.view.tick)})</dd>
            <dt>Target owner</dt>
            <dd>{p.targetOwner ? countryName(p.targetOwner as string) : 'Unowned / sea'}</dd>
            <dt title="Probability that the item arrives with some useful effect, already including earlier failure states (boost, guidance, flight). Target defences are drawn separately and can still intercept.">Headline useful-effect chance ⓘ</dt>
            <dd data-testid="launch-headline">{pct(p.headlineChance as number)} before target defences</dd>
          </dl>
          <div>
            <strong>Possible results (exactly one will occur):</strong>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }} data-testid="launch-outcomes">
              {((p.possibleOutcomes as string[]) ?? []).map((o) => (
                <li key={o} title={OUTCOME_TEXT[o]?.tip}>
                  {OUTCOME_TEXT[o]?.label ?? o} — {mt ? pct(mt.outcomes[o as keyof typeof mt.outcomes] ?? 0) : ''}
                  {o === 'intercepted' ? ' + defence draw' : ''} <span className="muted" style={{ fontSize: 12 }}>({OUTCOME_TEXT[o]?.tip})</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 12 }} title="Accuracy is conditional on arrival: the effect grade applies only to items that arrive, in this game context. Speed class confers no accuracy bonus.">
            Accuracy is conditional on arrival in this context; a faster speed class does not improve accuracy, damage or report certainty. One launch debits one ready item.
          </p>
        </div>
      )}
    >
      <label className="field">
        Missile (ready inventory)
        <select value={missile} onChange={(e) => { setMissile(e.target.value); setFromIdx(null); }} data-testid="launch-missile">
          <option value="">{ready.length ? 'Choose…' : 'No ready missiles — produce a batch first'}</option>
          {(q.data?.types ?? []).filter((x) => x.inv).map((x) => (
            <option key={x.id} value={x.id} disabled={(x.inv?.ready ?? 0) < 1}>
              {missileById.get(x.id)?.name} — ready {x.inv?.ready ?? 0} ({x.inv?.maturity})
            </option>
          ))}
        </select>
      </label>
      {missile && (
        <label className="field">
          Launch facility / platform
          <select value={fromIdx ?? ''} onChange={(e) => setFromIdx(e.target.value === '' ? null : Number(e.target.value))} data-testid="launch-from">
            <option value="">{froms.length ? 'Choose…' : 'No eligible launch complex or platform'}</option>
            {froms.map((f, i) => (
              <option key={i} value={i}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {mt && <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>{mt.flightFamily} · {mt.speedClass} · {mt.description}</p>}
    </CommandDialog>
  );
}

export function MissileProgramTable() {
  const frame = useFrame()!;
  const q = useMissileInfo();
  const [produce, setProduce] = useState<string | null>(null);
  const ro = frame.meta.readOnly || frame.meta.reviewMode;
  const v = frame.view;
  return (
    <div className="col" data-testid="missile-programs">
      <table className="data">
        <thead>
          <tr>
            <th>Program</th>
            <th>Research</th>
            <th>Maturity</th>
            <th className="num">Ready</th>
            <th>Backlog</th>
            <th className="num">Launched / expended</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {(q.data?.types ?? []).map((t) => {
            const mt = missileById.get(t.id)!;
            const m = t.inv?.maturity ?? 'not researched';
            return (
              <tr key={t.id} data-testid={`missile-${t.id}`}>
                <td>
                  {mt.name}
                  <div className="muted" style={{ fontSize: 11.5 }}>
                    {mt.family} · {mt.flightFamily} · {mt.speedClass} · batch {mt.batchSize} · ceiling {mt.inventoryCeiling} · {mt.rangeKm} km
                  </div>
                  <div className="muted" style={{ fontSize: 11.5 }}>Batch cost {resM(Object.fromEntries(Object.entries(mt.cost).map(([k, x]) => [k, (x ?? 0) * 1000])))} · replacement time {mt.buildHours} h per batch</div>
                </td>
                <td style={{ fontSize: 12 }}>
                  Blueprint {t.techs.blueprintDone ? '✓' : '✗'}
                  {t.techs.qualify ? ` · Qualification ${t.techs.qualifyDone ? '✓' : '✗'}` : ''}
                </td>
                <td>{t.inv ? <MaturityBadge m={m} /> : <span className="muted">not researched</span>}</td>
                <td className="num">{t.inv?.ready ?? 0}</td>
                <td style={{ fontSize: 12 }}>{t.backlog.length ? t.backlog.map((b) => `${b.batch} ${b.endsAt ? `ready ${gameTime(b.endsAt)}` : 'queued'}`).join('; ') : '—'}</td>
                <td className="num">
                  {t.inv?.launched ?? 0} / {t.inv?.expended ?? 0}
                </td>
                <td>
                  <div className="row wrap">
                    <ActionButton className="btn small" disabledReason={ro ? 'Read-only campaign' : !t.inv ? `Research ${t.techs.blueprint} first.` : t.inv.maturity === 'prototype' ? 'Prototype — complete qualification research first.' : null} onClick={() => setProduce(t.id)} data-testid={`produce-${t.id}`}>
                      Produce…
                    </ActionButton>
                    <ActionButton className="btn small primary" disabledReason={ro ? 'Read-only campaign' : (t.inv?.ready ?? 0) < 1 ? 'No ready inventory.' : null} onClick={(e) => startOrder({ kind: 'launch', missile: t.id }, e)} data-testid={`launch-${t.id}`}>
                      Launch…
                    </ActionButton>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <h4>Strike reports</h4>
      {v.launches.length === 0 ? (
        <div className="empty">No launches observed.</div>
      ) : (
        <table className="data" data-testid="strike-reports">
          <thead>
            <tr>
              <th>Launch</th>
              <th>Target</th>
              <th>Launched</th>
              <th>Arrival</th>
              <th>What you know</th>
            </tr>
          </thead>
          <tbody>
            {v.launches.map((l) => (
              <tr key={l.id}>
                <td>{l.mine ? missileById.get(l.missile)?.name ?? l.missile : 'Incoming (type per observation)'}</td>
                <td>{placeName(l.target)}</td>
                <td>{gameTime(l.launchedAt)}</td>
                <td>{gameTime(l.arriveAt)}</td>
                <td data-testid={`knowledge-${l.id}`}>{l.knowledge === 'effect_unconfirmed' ? 'Effect unconfirmed (no observation of the sector)' : l.knowledge === 'in_flight' ? 'In flight' : l.knowledge === 'incoming' ? 'Incoming' : OUTCOME_TEXT[l.knowledge]?.label ?? l.knowledge}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {produce && (
        <ProduceDialog missile={produce} onClose={() => setProduce(null)} />
      )}
    </div>
  );
}

function ProduceDialog({ missile, onClose }: { missile: string; onClose: () => void }) {
  const [b, setB] = useState(1);
  const mt = missileById.get(missile)!;
  return (
    <CommandDialog
      title={`Produce ${mt.name}`}
      testid="produce"
      okLabel="Queue production"
      onClose={onClose}
      build={() => ({ type: 'produceMissile', missile, batches: b })}
      describe={(p) => (
        <dl className="kv">
          <dt>Cost (charged now)</dt>
          <dd>{resM(p.cost as Record<string, number>)}</dd>
          <dt>Items</dt>
          <dd>{(p.batches as number) * mt.batchSize}</dd>
          <dt>Time per batch</dt>
          <dd>{duration(p.durationMin as number)}</dd>
          <dt>Starts</dt>
          <dd>{gameTime(p.startTick as number)}</dd>
          <dt>Backlog / ceiling</dt>
          <dd>
            {p.backlog as number} queued · ceiling {p.ceiling as number}
          </dd>
        </dl>
      )}
    >
      <label className="field">
        Batches (1–10)
        <input type="number" min={1} max={10} value={b} onChange={(e) => setB(Math.max(1, Math.min(10, Math.floor(Number(e.target.value) || 1))))} />
      </label>
      <p className="muted" style={{ margin: 0 }}>Only a completed production job creates inventory. Research creates a blueprint, never stock.</p>
    </CommandDialog>
  );
}
