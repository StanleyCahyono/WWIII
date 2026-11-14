import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useQuery, ActionButton, Modal } from '../components/common';
import { getHost } from '../sim/host';
import { openPanel, select } from '../state/ui';
import { techById, unitById, buildingById, CATALOG, missileById } from '../data/static';
import { resM, duration, gameTime, cap, pct, dayOf } from '../format';
import { exec } from '../sim/exec';
import { Icon } from '../icons';
import type { UnitType } from '../../engine/data-types';
import { Cost, Duration, IconTabs, Progress, SectionHead, Expander, type TabDef } from './panelKit';
import { LockIcon, UnitPlate, UNIT_CLASSES, unitClassOf, type UnitClass } from './panelIcons';

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
const LOCKED = new Set(['time_locked', 'prerequisite_locked', 'facility_locked', 'doctrine_unavailable']);

type ExtraTab = 'doctrine' | 'industry' | 'mobility';
type RTab = 'all' | UnitClass | ExtraTab;
const EXTRA_TABS: { key: ExtraTab; label: string; short: string; icon: string }[] = [
  { key: 'doctrine', label: 'Doctrine', short: 'Doctrine', icon: 'shield' },
  { key: 'industry', label: 'Industry & economy', short: 'Industry', icon: 'components' },
  { key: 'mobility', label: 'Mobility & logistics', short: 'Mobility', icon: 'embark' },
];

/** A node in a research line: one technology (or the standard-issue level that needs none). */
interface TNode {
  label: string;
  tech: TechRow | null;
  /** The first (canonical) occurrence of a technology carries its test id; a shared unlock repeats as a mirror. */
  primary: boolean;
}
interface Line {
  key: string;
  label: string;
  unit?: UnitType;
  nodes: TNode[];
}
interface TabModel {
  key: RTab;
  lines: Line[];
  singles: TechRow[];
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
function stemOf(id: string): string {
  return id.replace(/_(\d+|blueprint|qualified)$/, '');
}
function stripNumeral(name: string): string {
  return name.replace(/\s+(I{1,3}|IV|V|VI{0,3})$/, '').replace(/\s+\((blueprint|qualified)\)$/i, '');
}
function numeralOf(name: string, i: number): string {
  const m = /\s(I{1,3}|IV|V|VI{0,3})$/.exec(name);
  return m ? m[1] : ROMAN[i] ?? String(i + 1);
}

/** Lay the technology catalog out as unit lines per class tab, plus non-unit tabs. */
function buildModel(rows: TechRow[]): Map<RTab, TabModel> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const tabs = new Map<RTab, TabModel>();
  const tab = (k: RTab) => tabs.get(k) ?? tabs.set(k, { key: k, lines: [], singles: [] }).get(k)!;
  const placed = new Set<string>();
  for (const cls of UNIT_CLASSES) {
    for (const u of CATALOG.units) {
      if (unitClassOf(u) !== cls.key) continue;
      const nodes: TNode[] = u.levels.map((l, i) => {
        const tid = l.level === 1 ? u.unlockTech : l.tech;
        const t = tid ? byId.get(tid) ?? null : null;
        const primary = !!t && !placed.has(t.id);
        if (t) placed.add(t.id);
        return { label: `L${l.level ?? i + 1}`, tech: t, primary };
      });
      tab(cls.key).lines.push({ key: u.id, label: u.name, unit: u, nodes });
    }
  }
  // everything else: group by branch, chain same-stem technologies (I → II → III, blueprint → qualified)
  const rest = rows.filter((r) => !placed.has(r.id)).sort((a, b) => a.tier - b.tier || a.dayAvailable - b.dayAvailable || a.id.localeCompare(b.id));
  const target = (r: TechRow): RTab => (r.branch === 'industry' ? 'industry' : r.branch === 'mobility' ? 'mobility' : r.branch === 'strategic' || r.branch === 'hypersonic' ? 'missiles' : 'doctrine');
  const chains = new Map<string, TechRow[]>();
  for (const r of rest) {
    const k = `${target(r)}|${stemOf(r.id)}`;
    (chains.get(k) ?? chains.set(k, []).get(k)!).push(r);
  }
  for (const [k, list] of chains) {
    const tk = k.split('|')[0] as RTab;
    if (list.length === 1) tab(tk).singles.push(list[0]);
    else tab(tk).lines.push({ key: k, label: stripNumeral(list[0].name), nodes: list.map((t, i) => ({ label: numeralOf(t.name, i), tech: t, primary: true })) });
  }
  return tabs;
}

