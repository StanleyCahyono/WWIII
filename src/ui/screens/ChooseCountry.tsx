import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ui } from '../state/ui';
import { getHost } from '../sim/host';
import { MANIFEST, REGION_ORDER, REGION_COUNTS, NODES, loadGeometry, countryName, RESOURCE_LABEL, MAP } from '../data/static';
import type { CountryPreview, ScenarioSummary } from '../sim/protocol';
import { MapRenderer, type MapInput } from '../map/renderer';
import { screenToWorld } from '../map/projection';
import { prefs } from '../persist/prefs';
import { startNewCampaign } from '../session';
import { FlagChip, NationBadge } from '../components/common';
import { Icon, RESOURCE_ICON } from '../icons';
import { num, cap } from '../format';
import { RESOURCES } from '../../engine/data-types';

const FEATURED = 'IDN';

type SizeClass = 'Large' | 'Medium' | 'Small';
function sizeClass(p: CountryPreview | null | undefined): SizeClass | null {
  if (!p) return null;
  const rank = p.power?.rank;
  if (rank !== undefined) return rank <= 20 ? 'Large' : rank <= 60 ? 'Medium' : 'Small';
  return p.provinces >= 40 ? 'Large' : p.provinces >= 12 ? 'Medium' : 'Small';
}

