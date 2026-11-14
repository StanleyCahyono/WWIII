import React, { useMemo, useState } from 'react';
import { useFrame, useQuery, ActionButton, Modal } from '../components/common';
import { getHost } from '../sim/host';
import { openPanel, select } from '../state/ui';
import { techById, unitById, buildingById, CATALOG } from '../data/static';
import { resM, duration, gameTime, cap, pct } from '../format';
import { exec } from '../sim/exec';

interface TechRow {
  id: string;
  name: string;
  branch: string;
  tier: number;
  status: string;
  reason: string;
  cost: Record<string, number>;
  durationMin: number;
  dayAvailable: number;
  missingPrereqs: string[];
  shortfall: Record<string, number>;
  progress: number;
  endsAt: number | null;
  lineage: string | null;
  unlocks: { unlockUnit?: string[]; unitLevel?: { unit: string; level: number }[]; unlockBuilding?: string[]; unlockMissile?: string[]; modifiers?: { key: string; value: number; description: string }[]; liftCapacity?: number; maintenanceSlots?: number; missileProgram?: { missile: string; stage: string } };
}

const STATUS_LABEL: Record<string, string> = {
  completed: 'Completed',
  busy: 'In progress',
  available: 'Available',
  time_locked: 'Time-locked',
  prerequisite_locked: 'Prerequisite-locked',
  facility_locked: 'Facility-locked',
  doctrine_unavailable: 'Not in doctrine',
  unaffordable: 'Unaffordable',
  slots_full: 'Busy (slots full)',
};
const STATUS_GLYPH: Record<string, string> = { completed: '✓', busy: '◐', available: '○', time_locked: '⏱', prerequisite_locked: '🔒', facility_locked: '⌂', doctrine_unavailable: '✕', unaffordable: '¤', slots_full: '⋯' };

let lastBranch: string | null = null;
let lastSel: string | null = null;

