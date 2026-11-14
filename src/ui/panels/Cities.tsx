import React, { useEffect, useMemo, useState } from 'react';
import { useFrame, useQuery, ActionButton, Modal, newNonce, PlannedUnitSym } from '../components/common';
import { getHost } from '../sim/host';
import { ui, select, centerOn, openPanel, toast } from '../state/ui';
import { NODES, CATALOG, buildingById, unitById, RESOURCE_LABEL, placeName, TERRAIN_LABEL, MAP } from '../data/static';
import { milli, num, signed, resM, gameTime, duration, cap } from '../format';
import { effectsText, effectName } from '../effects';
import { exec } from '../sim/exec';
import { RESOURCES } from '../../engine/data-types';
import type { CityState } from '../../engine/index';

interface CityRow {
  key: string;
  name: string;
  node: number;
  status: string;
  tier: number;
  vp: number;
  population: number;
  morale: number;
  targetMorale: number;
  netValue: number;
  output: Record<string, number>;
  buildings: number;
  jobs: number;
  canMobilize: boolean;
  revoltRisk: boolean;
}
interface BulkRow { target: string | number; name: string; ok: boolean; code?: string; reason?: string; level?: number; cost?: Record<string, number>; startTick?: number; durationMin?: number; queuePosition?: number; warning?: string }
interface BulkPreview { rows: BulkRow[]; eligible: number; total: Record<string, number>; token: string }

/** Ships, submarines and naval officers need a harbour; a non-coastal site never offers them. */
export function isNavalUnit(id: string): boolean {
  const d = unitById.get(id)?.domain;
  return d === 'sea' || d === 'subsurface';
}
/** True when the city or province sits on the coast (naval units and coastal-only buildings are possible). */
export function siteIsCoastal(target: string | number): boolean {
  const node = typeof target === 'number' ? target : MAP.cityByKey.get(target)?.node;
  return node !== undefined && !!NODES[node]?.coastal;
}

type SortKey = 'name' | 'status' | 'tier' | 'vp' | 'population' | 'morale' | 'netValue' | 'jobs';

export function CitiesPanel({ arg }: { arg: { city?: string; tab?: string; node?: number } | null }) {
  if (arg?.city) return <CitySheet cityKey={arg.city} tab={arg.tab} />;
  if (arg?.node !== undefined && arg?.node !== null) return <RuralSheet node={arg.node} />;
  return <CityList />;
}

const listState = { sort: 'netValue' as SortKey, dir: -1, q: '', checked: new Set<string>() };

