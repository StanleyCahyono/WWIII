import React, { useEffect, useMemo, useState } from 'react';
import { useFrame, useQuery, ActionButton, Modal, newNonce, PlannedUnitSym } from '../components/common';
import { getHost } from '../sim/host';
import { ui, select, centerOn, openPanel, toast, startOrder } from '../state/ui';
import { NODES, CATALOG, buildingById, unitById, RESOURCE_LABEL, placeName, TERRAIN_LABEL, MAP, missileById } from '../data/static';
import { milli, num, signed, resM, gameTime, duration, cap } from '../format';
import { effectsText, effectName } from '../effects';
import { exec } from '../sim/exec';
import { RESOURCES } from '../../engine/data-types';
import type { CityState } from '../../engine/index';
import type { Frame } from '../sim/protocol';
import { Icon, RESOURCE_ICON } from '../icons';
import { Cost, Duration, Progress, IconTabs, SectionHead, Expander, ResChip, topOutputs, type TabDef } from './panelKit';
import { BuildingIcon, BuildingPlate, InfoIcon, MoraleFace, RallyIcon, TierBadge, UnitPlate, UNIT_CLASSES, unitClassOf, type UnitClass } from './panelIcons';

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
type JobLike = { id: string; kind: string; city?: string | null; node?: number; building?: string; unit?: string; missile?: string; level?: number; startedAt: number | null; endsAt: number | null; enqueuedAt: number; reason?: string; cost: Record<string, number>; durationMin?: number; slot?: string };

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

/** Spendable stock (milli) per resource — used to flag cost chips the nation cannot pay now. */
function spendable(frame: Frame): Record<string, number> {
  return Object.fromEntries(frame.view.self.resources.map((r) => [r.resource, r.spendable]));
}
/** Population is stored in thousands. */
function popLabel(k: number): string {
  return k >= 1000 ? `${(k / 1000).toFixed(1)}M` : `${Math.round(k)}k`;
}
function moraleTone(m: number): 'ok' | 'warn' | 'bad' {
  return m >= 66 ? 'ok' : m >= 33 ? 'warn' : 'bad';
}
function statusNote(status: string): string {
  return status === 'occupied' ? '25% output · cannot mobilize' : status === 'annexed' ? '50% output' : '100% output';
}

type SortKey = 'name' | 'status' | 'tier' | 'vp' | 'population' | 'morale' | 'netValue' | 'jobs';

export function CitiesPanel({ arg }: { arg: { city?: string; tab?: string; node?: number } | null }) {
  if (arg?.city) return <CitySheet key={`${arg.city}:${arg.tab ?? ''}`} cityKey={arg.city} tab={arg.tab} />;
  if (arg?.node !== undefined && arg?.node !== null) return <RuralSheet node={arg.node} />;
  return <CityList />;
}

const listState = { sort: 'netValue' as SortKey, dir: -1, q: '', checked: new Set<string>(), view: 'list' as 'list' | 'queue' };

