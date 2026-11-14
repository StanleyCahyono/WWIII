import React, { useEffect } from 'react';
import { useStore } from '../state/store';
import { ui, openPanel, type Panel } from '../state/ui';
import { getHost } from '../sim/host';
import { useFrame, useQuery, Modal } from './common';
import { cityByNode, MAP } from '../data/static';

interface Profile {
  name: string;
  summary: string;
  doctrine: string;
  openingDecisions: { id: string; title: string; detail: string; screen: string }[];
}

const SCREEN_MAP: Record<string, Panel | 'map'> = { research: 'research', economy: 'economy', cities: 'cities', diplomacy: 'diplomacy', forces: 'forces', market: 'market', map: 'map', intel: 'intel', coalition: 'coalition' };

export function Briefing() {
  const frame = useFrame()!;
  const prof = useQuery<Profile | null>('profile');
  const v = frame.view;
  const decisions = [...(prof.data?.openingDecisions ?? [])];
  const defaults = [
    { id: 'd-research', title: 'Start a research program', detail: 'Open Research and start an available technology; two slots run in parallel.', screen: 'research' },
    { id: 'd-build', title: 'Invest in a city', detail: 'Open Cities, sort by net production and queue a building where it pays back fastest.', screen: 'cities' },
    { id: 'd-neighbours', title: 'Inspect your neighbours', detail: 'Open Diplomacy to see who borders you and what access each side grants.', screen: 'diplomacy' },
  ];
  for (const d of defaults) if (decisions.length < 3 && !decisions.some((x) => x.screen === d.screen)) decisions.push(d);
  const cap = v.self.capitalCity ? MAP.cityByKey.get(v.self.capitalCity) : null;
  const close = () => ui.patch({ briefingOpen: false });
  return (
    <Modal
      title={`Briefing — ${v.self.name}`}
      onClose={close}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={() => { close(); ui.patch({ tutorialOpen: true }); }} data-testid="start-tutorial">
            Start the short tutorial
          </button>
          <button type="button" className="btn primary" onClick={close} data-testid="close-briefing">
            To the map (paused)
          </button>
        </>
      }
    >
      <p style={{ margin: 0 }}>
        Day {v.day}, {v.time.slice(11)} UTC. The clock is <strong>paused</strong>. Your capital is <strong>{cap?.name ?? '—'}</strong>; you hold {v.cities.length} cities and {v.stacks.length} formations. {prof.data?.summary ?? ''}
      </p>
      <p className="dim" style={{ margin: 0 }}>
        Victory: hold {v.scores.soloThreshold} of {v.scores.denominator} territorial points at a day change (or lead at day 180). You have {v.scores.byCountry[v.viewer] ?? 0}.
      </p>
      <h3>Three decisions for your first hour</h3>
      <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {decisions.slice(0, 3).map((d) => (
          <li key={d.id}>
            <strong>{d.title}.</strong> {d.detail}{' '}
            <button
              type="button"
              className="btn small"
              onClick={() => {
                close();
                const s = SCREEN_MAP[d.screen] ?? 'map';
                if (s !== 'map') openPanel(s);
              }}
            >
              Open {d.screen}
            </button>
          </li>
        ))}
      </ol>
      <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>Space pauses/resumes, the ▸| button advances one hour. Every number with a time unit is in game time.</p>
    </Modal>
  );
}

