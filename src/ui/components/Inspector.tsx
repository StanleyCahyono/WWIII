import React, { useState } from 'react';
import { useStore } from '../state/store';
import { ui, select, openPanel, centerOn, type Selection } from '../state/ui';
import { useFrame, useQuery, Sym, ActionButton, Modal, FlagChip, useIsMobile, PlannedUnitSym } from './common';
import { useObjects, objectToSelection } from '../map/MapView';
import { NODES, unitById, buildingById, countryName, placeName, TERRAIN_LABEL, RESOURCE_LABEL, cityByNode, techById } from '../data/static';
import { gameTime, duration, ageLabel, milli, num, signed, cap, dayOf, hourLabel } from '../format';
import { exec } from '../sim/exec';
import { cycle } from '../actions';
import { AttackDialog, PatrolDialog, RebaseDialog, DelayDialog, EmbarkDialog, RetreatDialog, LaunchDialog, DeployableDialog, AircraftPanel } from './Orders';
import type { StackView } from '../../engine/index';
import type { Frame } from '../sim/protocol';
import type { MapObject } from '../map/objects';
import { RESOURCES } from '../../engine/data-types';
import { Icon, UnitArt, familyIcon, type IconName } from '../icons';

export function Inspector({ mobile = false, dock = false }: { mobile?: boolean; dock?: boolean }) {
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
      if (dock) return <StackSheet s={s} o={o} frame={frame} layout="dock" />;
      title = s.name;
      sym = <Sym sidc={o.sidc} size={30} label={o.aria} />;
      body = <StackSheet s={s} o={o} frame={frame} layout={mobile ? 'sheet' : 'panel'} />;
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
    <div className="insp-panel" data-testid="inspector">
      <div className="head">
        {sym ?? <span className="insp-ico" aria-hidden><Icon name={sel?.kind === 'city' ? 'city' : sel?.kind === 'province' ? 'map' : sel?.kind === 'multi' ? 'forces' : 'target'} size={22} /></span>}
        <div className="grow">
          <div className="insp-kind">{sel?.kind === 'city' ? 'City' : sel?.kind === 'province' ? 'Province' : sel?.kind === 'contact' ? 'Contact' : sel?.kind === 'report' ? 'Dated report' : sel?.kind === 'multi' ? 'Multi-selection' : 'Inspector'}</div>
          <h2 data-testid="inspector-title">{title}</h2>
          <div className="muted" style={{ fontSize: 12 }}>As of {gameTime(frame.view.tick)}</div>
        </div>
        {sel && (
          <button type="button" className="round-btn sm" aria-label="Clear selection" title="Clear selection (Esc)" onClick={() => select(null)}>
            <Icon name="close" size={16} />
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

function airReason(s: StackView, okStates: string[]): string | null {
  const a = s.air;
  if (!a) return 'Not an aircraft formation.';
  if (a.grounded) return 'Grounded: the home airfield is disabled.';
  if (a.state === 'refueling') return `Refuelling until ${gameTime(a.refuelUntil ?? 0)}.`;
  if (!okStates.includes(a.state)) return a.state === 'on_station' ? 'Aircraft must be landed to rebase.' : 'Aircraft are in transit.';
  return null;
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

function stackPower(s: StackView): { atk: number; def: number } {
  let atk = 0;
  let def = 0;
  for (const u of s.units) {
    const ut = unitById.get(u.type);
    const st = ut?.levels[Math.min(ut.levels.length - 1, Math.max(0, u.level - 1))];
    if (!st) continue;
    const f = u.maxHp ? u.hp / u.maxHp : 1;
    atk += Math.max(0, ...Object.values(st.attack).map((x) => x ?? 0)) * f;
    def += Math.max(0, ...Object.values(st.defense).map((x) => x ?? 0)) * f;
  }
  return { atk: Math.round(atk), def: Math.round(def) };
}

function dominantFamily(s: StackView): string {
  const c = new Map<string, number>();
  for (const u of s.units) {
    const f = unitById.get(u.type)?.family ?? 'infantry';
    if (f === 'officer') continue;
    c.set(f, (c.get(f) ?? 0) + 1);
  }
  let best = 'infantry';
  let n = -1;
  for (const [f, k] of c) if (k > n) (best = f), (n = k);
  return best;
}

function Stat({ icon, label, value, sub, tone }: { icon: IconName; label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'ok' | 'warn' | 'bad' }) {
  return (
    <div className={`ustat${tone ? ' ' + tone : ''}`}>
      <Icon name={icon} size={15} />
      <span className="ustat-l">{label}</span>
      <span className="ustat-v">{value}</span>
      {sub && <span className="ustat-s">{sub}</span>}
    </div>
  );
}

export function StackSheet({ s, o, frame, layout = 'panel' }: { s: StackView; o: MapObject; frame: Frame; layout?: 'dock' | 'sheet' | 'panel' }) {
  const [split, setSplit] = useState(false);
  const [dlg, setDlg] = useState<null | 'attack' | 'patrol' | 'rebase' | 'delay' | 'embark' | 'retreat' | 'launch'>(null);
  const [deploy, setDeploy] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const isAir = s.moveClass === 'air' && !!s.air;
  const deployables = s.units.filter((u) => !!unitById.get(u.type)?.deployable);
  const canLaunch = s.units.some((u) => ['missile_launcher', 'naval', 'heavy', 'submarine'].includes(unitById.get(u.type)?.family ?? '')) && Object.values(frame.view.self.missiles).some((m) => m.ready > 0);
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
  const power = stackPower(s);
  const fam = dominantFamily(s);
  const hpPct = Math.round(frac * 100);
  const position = node !== null ? placeName(node) : s.pos.kind === 'edge' ? `${placeName(s.pos.from)} → ${placeName(s.pos.to)}` : 'Airborne';
  const domainWord = o.domain === 'land' ? 'ground' : o.domain === 'sea' ? 'surface' : o.domain;
  const RO = ro ? 'Read-only campaign' : null;

  const primary = (
    <>
      {!isAir && (
        <ActionButton className="btn primary act" disabledReason={RO} onClick={() => ui.patch({ mode: { kind: 'move', stacks: [s.id], waypoints: [], dest: null } })} data-testid="action-move">
          <Icon name="move" size={20} />
          Move…
        </ActionButton>
      )}
      {!isAir && (
        <ActionButton className="btn act danger-soft" disabledReason={RO ?? (s.pos.kind === 'air' ? 'Airborne.' : null)} onClick={() => setDlg('attack')} data-testid="action-attack">
          <Icon name="attack" size={20} />
          Attack…
        </ActionButton>
      )}
      {isAir && (
        <ActionButton className="btn primary act" disabledReason={RO ?? airReason(s, ['landed', 'on_station'])} onClick={() => setDlg('patrol')} data-testid="action-patrol">
          <Icon name="patrol" size={20} />
          Patrol…
        </ActionButton>
      )}
      {isAir && (
        <ActionButton className="btn act" disabledReason={RO ?? airReason(s, ['landed'])} onClick={() => setDlg('rebase')} data-testid="action-rebase">
          <Icon name="rebase" size={20} />
          Rebase / ferry…
        </ActionButton>
      )}
      <ActionButton className="btn act" disabledReason={RO ?? (!order && !(isAir && s.air?.state === 'on_station') ? 'No active order to stop.' : null)} onClick={() => exec({ type: 'stop', stack: s.id }, `${s.name}: orders cancelled.`)} data-testid="action-stop">
        <Icon name="stop" size={20} />
        {isAir && s.air?.state === 'on_station' ? 'Return to base' : 'Stop'}
      </ActionButton>
      {!isAir && (
        <ActionButton className="btn act" disabledReason={RO ?? (!order ? 'No active order to delay.' : null)} onClick={() => setDlg('delay')} data-testid="action-delay">
          <Icon name="delay" size={20} />
          Delay…
        </ActionButton>
      )}
      {s.moveClass === 'ground' && (
        <ActionButton className="btn act" disabledReason={RO ?? (s.pos.kind !== 'node' ? 'Only from a province or sea zone.' : node !== null && NODES[node].kind === 'land' && !NODES[node].coastal ? 'Embarking requires a coastal province.' : null)} onClick={() => setDlg('embark')} data-testid="action-embark">
          <Icon name={node !== null && NODES[node].kind === 'sea' ? 'disembark' : 'embark'} size={20} />
          {node !== null && NODES[node].kind === 'sea' ? 'Disembark…' : 'Embark…'}
        </ActionButton>
      )}
      {!isAir && (
        <ActionButton className="btn act" disabledReason={RO ?? (s.pos.kind !== 'node' ? 'Retreat is possible only while engaged at a province.' : null)} onClick={() => setDlg('retreat')} data-testid="action-retreat">
          <Icon name="retreat" size={20} />
          Retreat…
        </ActionButton>
      )}
      {canLaunch && (
        <ActionButton className="btn act" disabledReason={RO} onClick={() => setDlg('launch')} data-testid="action-launch">
          <Icon name="launch" size={20} />
          Launch missile…
        </ActionButton>
      )}
    </>
  );
  const secondary = (
    <>
      <ActionButton className="btn act" disabledReason={RO ?? (s.units.length < 2 ? 'A single unit cannot be split.' : s.pos.kind !== 'node' ? 'Split only at a province or sea zone.' : null)} onClick={() => setSplit(true)}>
        <Icon name="split" size={18} />
        Split…
      </ActionButton>
      <ActionButton className="btn act" disabledReason={RO ?? (colocated.length === 0 ? 'No other friendly formation of the same domain here.' : null)} onClick={() => exec({ type: 'merge', stacks: [s.id, ...colocated.map((c) => c.id)] }, `Merged ${colocated.length + 1} formations.`)}>
        <Icon name="merge" size={18} />
        Merge here ({colocated.length})
      </ActionButton>
      <ActionButton className="btn act" disabledReason={RO} onClick={() => exec({ type: 'setRefit', stack: s.id, refit: !s.refit }, s.refit ? 'Refit ended.' : 'Refit started.')}>
        <Icon name="build" size={18} />
        {s.refit ? 'End refit' : 'Refit'}
      </ActionButton>
    </>
  );

  const stats = (
    <div className="ustats">
      <Stat icon="attack" label="ATK" value={power.atk} />
      <Stat icon="shield" label="DEF" value={power.def} />
      <Stat icon="speed" label="SPD" value={`${stackSpeed(s)}`} sub="km/h" />
      <Stat icon="hp" label="HP" value={`${hpPct}%`} tone={hpPct < 35 ? 'bad' : hpPct < 70 ? 'warn' : undefined} />
      <Stat icon="check" label="RDY" value={`${readiness}%`} tone={readiness < 70 ? 'warn' : undefined} />
      <Stat icon="forces" label="EFF" value={`${efficiency}%`} tone={efficiency < 100 ? 'warn' : undefined} />
    </div>
  );
  const hpBar = (
    <div className={`hpbar${hpPct < 35 ? ' bad' : hpPct < 70 ? ' warn' : ''}`} role="img" aria-label={`Strength ${hpPct}%`}>
      <span style={{ width: `${hpPct}%` }} />
    </div>
  );

  const details = (
    <dl className="kv">
      <dt>Position</dt>
      <dd data-testid="stack-position">{position}</dd>
      <dt>Terrain</dt>
      <dd>{node !== null ? TERRAIN_LABEL[NODES[node].terrain] : '—'}</dd>
      <dt>Strength (HP)</dt>
      <dd>{hpPct}%</dd>
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
  );

  const activity = (
    <div className="sect" data-testid="active-order">
      <h4>Present activity</h4>
      {order ? (
        <div className="card activity">
          {order.kind === 'move' ? (
            <>
              <div>
                <Icon name="move" size={15} /> Moving to <strong>{placeName(order.dest)}</strong>
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
            <div>
              <Icon name="attack" size={15} /> Attack order {order.targetNode !== null ? `on ${placeName(order.targetNode)}` : 'on a contact'}
            </div>
          )}
        </div>
      ) : (
        <p className="muted idle-line" style={{ margin: 0 }}>
          {s.air && s.air.state !== 'landed' ? `Air mission in progress (${s.air.state.replace('_', ' ')}) — see Aircraft below.` : `Holding position at ${position} — no orders.`}
        </p>
      )}
      {s.air && <AircraftPanel s={s} />}
    </div>
  );

  const units = (
    <div className="sect">
      <h4>Units ({s.units.length})</h4>
      <ul className="unit-list">
        {[...counts.entries()].map(([t, c]) => {
          const ut = unitById.get(t);
          const hp = Math.round((c.hp / Math.max(1, c.mx)) * 100);
          return (
            <li key={t}>
              <span className="ul-ico" aria-hidden>
                <Icon name={familyIcon(ut?.family)} size={20} />
              </span>
              <span className="ul-main">
                <button type="button" className="linkish" onClick={() => openPanel('dossier', { unit: t, stack: s.id })} aria-label={`Open dossier for ${ut?.name ?? t}`}>
                  {ut?.name ?? t}
                </button>
                <span className="ul-meta">
                  Level {c.lvl} · {hp}% HP · {Math.round(c.ready / c.n)}% ready
                </span>
                <span className={`mini-hp${hp < 35 ? ' bad' : hp < 70 ? ' warn' : ''}`} aria-hidden>
                  <span style={{ width: `${hp}%` }} />
                </span>
              </span>
              <span className="ul-n">×{c.n}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );

  const nav = v.stacks.length > 1 && (
    <div className="row nav-pair">
      <button type="button" className="btn small" onClick={() => cycle('stack', -1)} aria-label="Previous formation" title="Previous formation (←)">
        <Icon name="chevron-left" size={14} /> Prev
      </button>
      <button type="button" className="btn small" onClick={() => cycle('stack', 1)} aria-label="Next formation" title="Next formation (→)">
        Next <Icon name="chevron-right" size={14} />
      </button>
    </div>
  );

  const fire = (
    <label className="row fire-ctl" style={{ gap: 6, fontSize: 13 }}>
      Fire control
      <select value={s.firePolicy} disabled={ro} onChange={(e) => exec({ type: 'setFirePolicy', stack: s.id, policy: e.target.value as 'hold' | 'return_fire' | 'engage' })}>
        <option value="hold">Hold unless ordered</option>
        <option value="return_fire">Return fire</option>
        <option value="engage">Engage eligible contacts</option>
      </select>
    </label>
  );

  const deployCard = deployables.length > 0 && (
    <div className="card" data-testid="deployables">
      <strong>Deployables</strong>
      {deployables.map((u) => {
        const ut = unitById.get(u.type)!;
        const cd = u.cooldownUntil && u.cooldownUntil > v.tick ? u.cooldownUntil : null;
        return (
          <div key={u.id} className="row wrap" style={{ marginTop: 4 }}>
            <span className="grow">
              {ut.name} · {u.uses ?? 0} use(s) left{cd ? ` · cooldown until ${gameTime(cd)}` : ' · ready'}
            </span>
            <ActionButton className="btn small" disabledReason={RO ?? ((u.uses ?? 0) <= 0 ? 'No uses remaining.' : cd ? `On cooldown until ${gameTime(cd)}.` : null)} onClick={() => setDeploy(u.id)}>
              Use…
            </ActionButton>
          </div>
        );
      })}
    </div>
  );

  const dialogs = (
    <>
      {split && <SplitDialog s={s} onClose={() => setSplit(false)} />}
      {dlg === 'attack' && <AttackDialog s={s} onClose={() => setDlg(null)} />}
      {dlg === 'patrol' && <PatrolDialog s={s} onClose={() => setDlg(null)} />}
      {dlg === 'rebase' && <RebaseDialog s={s} onClose={() => setDlg(null)} />}
      {dlg === 'delay' && <DelayDialog s={s} onClose={() => setDlg(null)} />}
      {dlg === 'embark' && <EmbarkDialog s={s} onClose={() => setDlg(null)} />}
      {dlg === 'retreat' && <RetreatDialog s={s} onClose={() => setDlg(null)} />}
      {dlg === 'launch' && <LaunchDialog onClose={() => setDlg(null)} />}
      {deploy && <DeployableDialog s={s} unitId={deploy} onClose={() => setDeploy(null)} />}
    </>
  );

  const owner = (
    <div className="u-owner">
      <FlagChip id={v.viewer} />
      <span>{v.self.name} · friendly {domainWord} formation</span>
    </div>
  );

  if (layout === 'dock') {
    return (
      <section className="unit-dock" aria-label="Selected formation" data-testid="inspector">
        <div className="ud-actions" role="toolbar" aria-label="Orders">
          {primary}
          {secondary}
        </div>
        <div className="ud-card">
          <div className="ud-artcol">
            <div className="ud-art">
              <UnitArt family={fam} size={150} />
              <span className="ud-sym">
                <Sym sidc={o.sidc} size={24} label={o.aria} />
              </span>
              <span className="ud-count">×{s.units.length}</span>
            </div>
            {nav}
          </div>
          <div className="ud-main">
            <div className="ud-head">
              <div className="grow" style={{ minWidth: 0 }}>
                <h2 data-testid="inspector-title" title={s.name}>{s.name}</h2>
                {owner}
              </div>
            </div>
            {hpBar}
            {stats}
            <div className="ud-pos">
              <Icon name="locate" size={14} /> {position}
              {node !== null && <span className="muted"> · {TERRAIN_LABEL[NODES[node].terrain]}</span>}
              <span className="muted"> · supply {s.supply}</span>
              {s.engagement && <span className="tag bad">In combat</span>}
              {s.refit && <span className="tag warn">Refitting</span>}
            </div>
            {fire}
            <details className="ud-more" open={more} onToggle={(e) => setMore((e.target as HTMLDetailsElement).open)}>
              <summary>Full details</summary>
              {details}
            </details>
            {deployCard}
          </div>
          <div className="ud-side">
            {activity}
            {units}
          </div>
          <button type="button" className="round-btn sm ud-close" aria-label="Clear selection" title="Clear selection (Esc)" onClick={() => select(null)}>
            <Icon name="close" size={16} />
          </button>
        </div>
        {dialogs}
      </section>
    );
  }

  return (
    <>
      <div className="sect unit-hero">
        <div className="uh-art">
          <UnitArt family={fam} size={96} />
          <span className="ud-count">×{s.units.length}</span>
        </div>
        <div className="grow" style={{ minWidth: 0 }}>
          {owner}
          {hpBar}
        </div>
      </div>
      {stats}
      <div className="sect">{details}</div>
      {activity}
      <div className="sect">
        <h4>Authorized actions</h4>
        <div className="actions">
          {primary}
          {secondary}
        </div>
        {nav}
        {deployCard}
        {fire}
      </div>
      {units}
      {dialogs}
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
          <LaunchAtSector node={c.node} frame={frame} />
        </div>
        <p className="muted" style={{ fontSize: 12 }}>To attack, select one of your formations and use Move… onto this contact's province; the engine checks visibility, war status and range.</p>
      </div>
    </>
  );
}

/** Missile launch shortcut targeting the sector of a contact/report. Opens the normal launch dialog
 *  (validated preview, outcomes, war confirmation); the sector is a public node id, never the hidden
 *  stack. Disabled with a reason when there is no ready inventory. */
function LaunchAtSector({ node, frame }: { node: number | null; frame: Frame }) {
  const [open, setOpen] = useState(false);
  if (node === null) return null;
  const ro = frame.meta.readOnly || frame.meta.reviewMode;
  const ready = Object.values(frame.view.self.missiles ?? {}).reduce((a, m) => a + (m?.ready ?? 0), 0);
  return (
    <>
      <ActionButton className="btn" disabledReason={ro ? 'Read-only campaign' : ready < 1 ? 'No ready missiles — research and produce a batch in Forces first.' : null} onClick={() => setOpen(true)} data-testid="contact-launch">
        Launch missile at this sector…
      </ActionButton>
      {open && <LaunchDialog target={node} onClose={() => setOpen(false)} />}
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
      <div className="actions">
        <LaunchAtSector node={s?.node ?? null} frame={frame} />
      </div>
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
                    {j.unit && <PlannedUnitSym unit={j.unit} size={16} />}
                    {j.unit ? `Planned: ${unitById.get(j.unit)?.name}` : j.building ? buildingById.get(j.building)?.name : cap(j.kind)} — {j.startedAt !== null ? `working, done ${j.endsAt ? gameTime(j.endsAt) : '—'}` : j.reason ? `blocked: ${j.reason}` : 'queued'}
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
  cycle('city', dir);
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