function CityList() {
  const q = useQuery<CityRow[]>('cityList');
  const frame = useFrame()!;
  const [view, setView] = useState<'list' | 'queue'>(listState.view);
  const [sort, setSort] = useState<SortKey>(listState.sort);
  const [dir, setDir] = useState(listState.dir);
  const [filter, setFilter] = useState(listState.q);
  const [checked, setChecked] = useState<Set<string>>(listState.checked);
  const [project, setProject] = useState<string>('');
  const [rally, setRally] = useState<CityRow | null>(null);
  const [preview, setPreview] = useState<{ cmd: Record<string, unknown>; p: BulkPreview | null; error: string | null; stale?: boolean } | null>(null);
  useEffect(() => {
    Object.assign(listState, { sort, dir, q: filter, checked, view });
  }, [sort, dir, filter, checked, view]);
  const rows = useMemo(() => {
    const r = (q.data ?? []).filter((c) => !filter || c.name.toLowerCase().includes(filter.toLowerCase()));
    return r.sort((a, b) => {
      const va = a[sort], vb = b[sort];
      return (typeof va === 'string' ? (va as string).localeCompare(vb as string) : (va as number) - (vb as number)) * dir;
    });
  }, [q.data, sort, dir, filter]);
  const byKey = useMemo(() => new Map(frame.view.cities.map((c) => [c.key, c])), [frame.view.cities]);
  const th = (k: SortKey, label: string, numeric = true, extra?: string) => (
    <th className={`${numeric ? 'num' : ''}${extra ? ' ' + extra : ''}`} aria-sort={sort === k ? (dir > 0 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="sort" onClick={() => (sort === k ? setDir(-dir) : (setSort(k), setDir(k === 'name' ? 1 : -1)))} data-testid={`sort-${k}`}>
        {label}
        <span className="p-sort" aria-hidden="true">{sort === k ? (dir > 0 ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  );
  const allChecked = rows.length > 0 && rows.every((r) => checked.has(r.key));
  // A nation without a single coastal city (landlocked) is never offered naval projects.
  const anyCoastal = frame.view.cities.some((c) => !!NODES[c.node]?.coastal);
  const ro = frame.meta.readOnly || frame.meta.reviewMode;
  const jobs = frame.view.self.jobs as unknown as JobLike[];
  const totalOut = useMemo(() => {
    const t: Record<string, number> = {};
    for (const c of q.data ?? []) for (const r of RESOURCES) t[r] = (t[r] ?? 0) + (c.output[r] ?? 0);
    return t;
  }, [q.data]);
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
  const openCity = (r: CityRow, tab?: string) => {
    select({ kind: 'city', key: r.key, node: r.node });
    openPanel('cities', tab ? { city: r.key, tab } : { city: r.key });
  };
  return (
    <div className="col p-root" data-testid="cities-list">
      <IconTabs
        compact
        label="City administration"
        value={view}
        onChange={setView}
        tabs={[
          { key: 'list', label: 'City list', icon: <Icon name="cities" size={18} />, badge: q.data?.length },
          { key: 'queue', label: 'Build queue', icon: <Icon name="build" size={18} />, badge: jobs.length || undefined },
        ]}
      />
      {view === 'queue' ? (
        <Queue jobs={jobs} showCity />
      ) : (
        <>
          <div className="p-summary">
            <div className="p-summary-l">
              <span className="p-kicker">Daily output, all cities</span>
              <Cost cost={totalOut} sign empty="nothing" />
            </div>
          </div>
          <div className="p-toolbar">
            <label className="sr-only" htmlFor="city-filter">Filter cities</label>
            <span className="p-search">
              <Icon name="search" size={15} />
              <input id="city-filter" type="search" placeholder="Find a city…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </span>
            <span className="muted p-count">{rows.length} cities · <strong>{checked.size}</strong> ticked</span>
            <div className="grow" />
            <div className="p-bulk">
              <label className="sr-only" htmlFor="bulk-project">Project for selected cities</label>
              <select id="bulk-project" value={project} onChange={(e) => setProject(e.target.value)} data-testid="bulk-project">
                <option value="">Order in ticked cities…</option>
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
          </div>
          {q.error && <p className="bad">{q.error}</p>}
          {!q.data ? (
            <p className="muted">Loading…</p>
          ) : rows.length === 0 ? (
            <div className="empty">{filter ? 'No city matches.' : 'You hold no cities. A country with no territory and no recovery force is defeated.'}</div>
          ) : (
            <div className="p-tablewrap">
              <table className="data p-citytable">
                <thead>
                  <tr>
                    <th className="p-chk">
                      <input type="checkbox" aria-label="Select all cities" checked={allChecked} onChange={() => setChecked(allChecked ? new Set() : new Set(rows.map((r) => r.key)))} />
                    </th>
                    {th('tier', 'Size', false)}
                    {th('name', 'City', false)}
                    {th('morale', 'Morale', false)}
                    {th('netValue', 'Production /day', false)}
                    <th className="p-hide-narrow">Buildings</th>
                    {th('jobs', 'Queue')}
                    <th className="p-acts-h"><span className="sr-only">Quick orders</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const cs = byKey.get(r.key);
                    const tone = moraleTone(r.morale);
                    return (
                      <tr key={r.key} className={checked.has(r.key) ? 'sel' : ''}>
                        <td className="p-chk">
                          <input type="checkbox" aria-label={`Select ${r.name}`} checked={checked.has(r.key)} onChange={() => setChecked((s) => { const n = new Set(s); n.has(r.key) ? n.delete(r.key) : n.add(r.key); return n; })} data-testid={`city-check-${r.key}`} />
                        </td>
                        <td>
                          <TierBadge tier={r.tier} capital={cs?.capital} port={cs?.port} />
                        </td>
                        <td className="p-cityname">
                          <button type="button" className="p-link" onClick={() => openCity(r)} data-testid={`city-open-${r.key}`}>
                            {r.name}
                          </button>
                          <div className="p-sub">
                            <span className={`p-pill${r.status === 'occupied' ? ' warn' : r.status === 'annexed' ? ' accent' : ''}`}>{r.status}</span>
                            {r.revoltRisk && <span className="p-pill bad">unrest</span>}
                            <span>{r.vp} VP · {popLabel(r.population)} pop.</span>
                          </div>
                        </td>
                        <td>
                          <span className={`p-morale ${tone}`} title={`Morale ${Math.round(r.morale)}, heading to ${Math.round(r.targetMorale)}`}>
                            <MoraleFace value={r.morale} />
                            <span className="p-morale-col">
                              <span className="p-morale-n">
                                {Math.round(r.morale)}
                                <span className="muted"> → {Math.round(r.targetMorale)}</span>
                              </span>
                              <Progress value={r.morale / 100} tone={tone} label={`Morale ${Math.round(r.morale)} of 100`} />
                            </span>
                          </span>
                        </td>
                        <td>
                          <Cost cost={r.output} sign max={3} />
                          <div className="p-sub" title="Net production valued at reference prices">≈ {num(r.netValue)} value/day</div>
                        </td>
                        <td className="p-hide-narrow">
                          <span className="p-blds">
                            {(cs?.buildings ?? []).slice(0, 7).map((b) => (
                              <span key={b.type} className={`p-bld${b.condition < 100 ? ' dmg' : ''}`} title={`${buildingById.get(b.type)?.name ?? b.type} level ${b.level}, ${b.condition}% condition`}>
                                <BuildingIcon id={b.type} size={14} />
                                <span>{b.level}</span>
                              </span>
                            ))}
                            {(cs?.buildings.length ?? 0) > 7 && <span className="muted">+{(cs?.buildings.length ?? 0) - 7}</span>}
                            {!cs?.buildings.length && <span className="muted">—</span>}
                          </span>
                        </td>
                        <td className="num">{r.jobs ? <span className="p-badge solid" title={`${r.jobs} job(s) queued`}>{r.jobs}</span> : <span className="muted" title="Nothing queued">0</span>}</td>
                        <td className="p-acts">
                          <button type="button" className="p-qbtn" onClick={() => openCity(r, 'build')} disabled={ro} title={ro ? 'Read-only campaign' : `Build in ${r.name}`} aria-label={`Build in ${r.name}`}>
                            <Icon name="build" size={16} />
                            <span>Build</span>
                          </button>
                          <button type="button" className="p-qbtn" onClick={() => openCity(r, 'mobilize')} disabled={ro || !r.canMobilize} title={ro ? 'Read-only campaign' : !r.canMobilize ? 'Occupied: annex the city first to mobilize here.' : `Mobilize in ${r.name}`} aria-label={`Mobilize in ${r.name}`}>
                            <Icon name="mobilize" size={16} />
                            <span>Mobilize</span>
                          </button>
                          <button type="button" className={`p-qbtn icon${cs?.rally !== null && cs?.rally !== undefined ? ' on' : ''}`} onClick={() => setRally(r)} disabled={ro} title={cs?.rally !== null && cs?.rally !== undefined ? `Rally point: ${placeName(cs.rally)}` : 'Set a rally point'} aria-label={`Rally point for ${r.name}`}>
                            <RallyIcon size={16} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {rally && (
        <Modal title={`Rally point — ${rally.name}`} onClose={() => setRally(null)} footer={<button type="button" className="btn" onClick={() => setRally(null)}>Done</button>}>
          <p className="dim" style={{ margin: 0 }}>New units mobilized in {rally.name} march to this province when they are ready.</p>
          <RallyPicker cityKey={rally.key} current={byKey.get(rally.key)?.rally ?? null} disabled={ro} />
        </Modal>
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
          <div className="p-bulkhead">
            {preview.cmd.type === 'build' ? <BuildingPlate id={preview.cmd.building as string} size={52} /> : <UnitPlate family={unitById.get(preview.cmd.unit as string)?.family} size={52} />}
            <div>
              <div className="p-big">
                <strong>{p.eligible}</strong> of {p.rows.length} location(s) can proceed
              </div>
              <div className="dim">Only those rows will be ordered and charged.</div>
            </div>
            <div className="grow" />
            <Cost cost={p.total} />
          </div>
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
                  <td className={r.ok ? 'ok' : 'bad'}>{r.ok ? '✓ Yes' : '✕ No'}</td>
                  <td>{r.cost ? <Cost cost={r.cost} /> : '—'}</td>
                  <td>{r.startTick !== undefined ? `${gameTime(r.startTick)}${r.durationMin ? ` (+${duration(r.durationMin)})` : ''}` : '—'}</td>
                  <td className="num">{r.queuePosition ?? '—'}</td>
                  <td>{r.ok ? r.warning ?? '' : r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ margin: 0 }}>
            Total charged now: <strong data-testid="bulk-total">{resM(p.total)}</strong>. <span className="muted">Resources are reserved when the job is queued; cancelling a queued job refunds in full, an active job partially.</span>
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
  inspector: { vp: number; terrain: string; private: { morale: number; targetMorale: number; factors: { key: string; label: string; value: number }[]; population: number; buildings: { type: string; level: number; condition: number }[]; output: Record<string, number>; condition: number | null; rally: number | null; jobs: JobLike[] } | null };
}
interface Opt { id: string; name: string; ok: boolean; reason: string | null; level?: number | null; cost: Record<string, number> | null; startTick: number | null; durationMin: number | null; queuePosition: number | null; warning?: string | null; family?: string }

type CityTab = 'overview' | 'build' | 'mobilize' | 'queue' | `unit-${UnitClass}`;

function CitySheet({ cityKey, tab: initialTab }: { cityKey: string; tab?: string }) {
  const frame = useFrame()!;
  const d = useQuery<CityDetail | null>('cityDetail', [cityKey]);
  const [tab, setTab] = useState<CityTab>((initialTab as CityTab) ?? 'overview');
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
  const coastal = siteIsCoastal(cityKey);
  const jobs = pr?.jobs ?? [];
  const constructing = jobs.find((j) => j.startedAt !== null && (j.slot ? j.slot === 'construct' : j.kind !== 'mobilize'));
  const mobilizing = jobs.find((j) => j.startedAt !== null && (j.slot ? j.slot === 'mobilize' : j.kind === 'mobilize'));
  const next = jobs.find((j) => j.startedAt === null);
  const classTabs: TabDef<CityTab>[] = UNIT_CLASSES.filter((k) => coastal || (k.key !== 'naval' && k.key !== 'submarine')).map((k) => ({ key: `unit-${k.key}` as CityTab, label: k.short, title: k.label, icon: <Icon name={k.icon} size={20} />, testid: `city-tab-unit-${k.key}` }));
  const tabs: TabDef<CityTab>[] = [
    { key: 'overview', label: 'Overview', icon: <Icon name="city" size={20} />, testid: 'city-tab-overview' },
    { key: 'build', label: 'Buildings', icon: <Icon name="build" size={20} />, testid: 'city-tab-build' },
    { key: 'mobilize', label: 'All units', icon: <Icon name="mobilize" size={20} />, testid: 'city-tab-mobilize' },
    ...classTabs,
    { key: 'queue', label: 'Queue', icon: <Icon name="clock" size={20} />, testid: 'city-tab-queue', badge: jobs.length || undefined },
  ];
  const tone = moraleTone(c?.morale ?? own.morale);
  const unitTab = tab === 'mobilize' || tab.startsWith('unit-');
  return (
    <div className="col p-root" data-testid="city-sheet">
      <div className="p-cityhead">
        <button type="button" className="btn small" onClick={() => ui.patch({ panelArg: null })}>
          <Icon name="chevron-left" size={14} /> All cities
        </button>
        <TierBadge tier={own.tier} capital={own.capital} port={own.port} />
        <h3 data-testid="city-sheet-name">{own.name}</h3>
        <span className={`p-pill${status === 'occupied' ? ' warn' : status === 'annexed' ? ' accent' : ''}`}>{status}</span>
        {own.capital && <span className="p-pill accent">capital</span>}
        {own.port && <span className="p-pill">port</span>}
        <div className="grow" />
        <button type="button" className="btn small" onClick={() => go(-1)} aria-label="Previous city">
          <Icon name="chevron-left" size={14} /> Prev
        </button>
        <button type="button" className="btn small" onClick={() => go(1)} aria-label="Next city">
          Next <Icon name="chevron-right" size={14} />
        </button>
      </div>
      <div className="p-hero">
        <div className="p-hero-block">
          <span className="p-kicker">Top output /day</span>
          <span className="p-cost big">
            {topOutputs(pr?.output, 4).map((o) => (
              <ResChip key={o.r} r={o.r} amount={o.v} sign />
            ))}
            {pr && topOutputs(pr.output).length === 0 && <span className="muted">nothing</span>}
          </span>
        </div>
        <div className="p-hero-block">
          <span className="p-kicker">Morale</span>
          <span className={`p-morale big ${tone}`}>
            <MoraleFace value={c?.morale ?? own.morale} size={30} />
            <span className="p-morale-col">
              <span className="p-morale-n">
                {Math.round(c?.morale ?? own.morale)} <span className="muted">→ {Math.round(pr?.targetMorale ?? c?.targetMorale ?? own.targetMorale)}</span>
                {(c?.morale ?? own.morale) < 33 && <span className="p-pill bad">uprising risk</span>}
              </span>
              <Progress value={(c?.morale ?? own.morale) / 100} tone={tone} label={`Morale ${Math.round(c?.morale ?? own.morale)} of 100`} />
            </span>
          </span>
        </div>
        <div className="p-hero-block p-hero-facts">
          <span><Icon name="star" size={14} /> {d.data?.inspector.vp ?? '—'} VP</span>
          <span><Icon name="coalition" size={14} /> {popLabel(c?.population ?? own.population)}</span>
          <span><Icon name="shield" size={14} /> {c?.condition ?? own.condition}% condition</span>
        </div>
      </div>
      <div className="p-slots" aria-label="Production slots">
        <JobSlot title="Currently constructing" job={constructing} now={frame.view.tick} empty="Construction slot idle" />
        <JobSlot title="Currently mobilizing" job={mobilizing} now={frame.view.tick} empty={status === 'occupied' ? 'Occupied: no mobilization' : 'Mobilization slot idle'} />
        <JobSlot title="Next in queue" job={next} now={frame.view.tick} empty="Queue empty" />
      </div>
      <IconTabs label="City window sections" value={tab} onChange={setTab} tabs={tabs} className="p-citytabs" />
      {!c || !pr ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          {tab === 'overview' && (
            <div className="p-grid2">
              <div className="col">
                <div className="p-card">
                  <SectionHead icon={<Icon name="city" size={18} />} title="City profile" level={4} />
                  <dl className="kv">
                    <dt>Nation</dt>
                    <dd>{frame.view.self.name}</dd>
                    <dt>Administration</dt>
                    <dd style={{ textTransform: 'capitalize' }}>{status} ({statusNote(status)})</dd>
                    <dt>Terrain</dt>
                    <dd>{TERRAIN_LABEL[d.data!.inspector.terrain]}</dd>
                    <dt>Population (mutable)</dt>
                    <dd>{num(c.population)}k (start {num(c.populationStart)}k)</dd>
                    <dt>Victory value (fixed)</dt>
                    <dd>{d.data!.inspector.vp} VP · tier {c.tier}</dd>
                    <dt>Rally point</dt>
                    <dd>{c.rally !== null ? placeName(c.rally) : 'None (units appear here)'}</dd>
                  </dl>
                </div>
                <div className="p-card">
                  <SectionHead icon={<MoraleFace value={c.morale} size={18} />} title="Morale breakdown" level={4}>
                    <span className="muted">target {Math.round(pr.targetMorale)}</span>
                  </SectionHead>
                  <ul className="p-factors">
                    {(pr.factors.length ? pr.factors : c.moraleFactors).map((f) => (
                      <li key={f.key}>
                        <span className="grow">{f.label}</span>
                        <span className="p-fbar" aria-hidden="true">
                          <span className={f.value >= 0 ? 'pos' : 'neg'} style={{ width: `${Math.min(50, Math.abs(f.value))}%` }} />
                        </span>
                        <span className={`num ${f.value > 0 ? 'ok' : f.value < 0 ? 'bad' : 'muted'}`}>{signed(f.value)}</span>
                      </li>
                    ))}
                    <li className="p-ftotal">
                      <span className="grow">Target</span>
                      <strong className="num">{Math.round(pr.targetMorale)}</strong>
                    </li>
                  </ul>
                </div>
                <div className="p-card">
                  <SectionHead icon={<Icon name="flag" size={18} />} title="Administration" level={4} />
                  {status === 'occupied' ? (
                    <div className="row wrap">
                      <span className="dim">Occupied: 25% output and no mobilization until annexed.</span>
                      <ActionButton
                        className="btn primary"
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
                    </div>
                  ) : (
                    <p className="muted" style={{ margin: 0 }}>{status === 'homeland' ? 'Homeland city — full output and mobilization.' : 'Annexed — 50% output, mobilization allowed.'}</p>
                  )}
                  <RallyPicker cityKey={cityKey} current={c.rally} disabled={ro} />
                </div>
              </div>
              <div className="col">
                <div className="p-card">
                  <SectionHead icon={<Icon name="build" size={18} />} title={`Buildings (${c.buildings.length})`} level={4}>
                    <button type="button" className="btn small" onClick={() => setTab('build')}>
                      Build more
                    </button>
                  </SectionHead>
                  {c.buildings.length === 0 ? (
                    <p className="muted">None yet.</p>
                  ) : (
                    <ul className="p-bldlist">
                      {c.buildings.map((b, i) => {
                        const bt = buildingById.get(b.type);
                        const eff = bt?.levels.find((l) => l.level === b.level)?.effects ?? {};
                        return (
                          <li key={i}>
                            <BuildingPlate id={b.type} size={44} />
                            <div className="grow">
                              <div className="row" style={{ gap: 6 }}>
                                <strong>{bt?.name ?? b.type}</strong>
                                <span className="p-lvl">L{b.level}</span>
                                {bt && <span className="muted" style={{ fontSize: 11.5 }}>of {bt.maxLevel}</span>}
                              </div>
                              <div className="muted p-eff" data-testid="building-effects">{effectsText(eff as Record<string, unknown>) || 'No direct effect at this level'}</div>
                              <span className="p-cond">
                                <Progress value={b.condition / 100} tone={b.condition >= 70 ? 'ok' : b.condition >= 35 ? 'warn' : 'bad'} label={`Condition ${b.condition}%`} />
                                <span className="num">{b.condition}%</span>
                              </span>
                            </div>
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
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
                <div className="p-card">
                  <SectionHead icon={<Icon name="economy" size={18} />} title="Production per day" level={4} />
                  <Cost cost={pr.output} sign empty="nothing" />
                  <Expander summary="Base vs. net breakdown">
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
                    <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>Net = base × buildings × morale × condition × administration status factor.</p>
                  </Expander>
                </div>
              </div>
            </div>
          )}
          {tab === 'build' && <BuildCatalog target={cityKey} />}
          {unitTab &&
            (status === 'occupied' ? (
              <div className="p-card warn" role="status">
                Mobilization is not available in occupied cities. Only homeland and annexed cities mobilize; annex {own.name} first (Overview → Administration).
              </div>
            ) : (
              <UnitCatalog cityKey={cityKey} cls={tab === 'mobilize' ? null : (tab.slice(5) as UnitClass)} />
            ))}
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

function jobName(j: JobLike): string {
  if (j.unit) return unitById.get(j.unit)?.name ?? j.unit;
  if (j.building) return `${buildingById.get(j.building)?.name ?? j.building}${j.level ? ` L${j.level}` : ''}`;
  if (j.missile) return missileById.get(j.missile)?.name ?? j.missile;
  return cap(j.kind);
}
function JobArt({ j, size = 40 }: { j: JobLike; size?: number }) {
  if (j.unit) return <UnitPlate family={unitById.get(j.unit)?.family} size={size} />;
  if (j.building) return <BuildingPlate id={j.building} size={size} />;
  if (j.missile) return <BuildingPlate id="missile_complex" size={size} />;
  return <BuildingPlate id={j.kind === 'annex' ? 'army_base' : 'arms_industry'} size={size} />;
}

function JobSlot({ title, job, now, empty }: { title: string; job: JobLike | undefined; now: number; empty: string }) {
  const total = job?.endsAt && job.startedAt !== null ? Math.max(1, job.endsAt - job.startedAt) : job?.durationMin ?? 0;
  const done = job?.startedAt !== null && job?.startedAt !== undefined && total ? (now - job.startedAt) / total : 0;
  return (
    <div className={`p-slot${job ? ' busy' : ''}`}>
      <span className="p-kicker">{title}</span>
      {job ? (
        <div className="p-slot-row">
          <JobArt j={job} size={40} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="p-ellip"><strong>{jobName(job)}</strong></div>
            {job.startedAt !== null ? (
              <>
                <Progress value={done} tone="accent" label={`${Math.round(done * 100)}% complete`} />
                <span className="muted p-small">{job.endsAt ? `${duration(job.endsAt - now)} left` : 'working'}</span>
              </>
            ) : (
              <span className="muted p-small">{job.reason ? `blocked: ${job.reason}` : `waiting · ${duration(job.durationMin ?? null)}`}</span>
            )}
          </div>
        </div>
      ) : (
        <div className="p-slot-empty">{empty}</div>
      )}
    </div>
  );
}

function RallyPicker({ cityKey, current, disabled }: { cityKey: string; current: number | null; disabled: boolean }) {
  const frame = useFrame()!;
  const own = frame.view.provinces.map((p) => p.node).sort((a, b) => placeName(a).localeCompare(placeName(b)));
  return (
    <span className="row wrap" style={{ gap: 6 }}>
      <label className="row p-rally">
        <RallyIcon size={16} />
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
      <button type="button" className="btn small" disabled={disabled} onClick={(e) => startOrder({ kind: 'rally', city: cityKey }, e)} data-testid="rally-on-map" title="Pick the rally point directly on the map (hover previews, click sets it)">
        Pick on map
      </button>
    </span>
  );
}

function startLine(o: Opt, now: number): string {
  if (o.startTick === null) return '';
  if (o.startTick <= now && !(o.queuePosition && o.queuePosition > 1)) return 'Starts now';
  return o.queuePosition && o.queuePosition > 1 ? `Starts ${gameTime(o.startTick)} · #${o.queuePosition} in queue` : `Starts ${gameTime(o.startTick)}`;
}

function BuildCatalog({ target }: { target: string | number }) {
  const q = useQuery<Opt[]>('buildOptions', [target]);
  const frame = useFrame()!;
  const [info, setInfo] = useState<string | null>(null);
  const ro = frame.meta.readOnly || frame.meta.reviewMode;
  if (!q.data) return <p className="muted">Loading…</p>;
  const coastal = siteIsCoastal(target);
  const shown = q.data.filter((o) => coastal || !buildingById.get(o.id)?.coastalOnly);
  const stock = spendable(frame);
  const have = new Map<string, number>(
    (typeof target === 'string' ? frame.view.cities.find((c) => c.key === target)?.buildings ?? [] : frame.view.provinces.find((p) => p.node === target)?.buildings ?? []).map((b) => [b.type, b.level] as [string, number]),
  );
  return (
    <>
      {!coastal && (
        <p className="muted p-note" data-testid="no-naval-note">
          {placeName(typeof target === 'number' ? target : MAP.cityByKey.get(target)?.node)} is not on the coast: coastal-only construction such as a naval base is not offered here.
        </p>
      )}
      <table className="p-cat" data-testid="build-catalog">
        <thead className="sr-only">
          <tr>
            <th>Building</th>
            <th>Cost</th>
            <th>Time</th>
            <th>Order</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((o) => {
            const bt = buildingById.get(o.id);
            const cur = have.get(o.id) ?? 0;
            return (
              <React.Fragment key={o.id}>
                <tr className={o.ok ? '' : 'off'}>
                  <td className="p-cat-art">
                    <BuildingPlate id={o.id} size={60} />
                  </td>
                  <td className="p-cat-name">
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      <strong>{o.name}</strong>
                      {o.level ? <span className="p-lvl">{cur ? `L${cur} → ` : ''}L{o.level}</span> : null}
                    </div>
                    <div className="muted p-desc">{bt?.description}</div>
                    {o.warning && <div className="warn p-small">{o.warning}</div>}
                  </td>
                  <td className="p-cat-cost">
                    <Cost cost={o.cost} stock={stock} />
                  </td>
                  <td className="p-cat-time">
                    <Duration min={o.durationMin} />
                    <div className="muted p-small">{startLine(o, frame.view.tick)}</div>
                  </td>
                  <td className="p-cat-go">
                    <button type="button" className="p-info" aria-expanded={info === o.id} aria-label={`About ${o.name}`} title="Details" onClick={() => setInfo(info === o.id ? null : o.id)}>
                      <InfoIcon />
                    </button>
                    <ActionButton className="btn primary p-start" aria-label={`Start building ${o.name}`} disabledReason={ro ? 'Read-only campaign' : o.ok ? null : o.reason ?? 'Not available.'} onClick={async () => { const r = await exec({ type: 'build', building: o.id, targets: [target] }, `Construction queued: ${o.name}.`); if (r.ok) q.refresh(); }} data-testid={`build-${o.id}`}>
                      <Icon name="build" size={16} /> Start
                    </ActionButton>
                  </td>
                </tr>
                {info === o.id && bt && (
                  <tr className="p-cat-info">
                    <td colSpan={5}>
                      <BuildingLevels id={o.id} current={cur} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function BuildingLevels({ id, current }: { id: string; current: number }) {
  const bt = buildingById.get(id);
  if (!bt) return null;
  return (
    <div className="p-levels">
      {bt.levels.map((l) => (
        <div key={l.level} className={`p-levelcard${l.level === current ? ' cur' : l.level < current ? ' done' : ''}`}>
          <div className="row" style={{ gap: 6 }}>
            <span className="p-lvl">L{l.level}</span>
            {l.level === current && <span className="p-pill ok">current</span>}
          </div>
          <div className="p-small">{effectsText(l.effects as Record<string, unknown>) || 'No direct effect'}</div>
          <div className="p-small muted">
            Upkeep: <Cost cost={l.upkeepPerDay} whole empty="none" />
          </div>
        </div>
      ))}
    </div>
  );
}

function UnitCatalog({ cityKey, cls }: { cityKey: string; cls: UnitClass | null }) {
  const q = useQuery<Opt[]>('unitOptions', [cityKey]);
  const frame = useFrame()!;
  const [showAll, setShowAll] = useState(false);
  const ro = frame.meta.readOnly || frame.meta.reviewMode;
  if (!q.data) return <p className="muted">Loading…</p>;
  const coastal = siteIsCoastal(cityKey);
  const sited = coastal ? q.data : q.data.filter((o) => !isNavalUnit(o.id));
  const inClass = cls ? sited.filter((o) => unitClassOf(unitById.get(o.id)) === cls) : sited;
  const list = showAll ? inClass : inClass.filter((o) => o.ok || !/research|unlock|blueprint/i.test(o.reason ?? ''));
  const hidden = inClass.length - list.length;
  const stock = spendable(frame);
  const groups = UNIT_CLASSES.map((k) => ({ k, items: list.filter((o) => unitClassOf(unitById.get(o.id)) === k.key) })).filter((g) => g.items.length);
  const row = (o: Opt) => {
    const ut = unitById.get(o.id);
    const lvl = frame.view.self.unitLevels[o.id] ?? 1;
    const st = ut?.levels.find((l) => l.level === lvl) ?? ut?.levels[0];
    const cost = o.cost ?? Object.fromEntries(Object.entries(ut?.cost ?? {}).map(([k, v]) => [k, (v ?? 0) * 1000]));
    return (
      <tr key={o.id} className={o.ok ? '' : 'off'}>
        <td className="p-cat-art">
          <UnitPlate family={ut?.family} size={60} />
        </td>
        <td className="p-cat-name">
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <strong>{o.name}</strong>
            <span className="p-lvl" title="Your researched level">L{lvl}</span>
          </div>
          <div className="p-stats muted">
            <span>{cap(o.family ?? '')}</span>
            {st && (
              <>
                <span title="Hit points"><Icon name="hp" size={13} /> {st.hp}</span>
                <span title="Speed"><Icon name="speed" size={13} /> {st.speedKmh} km/h</span>
              </>
            )}
          </div>
        </td>
        <td className="p-cat-cost">
          <Cost cost={cost} stock={o.ok ? stock : undefined} />
        </td>
        <td className="p-cat-time">
          <Duration min={o.durationMin ?? (ut ? ut.buildHours * 60 : null)} />
          <div className="muted p-small">{startLine(o, frame.view.tick)}</div>
        </td>
        <td className="p-cat-go">
          <button type="button" className="p-info" aria-label={`Unit details: ${o.name}`} title="Unit details" onClick={() => openPanel('dossier', { unit: o.id })}>
            <InfoIcon />
          </button>
          <ActionButton className="btn primary p-start" aria-label={`Start mobilizing ${o.name}`} disabledReason={ro ? 'Read-only campaign' : o.ok ? null : o.reason ?? 'Not available.'} onClick={async () => { const r = await exec({ type: 'mobilize', unit: o.id, cities: [cityKey] }, `Mobilization queued: ${o.name}.`); if (r.ok) q.refresh(); }} data-testid={`mobilize-${o.id}`}>
            <Icon name="mobilize" size={16} /> Start
          </ActionButton>
        </td>
      </tr>
    );
  };
  return (
    <div className="col">
      {!coastal && (
        <p className="muted p-note" data-testid="no-naval-note">
          {MAP.cityByKey.get(cityKey)?.name ?? 'This city'} is not on the coast: ships and submarines cannot be mobilized here.
        </p>
      )}
      <label className="row p-toggle">
        <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
        Show units still locked by research
        {!showAll && hidden > 0 && <span className="muted">({hidden} hidden)</span>}
      </label>
      <table className="p-cat" data-testid="unit-catalog">
        <thead className="sr-only">
          <tr>
            <th>Unit</th>
            <th>Details</th>
            <th>Cost</th>
            <th>Time</th>
            <th>Order</th>
          </tr>
        </thead>
        {cls ? (
          <tbody>{list.map(row)}</tbody>
        ) : (
          groups.map((g) => (
            <tbody key={g.k.key}>
              <tr className="p-cat-group">
                <th colSpan={5} scope="colgroup">
                  <Icon name={g.k.icon} size={18} /> {g.k.label}
                </th>
              </tr>
              {g.items.map(row)}
            </tbody>
          ))
        )}
      </table>
      {list.length === 0 && <div className="empty">{inClass.length ? 'Every unit of this class is still locked by research. Tick the box above to see them.' : 'No unit of this class can be raised here.'}</div>}
    </div>
  );
}

export function Queue({ jobs, showCity }: { jobs: JobLike[]; showCity?: boolean }) {
  const frame = useFrame()!;
  const [refund, setRefund] = useState<{ id: string; text: string } | null>(null);
  if (!jobs.length) return <div className="empty">Nothing queued{showCity ? ' in any city' : ' here'}.</div>;
  const now = frame.view.tick;
  return (
    <>
      <table className="p-cat p-queue" data-testid="job-queue">
        <thead className="sr-only">
          <tr>
            <th>Job</th>
            <th>State</th>
            <th>Done</th>
            <th>Charged</th>
            <th>Cancel</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => {
            const total = j.endsAt && j.startedAt !== null ? Math.max(1, j.endsAt - j.startedAt) : 0;
            const pct = total && j.startedAt !== null ? (now - j.startedAt) / total : 0;
            const where = j.city ? MAP.cityByKey.get(j.city)?.name ?? j.city : j.node !== undefined ? placeName(j.node) : '';
            return (
              <tr key={j.id}>
                <td className="p-cat-art">
                  <JobArt j={j} size={48} />
                </td>
                <td className="p-cat-name">
                  <div className="row" style={{ gap: 6 }}>
                    {j.unit && <PlannedUnitSym unit={j.unit} />}
                    <strong>
                      {cap(j.kind)}: {j.unit ? `${unitById.get(j.unit)?.name} (planned)` : j.building ? `${buildingById.get(j.building)?.name} L${j.level ?? ''}` : jobName(j)}
                    </strong>
                  </div>
                  {showCity && where && <div className="muted p-small">{where}</div>}
                  <div className="p-small">{j.startedAt !== null ? <span className="p-pill ok">working</span> : j.reason ? <span className="p-pill bad">blocked: {j.reason}</span> : <span className="p-pill">queued</span>}</div>
                </td>
                <td className="p-cat-time">
                  {j.startedAt !== null && <Progress value={pct} tone="accent" label={`${Math.round(pct * 100)}% complete`} />}
                  <div className="p-small">{j.endsAt ? `${gameTime(j.endsAt)} (${duration(j.endsAt - now)})` : '—'}</div>
                </td>
                <td className="p-cat-cost">
                  <Cost cost={j.cost} />
                </td>
                <td className="p-cat-go">
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
            );
          })}
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
    <div className="col p-root">
      <div className="p-cityhead">
        <button type="button" className="btn small" onClick={() => ui.patch({ panelArg: null })}>
          <Icon name="chevron-left" size={14} /> All cities
        </button>
        <h3>{n.name} (rural province)</h3>
      </div>
      <div className="p-hero">
        <div className="p-hero-block">
          <span className="p-kicker">Deposit</span>
          <span className="row" style={{ gap: 6 }}>{n.deposit ? <Icon name={RESOURCE_ICON[n.deposit]} size={18} /> : null}{n.deposit ? RESOURCE_LABEL[n.deposit] : 'None'}</span>
        </div>
        <div className="p-hero-block">
          <span className="p-kicker">Terrain</span>
          <span>{TERRAIN_LABEL[n.terrain]}{n.coastal ? ' · coastal' : ''}</span>
        </div>
      </div>
      <p className="dim" style={{ margin: 0 }}>
        Terrain {TERRAIN_LABEL[n.terrain]} · deposit {n.deposit ? RESOURCE_LABEL[n.deposit] : 'none'} {n.coastal ? '· coastal' : ''}. Rural improvements that need a deposit produce nothing without one.
      </p>
      <BuildCatalog target={node} />
    </div>
  );
}