function caption(t: TechRow, today: number, label: string): React.ReactNode {
  switch (t.status) {
    case 'completed':
      return label.length <= 3 ? `${label} done` : 'Done';
    case 'busy':
      return pct(t.progress);
    case 'available':
      return 'Ready';
    case 'unaffordable':
      return 'Short';
    case 'slots_full':
      return 'Slots full';
    case 'facility_locked':
      return 'Needs lab';
    case 'doctrine_unavailable':
      return 'N/A';
    default:
      return t.dayAvailable > today ? `Day ${t.dayAvailable}` : 'Prereq.';
  }
}

let lastTab: RTab = 'all';
let lastSel: string | null = null;

export function ResearchPanel() {
  const frame = useFrame()!;
  const q = useQuery<TechRow[]>('researchTree');
  const [tab, setTab] = useState<RTab>(lastTab);
  const [sel, setSel] = useState<string | null>(lastSel);
  const detailRef = useRef<HTMLDivElement>(null);
  const model = useMemo(() => buildModel(q.data ?? []), [q.data]);
  const chosen = (q.data ?? []).find((t) => t.id === sel) ?? null;
  const v = frame.view;
  const today = dayOf(v.tick);
  const pick = (id: string) => {
    setSel(id);
    lastSel = id;
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches) requestAnimationFrame(() => detailRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  };
  const count = (k: RTab) => {
    const m = model.get(k);
    if (!m) return 0;
    return m.lines.reduce((a, l) => a + l.nodes.filter((n) => n.primary && n.tech && (n.tech.status === 'available' || n.tech.status === 'unaffordable')).length, 0) + m.singles.filter((t) => t.status === 'available' || t.status === 'unaffordable').length;
  };
  const tabs: TabDef<RTab>[] = [
    { key: 'all', label: 'All', icon: <Icon name="research" size={20} />, testid: 'rtab-all', badge: count('all') || undefined },
    ...UNIT_CLASSES.map((c) => ({ key: c.key as RTab, label: c.short, title: c.label, icon: <Icon name={c.icon} size={20} />, testid: `rtab-${c.key}`, badge: count(c.key) || undefined })),
    ...EXTRA_TABS.map((c) => ({ key: c.key as RTab, label: c.short, title: c.label, icon: <Icon name={c.icon} size={20} />, testid: `rtab-${c.key}`, badge: count(c.key) || undefined })),
  ];
  // "All" counts every available technology once
  tabs[0].badge = (q.data ?? []).filter((t) => t.status === 'available' || t.status === 'unaffordable').length || undefined;
  const sections: { key: RTab; label: string; icon: string }[] = tab === 'all' ? [...UNIT_CLASSES, ...EXTRA_TABS] : [...UNIT_CLASSES, ...EXTRA_TABS].filter((c) => c.key === tab);
  return (
    <div className="p-root" data-testid="research-panel">
     <div className="p-research">
      <div className="p-research-main">
        <IconTabs label="Research branch" value={tab} onChange={(k) => { setTab(k); lastTab = k; }} tabs={tabs} />
        <div className="p-legend" aria-hidden="true">
          <span><i className="p-dia done" /> Researched</span>
          <span><i className="p-dia ready" /> Ready to start</span>
          <span><i className="p-dia busy" /> Researching</span>
          <span><i className="p-dia locked" /> Locked (opens on the day shown)</span>
        </div>
        {!q.data && <p className="muted">Loading…</p>}
        {sections.map((s) => {
          const m = model.get(s.key);
          if (!m || (!m.lines.length && !m.singles.length)) return null;
          return (
            <section key={s.key} className="p-rsec" aria-label={`${s.label} research`}>
              {tab === 'all' && <SectionHead icon={<Icon name={s.icon} size={18} />} title={s.label} level={4} />}
              {m.lines.map((l) => (
                <ResearchLine key={l.key} line={l} sel={sel} onPick={pick} today={today} />
              ))}
              {m.singles.length > 0 && (
                <div className="p-singles">
                  {m.singles.map((t) => (
                    <div key={t.id} className="p-single">
                      <TechNodeBtn t={t} label={t.name.match(/\s(I{1,3}|IV|V)$/)?.[1] ?? '◆'} sel={sel === t.id} onPick={pick} today={today} primary />
                      <div className="p-single-txt">
                        <strong>{t.name}</strong>
                        <span className="muted">{techById.get(t.id)?.description}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
      <aside className="p-research-side" aria-label="Research status and detail" ref={detailRef}>
        <div className="p-card">
          <SectionHead icon={<Icon name="clock" size={18} />} title="Currently researching" level={4}>
            <span className="p-badge">{v.self.research.length}/{v.self.researchSlots}</span>
          </SectionHead>
          <div className="p-rslots">
            {Array.from({ length: Math.max(v.self.researchSlots, v.self.research.length) }, (_, i) => {
              const r = v.self.research[i];
              if (!r)
                return (
                  <div key={`free-${i}`} className="p-rslot free">
                    <span className="p-dia ready" aria-hidden="true" />
                    <span>Free slot — pick a ready technology</span>
                  </div>
                );
              const tn = techById.get(r.tech);
              const p = (v.tick - r.startedAt) / Math.max(1, r.endsAt - r.startedAt);
              return (
                <button key={r.tech} type="button" className="p-rslot" onClick={() => pick(r.tech)}>
                  <span className="p-dia busy" aria-hidden="true" />
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="p-ellip" style={{ display: 'block', fontWeight: 700 }}>{tn?.name ?? r.tech}</span>
                    <Progress value={p} tone="accent" label={`${Math.round(p * 100)}% researched`} />
                    <span className="muted p-small">done {gameTime(r.endsAt)} · {duration(r.endsAt - v.tick)} left</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="p-card p-rdetail">
          <span className="p-kicker">Selected research</span>
          {chosen ? <TechDetail t={chosen} all={q.data ?? []} onChanged={q.refresh} /> : <p className="muted" style={{ margin: 0 }}>Select a technology to see when it opens, its cost and time, prerequisites, and what it unlocks.</p>}
        </div>
      </aside>
     </div>
    </div>
  );
}

function ResearchLine({ line, sel, onPick, today }: { line: Line; sel: string | null; onPick: (id: string) => void; today: number }) {
  const lvl = line.nodes.filter((n) => (n.tech ? n.tech.status === 'completed' : true)).length;
  return (
    <div className="p-rline">
      <div className="p-rline-head">
        {line.unit ? <UnitPlate family={line.unit.family} size={50} /> : <span className="p-plate bld" style={{ width: 50, height: 37 }} aria-hidden="true"><Icon name="research" size={22} /></span>}
        <div style={{ minWidth: 0 }}>
          <div className="p-rline-name">{line.label}</div>
          <div className="muted p-small">{line.unit ? `${lvl ? `Level ${lvl} of ${line.nodes.length}` : 'Not unlocked'}` : `${lvl} of ${line.nodes.length} researched`}</div>
        </div>
      </div>
      <ol className="p-rnodes">
        {line.nodes.map((n, i) => {
          const prevDone = i > 0 && (line.nodes[i - 1].tech ? line.nodes[i - 1].tech!.status === 'completed' : true);
          return (
            <li key={i} className={i > 0 ? (prevDone ? 'link done' : 'link') : undefined}>
              {n.tech ? (
                <TechNodeBtn t={n.tech} label={n.label} sel={sel === n.tech.id} onPick={onPick} today={today} primary={n.primary} />
              ) : (
                <span className="p-node base" title="Standard issue: available from the start, no research needed">
                  <span className="p-dia done"><Icon name="check" size={14} /></span>
                  <span className="p-node-cap">{n.label} · Std</span>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function TechNodeBtn({ t, label, sel, onPick, today, primary }: { t: TechRow; label: string; sel: boolean; onPick: (id: string) => void; today: number; primary: boolean }) {
  const locked = LOCKED.has(t.status);
  const kind = t.status === 'completed' ? 'done' : t.status === 'busy' ? 'busy' : locked ? 'locked' : t.status === 'available' ? 'ready' : 'warn';
  return (
    <button
      type="button"
      className="tech p-node"
      data-status={t.status}
      aria-pressed={sel}
      onClick={() => onPick(t.id)}
      aria-label={`${t.name}, ${STATUS_LABEL[t.status] ?? t.status}. ${t.reason}`}
      title={`${t.name} — ${STATUS_LABEL[t.status] ?? t.status}`}
      data-testid={primary ? `tech-${t.id}` : undefined}
    >
      <span className={`p-dia ${kind}`} style={t.status === 'busy' ? ({ '--p': `${Math.round(t.progress * 100)}%` } as React.CSSProperties) : undefined}>
        <span className="p-dia-in">{t.status === 'completed' ? <Icon name="check" size={14} /> : label.length <= 3 ? label : '◆'}</span>
      </span>
      <span className="p-node-cap">
        {locked && t.status !== 'doctrine_unavailable' && <LockIcon size={10} />}
        {caption(t, today, label)}
      </span>
    </button>
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
  useEffect(() => setEligible(null), [t.id]);
  const node = techById.get(t.id);
  const ro = frame.meta.readOnly || frame.meta.reviewMode;
  const startReason = ro ? 'Read-only campaign' : t.status === 'available' ? null : t.status === 'unaffordable' ? `${t.reason} Short: ${resM(t.shortfall)}` : t.reason;
  const unlockUnits = t.unlocks.unlockUnit ?? [];
  const artUnit = unlockUnits[0] ?? t.unlocks.unitLevel?.[0]?.unit;
  const stock = Object.fromEntries(frame.view.self.resources.map((r) => [r.resource, r.spendable]));
  const showEligible = async (unit: string) => {
    const keys = frame.view.cities.map((c) => c.key);
    const v = await getHost().preview<{ rows: { target: string; name: string; ok: boolean; reason?: string }[] }>({ type: 'mobilize', unit, cities: keys });
    const rows = (v.ok ? v.preview : (v as { details?: { rows: { target: string; name: string; ok: boolean; reason?: string }[] } }).details)?.rows ?? [];
    setEligible(rows.map((r) => ({ name: r.name, ok: r.ok, reason: r.reason, key: String(r.target) })));
  };
  const tone = t.status === 'completed' ? 'ok' : t.status === 'available' ? 'accent' : t.status === 'busy' ? 'accent' : t.status === 'unaffordable' ? 'warn' : '';
  return (
    <div className="col" data-testid="tech-detail" style={{ gap: 10 }}>
      <div className="p-rdetail-head">
        {artUnit ? <UnitPlate family={unitById.get(artUnit)?.family} size={64} /> : <span className="p-plate bld" style={{ width: 64, height: 47 }} aria-hidden="true"><Icon name="research" size={28} /></span>}
        <div style={{ minWidth: 0 }}>
          <h3>{t.name}</h3>
          <div className="row wrap" style={{ gap: 4, marginTop: 4 }}>
            <span className={`p-pill ${tone}`}>{STATUS_LABEL[t.status]}</span>
            {t.lineage && <span className="p-pill">{t.lineage}</span>}
            <span className="p-pill">{cap(t.branch)} · tier {t.tier}</span>
          </div>
        </div>
      </div>
      <div className="p-facts">
        <div>
          <span className="p-kicker">Available from</span>
          <strong>Day {t.dayAvailable}</strong>
        </div>
        <div>
          <span className="p-kicker">Duration</span>
          <Duration min={t.durationMin} />
        </div>
        {node?.requiresLabLevel ? (
          <div>
            <span className="p-kicker">Facility</span>
            <strong>Research lab L{node.requiresLabLevel}</strong>
          </div>
        ) : null}
        {t.endsAt && (
          <div>
            <span className="p-kicker">Completes</span>
            <strong>{gameTime(t.endsAt)}</strong>
          </div>
        )}
      </div>
      {t.status === 'busy' && <Progress value={t.progress} tone="accent" label={`${Math.round(t.progress * 100)}% researched`} />}
      <div>
        <span className="p-kicker">Cost</span>
        <Cost cost={t.cost} stock={t.status === 'completed' || t.status === 'busy' ? undefined : stock} />
      </div>
      <div>
        <span className="p-kicker">Prerequisites</span>
        {node?.prereqs.length ? (
          <ul className="p-prereq">
            {node.prereqs.map((p) => {
              const done = all.find((x) => x.id === p)?.status === 'completed';
              return (
                <li key={p} className={done ? 'ok' : ''}>
                  {done ? <Icon name="check" size={13} /> : <LockIcon size={12} />} {techById.get(p)?.name ?? p}
                  {done ? ' ✓' : ''}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="muted">None</div>
        )}
      </div>
      <p className={t.status === 'available' ? 'ok' : 'muted'} style={{ margin: 0, fontSize: 12.5 }}>{t.reason}</p>
      <div className="col" style={{ gap: 6 }}>
        <span className="p-kicker">Unlocks &amp; effects</span>
        {unlockUnits.map((u) => (
          <div key={u} className="p-unlock">
            <UnitPlate family={unitById.get(u)?.family} size={40} />
            <div className="grow" style={{ minWidth: 0 }}>
              <button type="button" className="p-link" onClick={() => openPanel('dossier', { unit: u })}>
                {unitById.get(u)?.name ?? u}
              </button>
              {unitById.get(u)?.requires.length ? <div className="muted p-small">needs {unitById.get(u)!.requires.map((r) => `${buildingById.get(r.building)?.name} L${r.level}`).join(', ')}</div> : null}
            </div>
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
            <div key={ul.unit} className="p-unlock col" style={{ alignItems: 'stretch' }}>
              <div>
                Upgrades <strong>{unitById.get(ul.unit)?.name}</strong> to level {ul.level} (applies to existing and new units)
              </div>
              {cur && nxt && (
                <table className="data p-cmp" aria-label="Current versus next level">
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
          <div key={b} className="p-unlock">Unlocks building: <strong>{buildingById.get(b)?.name ?? b}</strong></div>
        ))}
        {(t.unlocks.unlockMissile ?? []).map((m) => (
          <div key={m} className="p-unlock">Missile program: <strong>{missileById.get(m)?.name ?? m}</strong></div>
        ))}
        {t.unlocks.missileProgram && <div className="p-unlock">Program step: {t.unlocks.missileProgram.stage} for {missileById.get(t.unlocks.missileProgram.missile)?.name ?? t.unlocks.missileProgram.missile}</div>}
        {(t.unlocks.modifiers ?? []).map((m) => (
          <div key={m.key} className="p-unlock">{m.description}</div>
        ))}
        {t.unlocks.liftCapacity ? <div className="p-unlock">+{t.unlocks.liftCapacity} lift capacity</div> : null}
        {t.unlocks.maintenanceSlots ? <div className="p-unlock">+{t.unlocks.maintenanceSlots} maintenance slots</div> : null}
      </div>
      {node?.description && (
        <Expander summary="Background">
          <p className="dim" style={{ margin: 0, fontSize: 13 }}>{node.description}</p>
        </Expander>
      )}
      <div className="p-rgo">
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
          <ActionButton className="btn primary p-start wide" disabledReason={t.status === 'completed' ? 'Already completed.' : startReason} onClick={async () => { const r = await exec({ type: 'startResearch', tech: t.id }, `Research started: ${t.name}.`); if (r.ok) onChanged(); }} data-testid="start-research">
            <Icon name="research" size={16} /> Start research
          </ActionButton>
        )}
      </div>
      {eligible && (
        <Modal title="Cities that can mobilize it" onClose={() => setEligible(null)}>
          <ul className="p-elig">
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