export function ChooseCountry() {
  const [data, setData] = useState<{ summary: ScenarioSummary; previews: CountryPreview[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [region, setRegion] = useState<string | null>(null);
  const [sel, setSel] = useState<string>(FEATURED);
  const [difficulty, setDifficulty] = useState<'easy' | 'normal' | 'hard'>('normal');
  const [seed, setSeed] = useState<number>(() => Math.floor(Math.random() * 1e9));
  const [busy, setBusy] = useState(false);
  const [startErr, setStartErr] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getHost()
      .previews()
      .then(setData)
      .catch((e: Error) => setErr(e.message));
  }, []);

  const byId = useMemo(() => new Map((data?.previews ?? []).map((p) => [p.id, p])), [data]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return MANIFEST.filter((m) => (!region || m.region === region) && (!s || m.name.toLowerCase().includes(s) || m.id.toLowerCase().includes(s))).slice().sort((a, b) => (a.id === FEATURED ? -1 : b.id === FEATURED ? 1 : a.name.localeCompare(b.name)));
  }, [q, region]);
  const preview = byId.get(sel) ?? null;

  // keep the chosen nation visible in the list (map click, random pick)
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-testid="country-${sel}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const randomNation = () => {
    const pool = list.length ? list : MANIFEST;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick) setSel(pick.id);
  };

  const start = async () => {
    setBusy(true);
    setStartErr(null);
    try {
      await startNewCampaign(sel, seed, difficulty);
    } catch (e) {
      setStartErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="choose" aria-labelledby="choose-title">
      <div className="ch-head">
        <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true" style={{ color: 'var(--text-2)' }}>
          <path d="M12 1.5 21.5 7v10L12 22.5 2.5 17V7z" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M7 9l2.5 7L12 10l2.5 6L17 9" fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
        <h1 id="choose-title">Choose your country</h1>
        <span className="muted desktop-only">World 120 · one human seat, 119 computer countries</span>
        <div className="ch-steps" aria-hidden="true">
          <span className="ch-step on">1 · Nation</span>
          <span className="ch-step">2 · Briefing</span>
          <span className="ch-step">3 · Command</span>
        </div>
      </div>
      <section className="ch-list" aria-label="Country list">
        <div className="ch-list-head">
          <h4>Select nation</h4>
          <div className="ch-search">
            <Icon name="search" size={16} />
            <label className="sr-only" htmlFor="country-search">Search countries</label>
            <input id="country-search" type="search" placeholder="Search 120 countries…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="country-search" />
          </div>
          <div className="region-filters" role="group" aria-label="Region filter">
            <button type="button" aria-pressed={region === null} onClick={() => setRegion(null)}>
              All · 120
            </button>
            {REGION_ORDER.map((r) => (
              <button key={r} type="button" aria-pressed={region === r} onClick={() => setRegion(region === r ? null : r)}>
                {r} · {REGION_COUNTS[r]}
              </button>
            ))}
          </div>
        </div>
        <div role="listbox" aria-label="Countries" style={{ overflowY: 'auto', flex: 1 }} tabIndex={-1} ref={listRef}>
          {list.length === 0 && <div className="empty" style={{ margin: 10 }}>No country matches “{q}”.</div>}
          {list.map((m) => {
            const sz = sizeClass(byId.get(m.id));
            return (
              <button
                key={m.id}
                type="button"
                role="option"
                aria-selected={sel === m.id}
                className={`country-row${m.id === FEATURED ? ' featured' : ''}`}
                onClick={() => setSel(m.id)}
                data-testid={`country-${m.id}`}
              >
                <FlagChip id={m.id} size={34} />
                <span className="grow">
                  <span className="cr-name">
                    {m.name}
                    {m.id === FEATURED && <span className="tag accent" style={{ marginLeft: 6 }}>Suggested start</span>}
                  </span>
                  <span className="cr-meta">{m.region.split(',')[0]}</span>
                </span>
                {sz && <span className={`size-pill ${sz[0]}`}>{sz}</span>}
              </button>
            );
          })}
        </div>
      </section>
      <section className="ch-map" aria-label="World map (click a country to preview it)">
        <ChooseMap selected={sel} onPick={setSel} />
      </section>
      <section className="ch-prev" aria-label="Country preview" data-testid="country-preview">
        <div className="ch-prev-scroll">
          {err && <p className="bad" role="alert">Could not prepare previews: {err}</p>}
          {!data && !err && <p className="muted" role="status" style={{ marginTop: 14 }}>Preparing the opening positions of all 120 countries…</p>}
          {preview && <Preview p={preview} summary={data!.summary} />}
        </div>
        <div className="ch-foot">
          <div className="row wrap" style={{ justifyContent: 'space-between' }}>
            <fieldset style={{ border: 0, padding: 0 }}>
              <legend>Difficulty — computer planning effort</legend>
              <div className="seg">
                {(['easy', 'normal', 'hard'] as const).map((d) => (
                  <label key={d}>
                    <input type="radio" name="difficulty" checked={difficulty === d} onChange={() => setDifficulty(d)} />
                    {cap(d)}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="field" style={{ width: 150 }} title="Varies diplomatic personalities, market activity and event draws">
              Seed
              <div className="row" style={{ gap: 4 }}>
                <input type="number" value={seed} onChange={(e) => setSeed(Math.max(0, Math.floor(Number(e.target.value) || 0)))} style={{ flex: 1, minWidth: 0 }} data-testid="seed-input" aria-label="Seed (varies diplomatic personalities, market activity and event draws)" />
                <button type="button" className="btn icon" onClick={() => setSeed(Math.floor(Math.random() * 1e9))} aria-label="New random seed" title="New random seed">
                  <Icon name="dice" size={18} />
                </button>
              </div>
            </label>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 11.5 }}>Difficulty sets how much planning each of the 119 computer countries does per review. It never changes the roster, starting assets or resources.</p>
          <div className="ch-actions">
            <button type="button" className="btn" onClick={() => ui.patch({ screen: 'title' })} aria-label="Back to title screen">
              <Icon name="back" size={16} /> Back
            </button>
            <button type="button" className="btn" onClick={randomNation} title="Pick a random nation from the list">
              <Icon name="dice" size={16} /> Random nation
            </button>
            <button type="button" className="btn primary" onClick={start} disabled={busy || !data} data-testid="start-campaign">
              {busy ? 'Creating the world…' : `Start as ${countryName(sel)}`}
              {!busy && <Icon name="chevron-right" size={18} />}
            </button>
          </div>
          {startErr && <p className="bad" role="alert">{startErr}</p>}
        </div>
      </section>
    </main>
  );
}

function Preview({ p, summary }: { p: CountryPreview; summary: ScenarioSummary }) {
  const ports = p.cities.filter((c) => c.port).length;
  const sz = sizeClass(p);
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="sel-banner">
        <span className="sel-kicker">Selected nation</span>
        <div className="sel-title">
          <NationBadge id={p.id} size={64} />
          <h2>{p.name}</h2>
        </div>
        <div className="sel-tags">
          {sz && <span className={`size-pill ${sz[0]}`}>{sz} nation</span>}
          <span className={`tag ${p.startDifficulty === 'easy' ? 'ok' : p.startDifficulty === 'hard' ? 'bad' : 'warn'}`}>{cap(p.startDifficulty)} start</span>
          <span className="size-pill">{cap(p.doctrine)} doctrine</span>
        </div>
        <p className="dim" style={{ margin: 0, fontSize: 13 }}>{p.summary}</p>
      </div>
      {p.synthesized && <p className="warn" style={{ margin: 0, fontSize: 12 }}>Profile synthesized from map data (authored profile pending).</p>}
      <dl className="kv">
        <dt>Capital</dt>
        <dd data-testid="preview-capital">{p.capital?.name ?? '—'}</dd>
        <dt>Doctrine</dt>
        <dd style={{ textTransform: 'capitalize' }}>{p.doctrine}</dd>
        <dt>Region</dt>
        <dd>{p.region}</dd>
        <dt>Provinces / cities</dt>
        <dd>
          {p.provinces} / {p.cities.length} ({ports} ports)
        </dd>
        <dt>Coastline</dt>
        <dd>{p.landlocked ? 'Landlocked' : p.coastal ? 'Coastal' : '—'}</dd>
        <dt>Neighbours (land)</dt>
        <dd>{p.neighbours.length ? p.neighbours.map(countryName).join(', ') : 'None by land'}</dd>
        <dt>Formations</dt>
        <dd>{p.formations}</dd>
      </dl>
      <div>
        <h4>Starting cities</h4>
        <p style={{ margin: '4px 0 0', fontSize: 13 }}>
          {p.cities.slice(0, 14).map((c, i) => (
            <span key={c.key}>
              {i ? ', ' : ''}
              {c.capital ? <strong>{c.name}</strong> : c.name}
              {c.port ? ' ⚓' : ''}
            </span>
          ))}
          {p.cities.length > 14 ? ` and ${p.cities.length - 14} more` : ''}
        </p>
      </div>
      <div>
        <h4>Resources — stockpile · daily output</h4>
        <table className="data res-table" style={{ marginTop: 4 }}>
          <tbody>
            {RESOURCES.map((r) => (
              <tr key={r}>
                <td>
                  <Icon name={RESOURCE_ICON[r]} size={18} />
                  {RESOURCE_LABEL[r]}
                </td>
                <td className="num">{num(p.stockpile[r] ?? 0)}</td>
                <td className="num ok">+{num(p.dailyOutput[r] ?? 0)}/day</td>
              </tr>
            ))}
          </tbody>
        </table>
        {p.tradeNeeds.length > 0 && <p className="muted" style={{ fontSize: 12 }}>Trade needs: {p.tradeNeeds.map((r) => RESOURCE_LABEL[r as keyof typeof RESOURCE_LABEL] ?? r).join(', ')}</p>}
      </div>
      {p.power && (
        <div>
          <h4>Opening power (engine)</h4>
          <p style={{ margin: '4px 0' }}>
            Composite <strong>{p.power.composite.toFixed(1)}</strong> · rank {p.power.rank} of {summary.seats.length}
            {summary.powerMeta ? ` · leader ${countryName(summary.powerMeta.leader)}` : ''}
          </p>
          <table className="data">
            <tbody>
              {Object.entries(p.power.raw).map(([k, v]) => (
                <tr key={k}>
                  <td style={{ textTransform: 'capitalize' }}>{k}</td>
                  <td className="num">{num(v, 1)}</td>
                  <td className="num muted">weight {summary.powerMeta ? Math.round((summary.powerMeta.weights[k] ?? 0) * 100) : '—'}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!p.power && summary.previewError && <p className="muted" style={{ fontSize: 12 }}>Opening power not available: {summary.previewError}</p>}
      {p.openingDecisions.length > 0 && (
        <div>
          <h4>Opening decisions</h4>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {p.openingDecisions.map((d) => (
              <li key={d.id}>
                <strong>{d.title}</strong> — {d.detail}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <h4>Difficulty factors</h4>
        <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 13 }}>
          <li>{p.landlocked ? 'Landlocked: no naval orders; trade and access through neighbours matter.' : ports > 3 ? `Distributed ports (${ports}): sea lift and naval escort decide inter-island logistics.` : 'Coastal: limited port network.'}</li>
          <li>{p.neighbours.length > 4 ? `${p.neighbours.length} land neighbours: exposed borders.` : p.neighbours.length === 0 ? 'No land neighbours: invasions must come by sea or air.' : `${p.neighbours.length} land neighbour(s).`}</li>
          <li>Opening power rank {p.power?.rank ?? '—'} of 120.</li>
        </ul>
      </div>
      <div className="card">
        <h4>Victory rule</h4>
        <p style={{ margin: '4px 0 0', fontSize: 13 }}>
          Territorial points: province centre 1, city +2…6 by fixed tier, capital +4. Solo victory at <strong>{summary.soloThreshold ?? '—'}</strong> of {summary.denominator ?? '—'} points (24%); coalitions need{' '}
          {summary.coalitionThresholds ? Object.entries(summary.coalitionThresholds).map(([k, v]) => `${v} for ${k}`).join(', ') : '40–60%'}. Settled at each day change; at day 180 the highest fraction of its threshold wins.
        </p>
      </div>
    </div>
  );
}

function ChooseMap({ selected, onPick }: { selected: string; onPick: (id: string) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const r = useRef<MapRenderer | null>(null);
  useEffect(() => {
    const rr = new MapRenderer(canvas.current!, { ...prefs.get().map, fill: 'political', routes: false, symbols: false, sensors: false });
    r.current = rr;
    rr.setTheme(prefs.get().theme);
    const ro = new ResizeObserver(() => {
      const b = wrap.current!.getBoundingClientRect();
      rr.resize(b.width, b.height, window.devicePixelRatio);
    });
    ro.observe(wrap.current!);
    rr.cam = { cx: 30, cy: -20, z: 3 };
    void loadGeometry().then((g) => rr.setGeometry(g));
    return () => {
      ro.disconnect();
      rr.destroy();
    };
  }, []);
  useEffect(() => {
    const rr = r.current;
    if (!rr) return;
    const owners = NODES.map((n) => n.country ?? null);
    const input: MapInput = {
      owners,
      me: selected,
      relation: (o) => (o === selected ? 'self' : 'peace'),
      morale: new Map(),
      rebel: new Set(),
      objects: [],
      cityOwners: new Map(),
      capitals: new Set(),
      routes: [],
      drawings: [],
      draft: null,
      selected: new Set(),
      selectedNode: null,
      pinned: new Set(),
      sensors: [],
      observedNodes: new Set(),
      previewMarker: null,
      alertIds: new Set(),
    };
    rr.setInput(input, true);
    const mc = MAP.countryById.get(selected);
    if (mc) rr.center(mc.labelAt[0], mc.labelAt[1], Math.max(rr.cam.z, 3.5));
  }, [selected]);
  const down = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const countryAt = (clientX: number, clientY: number): string | null => {
    const rr = r.current;
    if (!rr) return null;
    const b = canvas.current!.getBoundingClientRect();
    const h = rr.hitAt(clientX - b.left, clientY - b.top);
    if (h?.kind === 'small' && h.ids[0]) return h.ids[0];
    const [lon, lat] = screenToWorld(rr.cam, rr.w, rr.h, clientX - b.left, clientY - b.top);
    const n = rr.nodeAt(lon, lat);
    const c = n !== null ? NODES[n].country : null;
    return c && MANIFEST.some((m) => m.id === c) ? c : null;
  };
  return (
    <div ref={wrap} style={{ position: 'absolute', inset: 0, cursor: hover ? 'pointer' : 'grab' }} className="mapwrap" onPointerLeave={() => setHover(null)}>
      <canvas
        ref={canvas}
        aria-hidden
        onPointerDown={(e) => {
          down.current = { x: e.clientX, y: e.clientY, moved: false };
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = down.current;
          if (!d) {
            const id = countryAt(e.clientX, e.clientY);
            const b = wrap.current!.getBoundingClientRect();
            setHover(id ? { id, x: e.clientX - b.left, y: e.clientY - b.top } : null);
            return;
          }
          if (!r.current) return;
          const dx = e.clientX - d.x, dy = e.clientY - d.y;
          if (!d.moved && Math.hypot(dx, dy) > 5) d.moved = true;
          if (d.moved) {
            r.current.panBy(dx, dy);
            d.x = e.clientX;
            d.y = e.clientY;
          }
        }}
        onPointerUp={(e) => {
          const d = down.current;
          down.current = null;
          const rr = r.current;
          if (!d || d.moved || !rr) return;
          const c = countryAt(e.clientX, e.clientY);
          if (c) onPick(c);
        }}
        onWheel={(e) => {
          const rr = r.current;
          if (!rr) return;
          const b = canvas.current!.getBoundingClientRect();
          rr.zoomAt(Math.exp(-e.deltaY * 0.0016), e.clientX - b.left, e.clientY - b.top);
        }}
      />
      {hover && (
        <div className="map-hover" style={{ left: Math.min(hover.x + 16, (r.current?.w ?? 600) - 220), top: hover.y + 16 }} aria-hidden="true">
          <NationBadge id={hover.id} size={26} />
          {countryName(hover.id)}
        </div>
      )}
      <div className="ch-hint">Hover to identify · click a country to select it · drag to pan</div>
      <div className="map-tools">
        <button type="button" className="round-btn" aria-label="Zoom in" onClick={() => r.current?.zoomAt(1.5, r.current.w / 2, r.current.h / 2)}>
          <Icon name="plus" />
        </button>
        <button type="button" className="round-btn" aria-label="Zoom out" onClick={() => r.current?.zoomAt(1 / 1.5, r.current.w / 2, r.current.h / 2)}>
          <Icon name="minus" />
        </button>
      </div>
      <div className="scalebar">Selected: {countryName(selected)} · Indonesia is the suggested start</div>
    </div>
  );
}
