import React, { useState } from 'react';
import { useFrame, Sym, ActionButton, useIsMobile } from '../components/common';
import { useObjects } from '../map/MapView';
import { select, centerOn, openPanel, backPanel, ui } from '../state/ui';
import { unitById, placeName, missileById, techById, TERRAIN_LABEL, buildingById } from '../data/static';
import { num, resM, duration, cap, gameTime } from '../format';
import { MissileProgramTable } from '../components/Orders';
import { AirmobileDialog, airLiftActivity, hasAirLift, inAirLift } from '../components/Features';
import { TARGET_CLASSES, TERRAINS } from '../../engine/data-types';

interface Force { fielded: number; ready: number; committed: number; inRefit: number; units: number; stacks: number; maintenanceUsed: number; maintenanceCapacity: number; byDomain: Record<string, { units: number; fielded: number; ready: number }> }

export function ForcesPanel() {
  const frame = useFrame()!;
  const objects = useObjects();
  const f = frame.view.self.force as Force;
  const ro = frame.meta.readOnly || frame.meta.reviewMode;
  const stacks = frame.view.stacks;
  const missiles = Object.entries(frame.view.self.missiles);
  const [lift, setLift] = useState<string | null>(null);
  const liftStack = lift ? stacks.find((x) => x.id === lift) : undefined;
  return (
    <div className="col" data-testid="forces-panel">
      <div className="row wrap" style={{ gap: 12 }}>
        <div className="card">
          <h4>Fielded strength</h4>
          <div style={{ fontSize: 20 }}>{num(f.fielded)}</div>
          <div className="muted" style={{ fontSize: 12 }}>replacement value × health, all formations</div>
        </div>
        <div className="card">
          <h4>Ready strength</h4>
          <div style={{ fontSize: 20 }}>{num(f.ready)}</div>
          <div className="muted" style={{ fontSize: 12 }}>readiness ≥ 70%, not refitting</div>
        </div>
        <div className="card">
          <h4>Committed</h4>
          <div style={{ fontSize: 20 }}>{num(f.committed)}</div>
          <div className="muted" style={{ fontSize: 12 }}>moving, attacking or in combat</div>
        </div>
        <div className="card">
          <h4>Maintenance</h4>
          <div style={{ fontSize: 20 }}>
            {f.maintenanceUsed}/{f.maintenanceCapacity}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>{num(f.inRefit)} strength in refit</div>
        </div>
      </div>
      <table className="data" aria-label="Strength by domain">
        <thead>
          <tr>
            <th>Domain</th>
            <th className="num">Units</th>
            <th className="num">Fielded</th>
            <th className="num">Ready</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(f.byDomain).map(([d, x]) => (
            <tr key={d}>
              <td style={{ textTransform: 'capitalize' }}>{d}</td>
              <td className="num">{x.units}</td>
              <td className="num">{num(x.fielded)}</td>
              <td className="num">{num(x.ready)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Formations ({stacks.length})</h3>
      {stacks.length === 0 ? (
        <div className="empty">No formations. Mobilize units from a homeland or annexed city.</div>
      ) : (
        <table className="data" data-testid="formations-table">
          <thead>
            <tr>
              <th>Formation</th>
              <th className="num">Units</th>
              <th>Location</th>
              <th className="num">Readiness</th>
              <th>Activity</th>
              <th>Supply</th>
              <th>Orders</th>
            </tr>
          </thead>
          <tbody>
            {stacks.map((s) => {
              const o = objects.find((x) => x.id === `S:${s.id}`);
              const rd = s.units.length ? Math.round(s.units.reduce((a, u) => a + u.readiness, 0) / s.units.length) : 0;
              return (
                <tr key={s.id}>
                  <td>
                    <button type="button" className="btn ghost small" style={{ padding: 0, minHeight: 0, gap: 6 }} onClick={() => { select({ kind: 'stack', id: s.id }); centerOn(s.lonlat[0], s.lonlat[1]); ui.patch({ panel: null }); }} aria-label={o?.aria ?? s.name} data-testid={`formation-${s.id}`}>
                      {o && <Sym sidc={o.sidc} size={18} />} {s.name}
                    </button>
                  </td>
                  <td className="num">{s.units.length}</td>
                  <td>{s.pos.kind === 'node' ? placeName(s.pos.node) : s.pos.kind === 'edge' ? `→ ${placeName(s.pos.to)}` : 'airborne'}</td>
                  <td className="num">{rd}%</td>
                  <td>{inAirLift(s) ? airLiftActivity(s) : s.order ? (s.order.kind === 'move' ? `Moving to ${placeName(s.order.dest)}${s.eta ? `, ETA ${gameTime(s.eta)}` : ''}` : 'Attacking') : s.refit ? 'Refitting' : 'Holding'}</td>
                  <td>{cap(s.supply)}</td>
                  <td>
                    {hasAirLift(s) && (
                      <ActionButton className="btn small" disabledReason={ro ? 'Read-only campaign' : inAirLift(s) ? 'Already airborne.' : s.pos.kind !== 'node' ? 'Must be stationary at a province.' : null} onClick={() => setLift(s.id)} data-testid={`airmobile-${s.id}`}>
                      Air assault…
                    </ActionButton>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {liftStack && <AirmobileDialog s={liftStack} onClose={() => setLift(null)} />}
      <h3>Strategic inventory</h3>
      <MissileProgramTable />
    </div>
  );
}

export function UnitDossier({ arg }: { arg: { unit: string; stack?: string } }) {
  const frame = useFrame()!;
  const isMobile = useIsMobile();
  const ut = unitById.get(arg?.unit);
  const [lvl, setLvl] = useState<number>(() => frame.view.self.unitLevels[arg?.unit] ?? 1);
  const [axis, setAxis] = useState<string>('unarmored');
  const [terr, setTerr] = useState<string>('open');
  if (!ut) return <p className="bad">Unknown unit.</p>;
  const stack = arg.stack ? frame.view.stacks.find((s) => s.id === arg.stack) : undefined;
  const deployed = stack?.units.filter((u) => u.type === ut.id) ?? [];
  const st = ut.levels.find((l) => l.level === lvl) ?? ut.levels[0];
  const readiness = deployed.length ? deployed.reduce((a, u) => a + u.readiness, 0) / deployed.length : null;
  const effMult = readiness !== null ? 0.5 + 0.5 * (readiness / 100) : null;
  const cell = (v: number | undefined, unit = '') => (v === undefined || v === 0 ? <span aria-label="not available" className="muted">n/a</span> : `${num(v, 1)}${unit}`);
  const lockedBy = ut.unlockTech ? techById.get(ut.unlockTech)?.name : null;
  return (
    <div className="col" data-testid="unit-dossier">
      <div className="row wrap">
        <button type="button" className="btn small" onClick={backPanel}>
          ← Previous screen
        </button>
        <h3>{ut.name}</h3>
        <span className="tag">{cap(ut.family)}</span>
        <span className="tag">{ut.domain}</span>
        <span className="tag">target class: {ut.targetClass}</span>
      </div>
      <p className="dim" style={{ margin: 0 }}>{ut.description}</p>
      <div className="row wrap">
        <label className="row" style={{ gap: 6 }}>
          Level
          <select value={lvl} onChange={(e) => setLvl(Number(e.target.value))}>
            {ut.levels.map((l) => (
              <option key={l.level} value={l.level}>
                {l.level}
                {l.level === (frame.view.self.unitLevels[ut.id] ?? 0) ? ' (yours)' : ''}
              </option>
            ))}
          </select>
        </label>
        <span className="muted">Base stats for the catalog item{effMult !== null ? `; effective column applies this formation's readiness (${Math.round(readiness!)}%)` : ''}.</span>
      </div>
      <dl className="kv card">
        <dt>Hit points</dt>
        <dd>{deployed.length ? `${Math.round(deployed.reduce((a, u) => a + u.hp, 0) / 100)} / ${Math.round(deployed.reduce((a, u) => a + u.maxHp, 0) / 100)} (deployed ×${deployed.length})` : `${st.hp} max`}</dd>
        <dt>Kills</dt>
        <dd>{deployed.length ? deployed.reduce((a, u) => a + u.kills, 0) : '—'}</dd>
        <dt>Speed</dt>
        <dd>{st.speedKmh} km/h</dd>
        <dt>Combat range</dt>
        <dd>{st.rangeKm ? `${st.rangeKm} km` : 'Contact (same location)'}</dd>
        <dt>Sight</dt>
        <dd>{st.sightKm} km</dd>
        <dt>Radar</dt>
        <dd>{st.radarKm ? `${st.radarKm} km, detects ${(st.radarDetects ?? []).join(', ')} (sensitivity ${st.radarSensitivity ?? 0})` : 'None'}</dd>
        <dt>Signature (stealth)</dt>
        <dd>{st.signature} of 3</dd>
        {st.enduranceMin ? (
          <>
            <dt>Endurance</dt>
            <dd>{duration(st.enduranceMin)}</dd>
          </>
        ) : null}
        <dt>Mobilization cost</dt>
        <dd style={{ fontSize: 12 }}>{resM(Object.fromEntries(Object.entries(ut.cost).map(([k, v]) => [k, (v ?? 0) * 1000])))}</dd>
        <dt>Upkeep</dt>
        <dd style={{ fontSize: 12 }}>{resM(Object.fromEntries(Object.entries(ut.upkeepPerDay).map(([k, v]) => [k, (v ?? 0) * 1000])))} per day</dd>
        <dt>Build time</dt>
        <dd>{ut.buildHours} h</dd>
        <dt>Requires</dt>
        <dd>{ut.requires.length ? ut.requires.map((r) => `${buildingById.get(r.building)?.name} L${r.level}`).join(', ') : 'No facility'}</dd>
        <dt>Unlocked by</dt>
        <dd>{lockedBy ? `${lockedBy}${frame.view.self.techs.includes(ut.unlockTech!) ? ' ✓' : ''}` : 'Available from start'}</dd>
        <dt>Captures territory</dt>
        <dd>{ut.capture ? 'Yes' : 'No'}</dd>
        <dt>Orders</dt>
        <dd>{ut.orders.join(', ')}</dd>
      </dl>
      {ut.features.length > 0 && (
        <div>
          <h4>Features</h4>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {ut.features.map((f) => (
              <li key={f.id} title={f.description}>
                <strong>{f.name}</strong> — {f.description}
              </li>
            ))}
          </ul>
        </div>
      )}
      <h4>Combat by target class (rating points)</h4>
      {isMobile ? (
        <div className="col">
          <label className="row" style={{ gap: 6 }}>
            Target class
            <select value={axis} onChange={(e) => setAxis(e.target.value)}>
              {TARGET_CLASSES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <dl className="kv card">
            <dt>Attack</dt>
            <dd>{cell(st.attack[axis as keyof typeof st.attack])}</dd>
            <dt>Defense</dt>
            <dd>{cell(st.defense[axis as keyof typeof st.defense])}</dd>
            {effMult !== null && (
              <>
                <dt>Effective attack</dt>
                <dd>{cell((st.attack[axis as keyof typeof st.attack] ?? 0) * effMult)}</dd>
              </>
            )}
          </dl>
        </div>
      ) : (
        <table className="data" data-testid="combat-table">
          <thead>
            <tr>
              <th />
              {TARGET_CLASSES.map((t) => (
                <th key={t} className="num" style={{ textTransform: 'capitalize' }}>
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Attack</td>
              {TARGET_CLASSES.map((t) => (
                <td key={t} className="num">{cell(st.attack[t])}</td>
              ))}
            </tr>
            <tr>
              <td>Defense</td>
              {TARGET_CLASSES.map((t) => (
                <td key={t} className="num">{cell(st.defense[t])}</td>
              ))}
            </tr>
            {effMult !== null && (
              <tr>
                <td>Effective attack</td>
                {TARGET_CLASSES.map((t) => (
                  <td key={t} className="num">{cell((st.attack[t] ?? 0) * effMult)}</td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      )}
      <h4>Terrain modifiers (× multiplier; 1.00 = neutral)</h4>
      {isMobile ? (
        <div className="col">
          <label className="row" style={{ gap: 6 }}>
            Terrain
            <select value={terr} onChange={(e) => setTerr(e.target.value)}>
              {TERRAINS.map((t) => (
                <option key={t} value={t}>
                  {TERRAIN_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <dl className="kv card">
            {(['attack', 'defense', 'speed', 'sight'] as const).map((k) => (
              <React.Fragment key={k}>
                <dt style={{ textTransform: 'capitalize' }}>{k}</dt>
                <dd>×{(ut.terrain[terr as keyof typeof ut.terrain]?.[k] ?? 1).toFixed(2)}</dd>
              </React.Fragment>
            ))}
          </dl>
        </div>
      ) : (
        <table className="data" data-testid="terrain-table">
          <thead>
            <tr>
              <th>Terrain</th>
              <th className="num">Attack</th>
              <th className="num">Defense</th>
              <th className="num">Speed</th>
              <th className="num">Sight</th>
            </tr>
          </thead>
          <tbody>
            {TERRAINS.filter((t) => (ut.domain === 'sea' || ut.domain === 'subsurface' ? t === 'high_seas' || t === 'coastal_waters' : ut.domain === 'land' ? t !== 'high_seas' && t !== 'coastal_waters' : true)).map((t) => {
              const m = ut.terrain[t];
              return (
                <tr key={t}>
                  <td>{TERRAIN_LABEL[t]}</td>
                  {(['attack', 'defense', 'speed', 'sight'] as const).map((k) => (
                    <td key={k} className="num">×{(m?.[k] ?? 1).toFixed(2)}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="row wrap">
        <button type="button" className="btn" onClick={() => openPanel('research')}>
          Research path
        </button>
        <button type="button" className="btn" onClick={() => openPanel('cities')}>
          Mobilize from Cities
        </button>
      </div>
    </div>
  );
}