function CityList() {
  const q = useQuery<CityRow[]>('cityList');
  const frame = useFrame()!;
  const [sort, setSort] = useState<SortKey>(listState.sort);
  const [dir, setDir] = useState(listState.dir);
  const [filter, setFilter] = useState(listState.q);
  const [checked, setChecked] = useState<Set<string>>(listState.checked);
  const [project, setProject] = useState<string>('');
  const [preview, setPreview] = useState<{ cmd: Record<string, unknown>; p: BulkPreview | null; error: string | null; stale?: boolean } | null>(null);
  useEffect(() => {
    Object.assign(listState, { sort, dir, q: filter, checked });
  }, [sort, dir, filter, checked]);
  const rows = useMemo(() => {
    const r = (q.data ?? []).filter((c) => !filter || c.name.toLowerCase().includes(filter.toLowerCase()));
    return r.sort((a, b) => {
      const va = a[sort], vb = b[sort];
      return (typeof va === 'string' ? (va as string).localeCompare(vb as string) : (va as number) - (vb as number)) * dir;
    });
  }, [q.data, sort, dir, filter]);
  const th = (k: SortKey, label: string, numeric = true) => (
    <th className={numeric ? 'num' : ''} aria-sort={sort === k ? (dir > 0 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="sort" onClick={() => (sort === k ? setDir(-dir) : (setSort(k), setDir(k === 'name' ? 1 : -1)))} data-testid={`sort-${k}`}>
        {label}
        {sort === k ? (dir > 0 ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  );
  const allChecked = rows.length > 0 && rows.every((r) => checked.has(r.key));
  // A nation without a single coastal city (landlocked) is never offered naval projects.
  const anyCoastal = frame.view.cities.some((c) => !!NODES[c.node]?.coastal);
  const ro = frame.meta.readOnly || frame.meta.reviewMode;
  const doPreview = async () => {
    if (!project) return;
    const [kind, id] = project.split(':');
    const cmd = kind === 'b' ? { type: 'build', building: id, targets: [...checked] } : { type: 'mobilize', unit: id, cities: [...checked] };
    const v = await getHost().preview<BulkPreview>(cmd as never);
    setPreview({ cmd, p: v.ok ? v.preview : ((v as { details?: BulkPreview }).details ?? null), error: v.ok ? null : v.reason });
  };
  const confirm = async () => {
    if (!preview?.p) return;
    const res = await getHost().command<BulkPreview>({ ...(preview.cmd as object), previewToken: preview.p.token, nonce: newNonce() } as never);
    if (res.ok) {
      toast({ text: `Ordered at ${preview.p.eligible} location(s); charged ${resM(preview.p.total)}.`, node: null, kind: 'bulk', level: 'success' });
      setPreview(null);
      setChecked(new Set());
      q.refresh();
    } else if (res.code === 'stale_preview') {
      // recompute: the situation changed while the preview was open — never spend on a different subset silently
      setPreview({ ...preview, p: (res as { details?: BulkPreview }).details ?? null, error: res.reason, stale: true });
    } else setPreview({ ...preview, error: res.reason });
  };
  return (
    <div className="col" data-testid="cities-list">
      <div className="row wrap">
        <label className="sr-only" htmlFor="city-filter">Filter cities</label>
        <input id="city-filter" type="search" placeholder="Filter cities…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <span className="muted">{rows.length} cities · {checked.size} selected</span>
        <div className="grow" />
        <label className="sr-only" htmlFor="bulk-project">Project for selected cities</label>
        <select id="bulk-project" value={project} onChange={(e) => setProject(e.target.value)} data-testid="bulk-project">
          <option value="">Choose a project…</option>
          <optgroup label="Construct">
            {CATALOG.buildings.filter((b) => b.scope === 'city' && (anyCoastal || !b.coastalOnly)).map((b) => (
              <option key={b.id} value={`b:${b.id}`}>
                {b.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Mobilize">
            {CATALOG.units.filter((u) => anyCoastal || !isNavalUnit(u.id)).map((u) => (
              <option key={u.id} value={`u:${u.id}`}>
                {u.name}
              </option>
            ))}
          </optgroup>
        </select>
        <ActionButton className="btn primary" disabledReason={ro ? 'Read-only campaign' : checked.size === 0 ? 'Tick one or more cities first.' : !project ? 'Choose a project.' : null} onClick={doPreview} data-testid="bulk-preview">
          Preview order
        </ActionButton>
      </div>
      {q.error && <p className="bad">{q.error}</p>}
      {!q.data ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="empty">{filter ? 'No city matches.' : 'You hold no cities. A country with no territory and no recovery force is defeated.'}</div>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>
                <input type="checkbox" aria-label="Select all cities" checked={allChecked} onChange={() => setChecked(allChecked ? new Set() : new Set(rows.map((r) => r.key)))} />
              </th>
              {th('name', 'City', false)}
              {th('status', 'Status', false)}
              {th('tier', 'Tier')}
              {th('vp', 'VP')}
              {th('population', 'Pop (k)')}
              {th('morale', 'Morale')}
              {th('netValue', 'Net production (value/day)')}
              {th('jobs', 'Queue')}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={checked.has(r.key) ? 'sel' : ''}>
                <td>
                  <input type="checkbox" aria-label={`Select ${r.name}`} checked={checked.has(r.key)} onChange={() => setChecked((s) => { const n = new Set(s); n.has(r.key) ? n.delete(r.key) : n.add(r.key); return n; })} data-testid={`city-check-${r.key}`} />
                </td>
                <td>
                  <button type="button" className="btn ghost small" style={{ padding: 0, minHeight: 0 }} onClick={() => { select({ kind: 'city', key: r.key, node: r.node }); openPanel('cities', { city: r.key }); }} data-testid={`city-open-${r.key}`}>
                    {r.name}
                  </button>
                </td>
                <td>
                  <span className={`tag${r.status === 'occupied' ? ' warn' : ''}`}>{r.status}</span>
                  {r.revoltRisk && <span className="tag bad">unrest</span>}
                </td>
                <td className="num">{r.tier}</td>
                <td className="num">{r.vp}</td>
                <td className="num">{num(r.population)}</td>
                <td className="num">
                  {Math.round(r.morale)}
                  <span className="muted"> → {Math.round(r.targetMorale)}</span>
                </td>
                <td className="num">{num(r.netValue)}</td>
                <td className="num">{r.jobs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {preview && <BulkPreviewDialog preview={preview} onClose={() => setPreview(null)} onConfirm={confirm} onRefresh={doPreview} />}
    </div>
  );
}

export function BulkPreviewDialog({ preview, onClose, onConfirm, onRefresh }: { preview: { cmd: Record<string, unknown>; p: BulkPreview | null; error: string | null; stale?: boolean }; onClose: () => void; onConfirm: () => void; onRefresh: () => void }) {
  const p = preview.p;
  const what = preview.cmd.type === 'build' ? buildingById.get(preview.cmd.building as string)?.name : unitById.get(preview.cmd.unit as string)?.name;
  return (
    <Modal
      title={`Preview: ${preview.cmd.type === 'build' ? 'construct' : 'mobilize'} ${what}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn" onClick={onRefresh}>
            Recompute
          </button>
          <ActionButton className="btn primary" disabledReason={!p || p.eligible === 0 ? 'No eligible location in this preview.' : null} onClick={onConfirm} data-testid="bulk-confirm">
            Confirm — charge exactly {p ? resM(p.total) : '—'}
          </ActionButton>
        </>
      }
    >
      {preview.stale && <p className="warn" role="alert">The situation changed while the preview was open (treasury, ownership or queues). The preview below was recomputed; review it before confirming.</p>}
      {preview.error && !preview.stale && <p className="bad" role="alert">{preview.error}</p>}
      {p && (
        <>
          <p>
            <strong>{p.eligible}</strong> of {p.rows.length} selected location(s) can proceed. Only those rows will be ordered and charged.
          </p>
          <table className="data" data-testid="bulk-rows">
            <thead>
              <tr>
                <th>Location</th>
                <th>Eligible</th>
                <th>Cost</th>
                <th>Start</th>
                <th className="num">Queue pos.</th>
                <th>Reason / note</th>
              </tr>
            </thead>
            <tbody>
              {p.rows.map((r) => (
                <tr key={String(r.target)}>
                  <td>{r.name}{r.level ? ` → L${r.level}` : ''}</td>
                  <td className={r.ok ? 'ok' : 'bad'}>{r.ok ? 'Yes' : 'No'}</td>
                  <td>{r.cost ? resM(r.cost) : '—'}</td>
                  <td>{r.startTick !== undefined ? `${gameTime(r.startTick)}${r.durationMin ? ` (+${duration(r.durationMin)})` : ''}` : '—'}</td>
                  <td className="num">{r.queuePosition ?? '—'}</td>
                  <td>{r.ok ? r.warning ?? '' : r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            Total charged now: <strong data-testid="bulk-total">{resM(p.total)}</strong>. Resources are reserved when the job is queued; cancelling a queued job refunds in full, an active job partially.
          </p>
        </>
      )}
    </Modal>
  );
}

interface CityDetail {
  city: CityState;
  status: string;
  homeland: string;
  inspector: { vp: number; terrain: string; private: { morale: number; targetMorale: number; factors: { key: string; label: string; value: number }[]; population: number; buildings: { type: string; level: number; condition: number }[]; output: Record<string, number>; condition: number | null; rally: number | null; jobs: { id: string; kind: string; building?: string; unit?: string; level?: number; startedAt: number | null; endsAt: number | null; enqueuedAt: number; reason?: string; cost: Record<string, number> }[] } | null };
}
interface Opt { id: string; name: string; ok: boolean; reason: string | null; level?: number | null; cost: Record<string, number> | null; startTick: number | null; durationMin: number | null; queuePosition: number | null; warning?: string | null; family?: string }

function CitySheet({ cityKey, tab: initialTab }: { cityKey: string; tab?: string }) {
  const frame = useFrame()!;
  const d = useQuery<CityDetail | null>('cityDetail', [cityKey]);
  const [tab, setTab] = useState(initialTab ?? 'overview');
  const [confirm, setConfirm] = useState<{ title: string; body: React.ReactNode; run: () => Promise<unknown> } | null>(null);
  const ro = frame.meta.readOnly || frame.meta.reviewMode;
  const own = frame.view.cities.find((c) => c.key === cityKey);
  const sorted = [...frame.view.cities].sort((a, b) => a.name.localeCompare(b.name));
  const idx = sorted.findIndex((c) => c.key === cityKey);
  const go = (delta: number) => {
    const c = sorted[(idx + delta + sorted.length) % sorted.length];
    if (!c) return;
    select({ kind: 'city', key: c.key, node: c.node });
    centerOn(NODES[c.node].center[0], NODES[c.node].center[1]);
    ui.patch({ panelArg: { city: c.key, tab } });
  };
  if (!own)
    return (
      <div className="col">
        <div className="card" role="status">
          <strong>This city is no longer yours.</strong>
          <p>It changed hands while this screen was open. Its public details remain in the inspector.</p>
        </div>
        <button type="button" className="btn" onClick={() => ui.patch({ panelArg: null })}>
          Back to city list
        </button>
      </div>
    );
  const c = d.data?.city;
  const pr = d.data?.inspector.private;
  const status = d.data?.status ?? '—';
  return (
    <div className="col" data-testid="city-sheet">
      <div className="row wrap">
        <button type="button" className="btn small" onClick={() => ui.patch({ panelArg: null })}>
          ← All cities
        </button>
        <h3 data-testid="city-sheet-name">{own.name}</h3>
        <span className={`tag${status === 'occupied' ? ' warn' : ''}`}>{status}</span>
        {own.capital && <span className="tag accent">capital</span>}
        {own.port && <span className="tag">port</span>}
        <div className="grow" />
        <button type="button" className="btn small" onClick={() => go(-1)} aria-label="Previous city">
          ← Prev
        </button>
        <button type="button" className="btn small" onClick={() => go(1)} aria-label="Next city">
          Next →
        </button>
      </div>
      <div className="tabs" role="tablist">
        {['overview', 'build', 'mobilize', 'queue'].map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} data-testid={`city-tab-${t}`}>
            {cap(t)}
          </button>
        ))}
      </div>
      {!c || !pr ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          {tab === 'overview' && (
            <div className="row wrap" style={{ alignItems: 'flex-start', gap: 16 }}>
              <div className="col" style={{ flex: '1 1 300px' }}>
                <dl className="kv card">
                  <dt>Nation</dt>
                  <dd>{frame.view.self.name}</dd>
                  <dt>Administration</dt>
                  <dd style={{ textTransform: 'capitalize' }}>{status} {status === 'occupied' ? '(25% output, cannot mobilize)' : status === 'annexed' ? '(50% output)' : '(100% output)'}</dd>
                  <dt>Terrain</dt>
                  <dd>{TERRAIN_LABEL[d.data!.inspector.terrain]}</dd>
                  <dt>Population (mutable)</dt>
                  <dd>{num(c.population)}k (start {num(c.populationStart)}k)</dd>
                  <dt>Victory value (fixed)</dt>
                  <dd>{d.data!.inspector.vp} VP · tier {c.tier}</dd>
                  <dt>Condition</dt>
                  <dd>{c.condition}%</dd>
                  <dt>Morale</dt>
                  <dd>
                    {Math.round(c.morale)} → {Math.round(c.targetMorale)} {c.morale < 33 ? '· uprising risk' : ''}
                  </dd>
                  <dt>Rally point</dt>
                  <dd>{c.rally !== null ? placeName(c.rally) : 'None (units appear here)'}</dd>
                </dl>
                <div className="card">
                  <h4>Morale breakdown (signed)</h4>
                  <table className="data">
                    <tbody>
                      {c.moraleFactors.map((f) => (
                        <tr key={f.key}>
                          <td>{f.label}</td>
                          <td className="num">{signed(f.value)}</td>
                        </tr>
                      ))}
                      <tr>
                        <td><strong>Target</strong></td>
                        <td className="num"><strong>{Math.round(c.targetMorale)}</strong></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="col" style={{ flex: '1 1 300px' }}>
                <div className="card">
                  <h4>Production per day</h4>
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Resource</th>
                        <th className="num">Base</th>
                        <th className="num">Net after factors</th>
                      </tr>
                    </thead>
                    <tbody>
                      {RESOURCES.map((r) => (
                        <tr key={r}>
                          <td>{RESOURCE_LABEL[r]}</td>
                          <td className="num">{num(milli(c.baseOutput[r]))}</td>
                          <td className="num">{num(milli(pr.output[r]))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="muted" style={{ fontSize: 12 }}>Net = base × buildings × morale × condition × administration status factor.</p>
                </div>
                <div className="card">
                  <h4>Buildings</h4>
                  {c.buildings.length === 0 ? (
                    <p className="muted">None yet.</p>
                  ) : (
                    <table className="data">
                      <tbody>
                        {c.buildings.map((b, i) => {
                          const bt = buildingById.get(b.type);
                          const eff = bt?.levels.find((l) => l.level === b.level)?.effects ?? {};
                          return (
                            <tr key={i}>
                              <td>
                                {bt?.name ?? b.type} <span className="muted">L{b.level}</span>
                                <div className="muted" style={{ fontSize: 11.5 }} data-testid="building-effects">{effectsText(eff as Record<string, unknown>) || 'No direct effect at this level'}</div>
                              </td>
                              <td className="num">{b.condition}%</td>
                              <td>
                                <ActionButton
                                  className="btn small danger"
                                  disabledReason={ro ? 'Read-only campaign' : null}
                                  onClick={async () => {
                                    const v = await getHost().preview<{ refund: Record<string, number>; newLevel: number; effectsLost: string[] }>({ type: 'demolish', target: cityKey, building: b.type });
                                    setConfirm({
                                      title: `Demolish ${bt?.name} L${b.level}?`,
                                      body: v.ok ? <p>Consequence: drops to level {v.preview.newLevel}; effects lost: {v.preview.effectsLost.map(effectName).join(', ') || 'none'}. Refund {resM(v.preview.refund)}.</p> : <p className="bad">{v.reason}</p>,
                                      run: () => exec({ type: 'demolish', target: cityKey, building: b.type }, 'Demolished.'),
                                    });
                                  }}
                                >
                                  Demolish
                                </ActionButton>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
                <div className="card">
                  <h4>Administration</h4>
                  {status === 'occupied' ? (
                    <ActionButton
                      className="btn"
                      disabledReason={ro ? 'Read-only campaign' : null}
                      onClick={async () => {
                        const v = await getHost().preview<{ cost: Record<string, number>; durationMin: number; startTick: number }>({ type: 'annex', city: cityKey });
                        setConfirm({
                          title: `Annex ${own.name}?`,
                          body: v.ok ? <p>Cost {resM(v.preview.cost)}; takes {duration(v.preview.durationMin)} starting {gameTime(v.preview.startTick)}. Output rises from 25% to 50% and mobilization becomes possible. Annexation is lost if the city is captured.</p> : <p className="bad">{v.reason}</p>,
                          run: () => exec({ type: 'annex', city: cityKey }, 'Annexation queued.'),
                        });
                      }}
                    >
                      Annex…
                    </ActionButton>
                  ) : (
                    <p className="muted" style={{ margin: 0 }}>{status === 'homeland' ? 'Homeland city — full output and mobilization.' : 'Annexed — 50% output, mobilization allowed.'}</p>
                  )}
                  <RallyPicker cityKey={cityKey} current={c.rally} disabled={ro} />
                </div>
              </div>
            </div>
          )}
          {tab === 'build' && <BuildCatalog target={cityKey} />}
          {tab === 'mobilize' && (status === 'occupied' ? <div className="card warn" role="status">Mobilization is not available in occupied cities. Only homeland and annexed cities mobilize; annex {own.name} first (Overview → Administration).</div> : <UnitCatalog cityKey={cityKey} />)}
          {tab === 'queue' && <Queue jobs={pr.jobs} />}
        </>
      )}
      {confirm && (
        <Modal
          title={confirm.title}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button type="button" className="btn primary" onClick={async () => { await confirm.run(); setConfirm(null); d.refresh(); }}>
                Confirm
              </button>
            </>
          }
        >
          {confirm.body}
        </Modal>
      )}
    </div>
  );
}

function RallyPicker({ cityKey, current, disabled }: { cityKey: string; current: number | null; disabled: boolean }) {
  const frame = useFrame()!;
  const own = frame.view.provinces.map((p) => p.node).sort((a, b) => placeName(a).localeCompare(placeName(b)));
  return (
    <label className="row" style={{ gap: 6, marginTop: 8, fontSize: 13 }}>
      Rally point for new units
      <select value={current ?? ''} disabled={disabled} onChange={(e) => exec({ type: 'setRally', city: cityKey, node: e.target.value === '' ? null : Number(e.target.value) }, 'Rally point set.')}>
        <option value="">None (stay in city)</option>
        {own.map((n) => (
          <option key={n} value={n}>
            {placeName(n)}
          </option>
        ))}
      </select>
    </label>
  );
}

function BuildCatalog({ target }: { target: string | number }) {
  const q = useQuery<Opt[]>('buildOptions', [target]);
  const frame = useFrame()!;
  const ro = frame.meta.readOnly || frame.meta.reviewMode;
  if (!q.data) return <p className="muted">Loading…</p>;
  const coastal = siteIsCoastal(target);
  const shown = q.data.filter((o) => coastal || !buildingById.get(o.id)?.coastalOnly);
  return (
    <>
    {!coastal && (
      <p className="muted" style={{ margin: 0, fontSize: 12.5 }} data-testid="no-naval-note">
        {placeName(typeof target === 'number' ? target : MAP.cityByKey.get(target)?.node)} is not on the coast: coastal-only construction such as a naval base is not offered here.
      </p>
    )}
    <table className="data" data-testid="build-catalog">
      <thead>
        <tr>
          <th>Building</th>
          <th>Cost</th>
          <th>Time</th>
          <th>Starts</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {shown.map((o) => (
          <tr key={o.id}>
            <td>
              {o.name}
              {o.level ? <span className="muted"> → L{o.level}</span> : null}
              <div className="muted" style={{ fontSize: 11.5 }}>{buildingById.get(o.id)?.description}</div>
              {o.warning && <div className="warn" style={{ fontSize: 12 }}>{o.warning}</div>}
            </td>
            <td style={{ fontSize: 12 }}>{o.cost ? resM(o.cost) : '—'}</td>
            <td>{duration(o.durationMin)}</td>
            <td style={{ fontSize: 12 }}>{o.startTick !== null ? `${gameTime(o.startTick)}${o.queuePosition ? ` (#${o.queuePosition})` : ''}` : '—'}</td>
            <td>
              <ActionButton className="btn small primary" disabledReason={ro ? 'Read-only campaign' : o.ok ? null : o.reason ?? 'Not available.'} onClick={async () => { const r = await exec({ type: 'build', building: o.id, targets: [target] }, `Construction queued: ${o.name}.`); if (r.ok) q.refresh(); }} data-testid={`build-${o.id}`}>
                Build
              </ActionButton>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    </>
  );
}

function UnitCatalog({ cityKey }: { cityKey: string }) {
  const q = useQuery<Opt[]>('unitOptions', [cityKey]);
  const frame = useFrame()!;
  const [showAll, setShowAll] = useState(false);
  const ro = frame.meta.readOnly || frame.meta.reviewMode;
  if (!q.data) return <p className="muted">Loading…</p>;
  const coastal = siteIsCoastal(cityKey);
  const sited = coastal ? q.data : q.data.filter((o) => !isNavalUnit(o.id));
  const list = showAll ? sited : sited.filter((o) => o.ok || !/research|unlock|blueprint/i.test(o.reason ?? ''));
  return (
    <div className="col">
      {!coastal && (
        <p className="muted" style={{ margin: 0, fontSize: 12.5 }} data-testid="no-naval-note">
          {MAP.cityByKey.get(cityKey)?.name ?? 'This city'} is not on the coast: ships and submarines cannot be mobilized here.
        </p>
      )}
      <label className="row" style={{ gap: 6 }}>
        <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
        Show units still locked by research
      </label>
      <table className="data" data-testid="unit-catalog">
        <thead>
          <tr>
            <th>Unit</th>
            <th>Cost</th>
            <th>Time</th>
            <th>Starts</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.map((o) => (
            <tr key={o.id}>
              <td>
                <button type="button" className="btn ghost small" style={{ padding: 0, minHeight: 0 }} onClick={() => openPanel('dossier', { unit: o.id })}>
                  {o.name}
                </button>
                <div className="muted" style={{ fontSize: 11.5 }}>{cap(o.family ?? '')}</div>
              </td>
              <td style={{ fontSize: 12 }}>{o.cost ? resM(o.cost) : resM(Object.fromEntries(Object.entries(unitById.get(o.id)?.cost ?? {}).map(([k, v]) => [k, (v ?? 0) * 1000])))}</td>
              <td>{o.durationMin ? duration(o.durationMin) : `${unitById.get(o.id)?.buildHours ?? '—'} h`}</td>
              <td style={{ fontSize: 12 }}>{o.startTick !== null ? `${gameTime(o.startTick)}${o.queuePosition ? ` (#${o.queuePosition})` : ''}` : '—'}</td>
              <td>
                <ActionButton className="btn small primary" disabledReason={ro ? 'Read-only campaign' : o.ok ? null : o.reason ?? 'Not available.'} onClick={async () => { const r = await exec({ type: 'mobilize', unit: o.id, cities: [cityKey] }, `Mobilization queued: ${o.name}.`); if (r.ok) q.refresh(); }} data-testid={`mobilize-${o.id}`}>
                  Mobilize
                </ActionButton>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Queue({ jobs }: { jobs: { id: string; kind: string; building?: string; unit?: string; level?: number; startedAt: number | null; endsAt: number | null; enqueuedAt: number; reason?: string; cost: Record<string, number> }[] }) {
  const frame = useFrame()!;
  const [refund, setRefund] = useState<{ id: string; text: string } | null>(null);
  if (!jobs.length) return <div className="empty">Nothing queued here.</div>;
  return (
    <>
      <table className="data" data-testid="job-queue">
        <thead>
          <tr>
            <th>Job</th>
            <th>State</th>
            <th>Done</th>
            <th>Charged</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id}>
              <td>
                {j.unit && <PlannedUnitSym unit={j.unit} />} {cap(j.kind)}: {j.unit ? `${unitById.get(j.unit)?.name} (planned)` : j.building ? `${buildingById.get(j.building)?.name} L${j.level ?? ''}` : ''}
              </td>
              <td>{j.startedAt !== null ? <span className="tag ok">working</span> : j.reason ? <span className="tag bad">blocked: {j.reason}</span> : <span className="tag">queued</span>}</td>
              <td>{j.endsAt ? `${gameTime(j.endsAt)} (${duration(j.endsAt - frame.view.tick)})` : '—'}</td>
              <td style={{ fontSize: 12 }}>{resM(j.cost)}</td>
              <td>
                <button
                  type="button"
                  className="btn small"
                  onClick={async () => {
                    const v = await getHost().preview<{ refund: Record<string, number>; active: boolean }>({ type: 'cancelJob', job: j.id });
                    setRefund({ id: j.id, text: v.ok ? `Refund ${resM(v.preview.refund)} (${v.preview.active ? 'active job: partial refund' : 'queued job: full refund'}).` : v.reason });
                  }}
                >
                  Cancel…
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {refund && (
        <Modal
          title="Cancel job?"
          onClose={() => setRefund(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setRefund(null)}>
                Keep job
              </button>
              <button type="button" className="btn danger" onClick={async () => { await exec({ type: 'cancelJob', job: refund.id }, 'Job cancelled.'); setRefund(null); }}>
                Cancel job
              </button>
            </>
          }
        >
          <p>{refund.text}</p>
        </Modal>
      )}
    </>
  );
}

function RuralSheet({ node }: { node: number }) {
  const n = NODES[node];
  return (
    <div className="col">
      <div className="row">
        <button type="button" className="btn small" onClick={() => ui.patch({ panelArg: null })}>
          ← All cities
        </button>
        <h3>{n.name} (rural province)</h3>
      </div>
      <p className="dim" style={{ margin: 0 }}>
        Terrain {TERRAIN_LABEL[n.terrain]} · deposit {n.deposit ? RESOURCE_LABEL[n.deposit] : 'none'} {n.coastal ? '· coastal' : ''}. Rural improvements that need a deposit produce nothing without one.
      </p>
      <BuildCatalog target={node} />
    </div>
  );
}

void MAP;