export function ResearchPanel() {
  const frame = useFrame()!;
  const q = useQuery<TechRow[]>('researchTree');
  const [branch, setBranch] = useState<string | null>(lastBranch);
  const [sel, setSel] = useState<string | null>(lastSel);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const branches = useMemo(() => [...new Set((q.data ?? []).map((t) => t.branch))], [q.data]);
  const list = (q.data ?? []).filter((t) => (!branch || t.branch === branch) && (statusFilter === 'all' || t.status === statusFilter || (statusFilter === 'available' && t.status === 'unaffordable')));
  const chosen = (q.data ?? []).find((t) => t.id === sel) ?? null;
  const v = frame.view;
  return (
    <div className="row" style={{ alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }} data-testid="research-panel">
      <div className="col" style={{ flex: '2 1 480px', minWidth: 0 }}>
        <div className="row wrap">
          <span>
            Slots: <strong>{v.self.research.length}/{v.self.researchSlots}</strong> busy
          </span>
          {v.self.research.map((r) => (
            <span key={r.tech} className="tag accent">
              {techById.get(r.tech)?.name} · done {gameTime(r.endsAt)}
            </span>
          ))}
        </div>
        <div className="region-filters" role="group" aria-label="Branch">
          <button type="button" aria-pressed={!branch} onClick={() => { setBranch(null); lastBranch = null; }}>
            All branches
          </button>
          {branches.map((b) => (
            <button key={b} type="button" aria-pressed={branch === b} onClick={() => { setBranch(b); lastBranch = b; }}>
              {cap(b)}
            </button>
          ))}
        </div>
        <label className="row" style={{ gap: 6, fontSize: 13 }}>
          Show
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} data-testid="research-filter">
            <option value="all">All states</option>
            {Object.entries(STATUS_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        {!q.data && <p className="muted">Loading…</p>}
        {(branch ? [branch] : branches).map((b) => {
          const items = list.filter((t) => t.branch === b);
          if (!items.length) return null;
          const tiers = [...new Set(items.map((t) => t.tier))].sort((a, z) => a - z);
          return (
            <section key={b} className="tech-branch" aria-label={`${b} branch`}>
              <h4>{cap(b)}</h4>
              {tiers.map((tier) => (
                <div key={tier} style={{ marginTop: 6 }}>
                  <div className="muted" style={{ fontSize: 11 }}>Tier {tier}</div>
                  <div className="tech-grid">
                    {items.filter((t) => t.tier === tier).map((t) => (
                      <button key={t.id} type="button" className="tech" data-status={t.status} aria-pressed={sel === t.id} onClick={() => { setSel(t.id); lastSel = t.id; }} aria-label={`${t.name}, ${STATUS_LABEL[t.status] ?? t.status}. ${t.reason}`} data-testid={`tech-${t.id}`}>
                        <span className="row" style={{ gap: 6 }}>
                          <span aria-hidden>{STATUS_GLYPH[t.status] ?? '·'}</span>
                          <strong style={{ fontSize: 12.5 }}>{t.name}</strong>
                        </span>
                        <span className="muted" style={{ fontSize: 11 }}>
                          {STATUS_LABEL[t.status]} · day {t.dayAvailable} · {duration(t.durationMin)}
                        </span>
                        {t.status === 'busy' && (
                          <span className="bar" aria-label={`Progress ${pct(t.progress)}`}>
                            <span style={{ width: pct(t.progress) }} />
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          );
        })}
      </div>
      <aside className="card" style={{ flex: '1 1 300px', position: 'sticky', top: 0 }} aria-label="Technology detail">
        {chosen ? <TechDetail t={chosen} all={q.data ?? []} onChanged={q.refresh} /> : <p className="muted">Select a technology to see its prerequisites, cost, time, effects and the units it unlocks.</p>}
      </aside>
    </div>
  );
}

function statLine(unit: string, level: number) {
  const u = unitById.get(unit);
  const s = u?.levels.find((l) => l.level === level);
  if (!s) return null;
  return s;
}

function TechDetail({ t, all, onChanged }: { t: TechRow; all: TechRow[]; onChanged: () => void }) {
  const frame = useFrame()!;
  const [cancel, setCancel] = useState<{ text: string } | null>(null);
  const [eligible, setEligible] = useState<{ name: string; ok: boolean; reason?: string; key: string }[] | null>(null);
  const node = techById.get(t.id);
  const ro = frame.meta.readOnly || frame.meta.reviewMode;
  const startReason = ro ? 'Read-only campaign' : t.status === 'available' ? null : t.status === 'unaffordable' ? `${t.reason} Short: ${resM(t.shortfall)}` : t.reason;
  const unlockUnits = t.unlocks.unlockUnit ?? [];
  const showEligible = async (unit: string) => {
    const keys = frame.view.cities.map((c) => c.key);
    const v = await getHost().preview<{ rows: { target: string; name: string; ok: boolean; reason?: string }[] }>({ type: 'mobilize', unit, cities: keys });
    const rows = (v.ok ? v.preview : (v as { details?: { rows: { target: string; name: string; ok: boolean; reason?: string }[] } }).details)?.rows ?? [];
    setEligible(rows.map((r) => ({ name: r.name, ok: r.ok, reason: r.reason, key: String(r.target) })));
  };
  return (
    <div className="col" data-testid="tech-detail">
      <h3>{t.name}</h3>
      <div className="row wrap">
        <span className={`tag${t.status === 'completed' ? ' ok' : t.status === 'available' ? ' accent' : ''}`}>{STATUS_LABEL[t.status]}</span>
        {t.lineage && <span className="tag">{t.lineage}</span>}
      </div>
      <p className="dim" style={{ margin: 0, fontSize: 13 }}>{node?.description}</p>
      <dl className="kv">
        <dt>Branch / tier</dt>
        <dd>
          {cap(t.branch)} / {t.tier}
        </dd>
        <dt>Available from</dt>
        <dd>Day {t.dayAvailable}</dd>
        <dt>Prerequisites</dt>
        <dd>{node?.prereqs.length ? node.prereqs.map((p) => `${techById.get(p)?.name ?? p}${all.find((x) => x.id === p)?.status === 'completed' ? ' ✓' : ''}`).join(', ') : 'None'}</dd>
        <dt>Cost</dt>
        <dd style={{ fontSize: 12 }}>{resM(t.cost)}</dd>
        <dt>Duration</dt>
        <dd>{duration(t.durationMin)}</dd>
        {node?.requiresLabLevel ? (
          <>
            <dt>Facility</dt>
            <dd>Research facility level {node.requiresLabLevel}</dd>
          </>
        ) : null}
        {t.endsAt && (
          <>
            <dt>Completes</dt>
            <dd>{gameTime(t.endsAt)}</dd>
          </>
        )}
      </dl>
      <p className={t.status === 'available' ? 'ok' : 'muted'} style={{ margin: 0, fontSize: 12.5 }}>{t.reason}</p>
      <div className="col" style={{ gap: 4 }}>
        <h4>Effects</h4>
        {unlockUnits.map((u) => (
          <div key={u} className="row wrap">
            Unlocks <button type="button" className="btn ghost small" onClick={() => openPanel('dossier', { unit: u })}>{unitById.get(u)?.name ?? u}</button>
            {unitById.get(u)?.requires.length ? <span className="muted" style={{ fontSize: 12 }}>needs {unitById.get(u)!.requires.map((r) => `${buildingById.get(r.building)?.name} L${r.level}`).join(', ')}</span> : null}
            {t.status === 'completed' && (
              <button type="button" className="btn small" onClick={() => showEligible(u)}>
                Eligible cities
              </button>
            )}
          </div>
        ))}
        {(t.unlocks.unitLevel ?? []).map((ul) => {
          const cur = statLine(ul.unit, ul.level - 1);
          const nxt = statLine(ul.unit, ul.level);
          return (
            <div key={ul.unit} className="card" style={{ padding: 8 }}>
              <div>
                Upgrades <strong>{unitById.get(ul.unit)?.name}</strong> to level {ul.level} (applies to existing and new units)
              </div>
              {cur && nxt && (
                <table className="data" aria-label="Current versus next level">
                  <thead>
                    <tr>
                      <th>Stat</th>
                      <th className="num">L{ul.level - 1}</th>
                      <th className="num">L{ul.level}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td>Hit points</td><td className="num">{cur.hp}</td><td className="num">{nxt.hp}</td></tr>
                    <tr><td>Speed (km/h)</td><td className="num">{cur.speedKmh}</td><td className="num">{nxt.speedKmh}</td></tr>
                    <tr><td>Sight (km)</td><td className="num">{cur.sightKm}</td><td className="num">{nxt.sightKm}</td></tr>
                    <tr><td>Range (km)</td><td className="num">{cur.rangeKm}</td><td className="num">{nxt.rangeKm}</td></tr>
                    {Object.keys({ ...cur.attack, ...nxt.attack }).map((k) => (
                      <tr key={k}><td>Attack vs {k}</td><td className="num">{cur.attack[k as keyof typeof cur.attack] ?? '—'}</td><td className="num">{nxt.attack[k as keyof typeof nxt.attack] ?? '—'}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
        {(t.unlocks.unlockBuilding ?? []).map((b) => (
          <div key={b}>Unlocks building: {buildingById.get(b)?.name ?? b}</div>
        ))}
        {(t.unlocks.unlockMissile ?? []).map((m) => (
          <div key={m}>Missile program: {m}</div>
        ))}
        {t.unlocks.missileProgram && <div>Program step: {t.unlocks.missileProgram.stage} for {t.unlocks.missileProgram.missile}</div>}
        {(t.unlocks.modifiers ?? []).map((m) => (
          <div key={m.key}>{m.description}</div>
        ))}
        {t.unlocks.liftCapacity ? <div>+{t.unlocks.liftCapacity} lift capacity</div> : null}
        {t.unlocks.maintenanceSlots ? <div>+{t.unlocks.maintenanceSlots} maintenance slots</div> : null}
      </div>
      <div className="row wrap">
        {t.status === 'busy' ? (
          <ActionButton
            className="btn danger"
            disabledReason={ro ? 'Read-only campaign' : null}
            onClick={async () => {
              const v = await getHost().preview<{ refund: Record<string, number> }>({ type: 'cancelResearch', tech: t.id });
              setCancel({ text: v.ok ? `Cancelling now refunds exactly ${resM(v.preview.refund)} (80% of the unspent share). Progress is lost.` : v.reason });
            }}
          >
            Cancel research…
          </ActionButton>
        ) : (
          <ActionButton className="btn primary" disabledReason={t.status === 'completed' ? 'Already completed.' : startReason} onClick={async () => { const r = await exec({ type: 'startResearch', tech: t.id }, `Research started: ${t.name}.`); if (r.ok) onChanged(); }} data-testid="start-research">
            Start research
          </ActionButton>
        )}
      </div>
      {eligible && (
        <Modal title="Cities that can mobilize it" onClose={() => setEligible(null)}>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {eligible.map((e) => (
              <li key={e.key} className={e.ok ? 'ok' : 'muted'}>
                {e.ok ? (
                  <button type="button" className="btn ghost small" onClick={() => { const c = frame.view.cities.find((x) => x.key === e.key); if (c) { select({ kind: 'city', key: c.key, node: c.node }); openPanel('cities', { city: c.key, tab: 'mobilize' }); } }}>
                    {e.name}
                  </button>
                ) : (
                  `${e.name}: ${e.reason}`
                )}
              </li>
            ))}
          </ul>
        </Modal>
      )}
      {cancel && (
        <Modal
          title={`Cancel ${t.name}?`}
          onClose={() => setCancel(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setCancel(null)}>
                Keep researching
              </button>
              <button type="button" className="btn danger" onClick={async () => { await exec({ type: 'cancelResearch', tech: t.id }, 'Research cancelled; refund credited.'); setCancel(null); onChanged(); }}>
                Cancel and refund
              </button>
            </>
          }
        >
          <p>{cancel.text}</p>
        </Modal>
      )}
    </div>
  );
}

void CATALOG;