const STEPS: { id: string; title: string; text: string; focus: string; panel?: Panel }[] = [
  { id: 'select_city', title: 'Select a city', text: 'Click your capital on the map, or open Cities and pick one. The inspector shows owner, output, morale and what you can do there.', focus: '[data-testid="rail-cities"], [data-testid="mnav-cities"]' },
  { id: 'read_resources', title: 'Read your resource balance', text: 'Each entry in the resource strip shows spendable stock and net change per day. Hover or focus one for production, upkeep and reservations; open Economy for the ledger and forecast.', focus: '[data-testid="res-supplies"], [data-testid="rail-economy"]', panel: 'economy' },
  { id: 'unlock_unit', title: 'Unlock or mobilize a unit', text: 'Start a technology in Research to unlock new units, or mobilize an eligible unit in a homeland city from its city sheet.', focus: '[data-testid="rail-research"], [data-testid="mnav-research"]', panel: 'research' },
  { id: 'move_unit', title: 'Move a formation', text: 'Select a formation (map or roster), choose Move…, click a destination, review the route, arrival time and any border consequence, then Confirm.', focus: '[data-testid="roster"] [role="option"], [data-testid="mnav-forces"]' },
  { id: 'check_arrival', title: 'Check its arrival', text: 'The inspector shows remaining duration and arrival time; the timeline at the bottom lists expected arrivals. Advance one hour to watch it move.', focus: '[data-testid="step-hour"]' },
];

export function Tutorial() {
  const frame = useFrame()!;
  const sel = useStore(ui, (s) => s.selection);
  const panel = useStore(ui, (s) => s.panel);
  const host = getHost();
  const done = new Set(String(frame.uiPrefs['tutorial.done'] ?? '').split(',').filter(Boolean));
  const mark = (id: string) => {
    if (done.has(id)) return;
    done.add(id);
    void host.ui({ kind: 'setPref', key: 'tutorial.done', value: [...done].join(',') });
  };
  // auto-detect completion from real state
  useEffect(() => {
    const v = frame.view;
    if (sel?.kind === 'city' && cityByNode.get(sel.node)) mark('select_city');
    if (panel === 'economy' || panel === 'market' || ui.get().ledgerOpen) mark('read_resources');
    if (v.self.research.length > 0 || v.self.jobs.some((j) => j.kind === 'mobilize')) mark('unlock_unit');
    if (v.stacks.some((s) => s.order)) mark('move_unit');
    if (v.stacks.some((s) => s.order) && v.tick > 0 && (sel?.kind === 'stack' || ui.get().timeStripOpen)) mark('check_arrival');
  });
  const current = STEPS.find((s) => !done.has(s.id));
  const close = () => ui.patch({ tutorialOpen: false });
  return (
    <aside className="card" role="complementary" aria-label="Tutorial" data-testid="tutorial" style={{ position: 'fixed', right: 12, bottom: 56, zIndex: 35, width: 340, boxShadow: 'var(--shadow)' }}>
      <div className="row">
        <strong>Tutorial</strong>
        <span className="muted" style={{ fontSize: 12 }}>
          {done.size}/{STEPS.length} done · saved in this campaign
        </span>
        <button type="button" className="btn ghost small close-x" onClick={close} aria-label="Close tutorial">
          ✕
        </button>
      </div>
      <ol style={{ margin: '6px 0', paddingLeft: 20, fontSize: 12.5 }}>
        {STEPS.map((s) => (
          <li key={s.id} style={{ opacity: done.has(s.id) ? 0.6 : 1 }}>
            {done.has(s.id) ? '✓ ' : ''}
            {s.title}
            {done.has(s.id) && (
              <button type="button" className="btn ghost small" onClick={() => { done.delete(s.id); void host.ui({ kind: 'setPref', key: 'tutorial.done', value: [...done].join(',') }); }}>
                reopen
              </button>
            )}
          </li>
        ))}
      </ol>
      {current ? (
        <div className="col" style={{ gap: 6 }}>
          <strong>{current.title}</strong>
          <p style={{ margin: 0, fontSize: 13 }}>{current.text}</p>
          <div className="row">
            <button
              type="button"
              className="btn small primary"
              onClick={() => {
                if (current.panel) openPanel(current.panel);
                const el = document.querySelector<HTMLElement>(current.focus);
                el?.focus();
                el?.scrollIntoView({ block: 'nearest' });
              }}
            >
              Show me
            </button>
            <button type="button" className="btn small" onClick={() => mark(current.id)}>
              Skip step
            </button>
          </div>
        </div>
      ) : (
        <p className="ok" style={{ margin: 0 }}>All lessons complete. Reopen any step above, or the tutorial from the game menu.</p>
      )}
    </aside>
  );
}
