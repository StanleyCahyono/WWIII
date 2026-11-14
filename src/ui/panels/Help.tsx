import React from 'react';
import { useStore } from '../state/store';
import { ui, openPanel } from '../state/ui';
import { useFrame } from '../components/common';
import { placeName, MAP } from '../data/static';

export const KEYS: [string, string][] = [
  ['W A S D / ↑ ↓', 'Pan the map (not while typing)'],
  ['← →', 'Cycle armies (army selected) or cities (city/province selected); otherwise pan'],
  ['+ / −, mouse wheel, pinch', 'Zoom centred on pointer or view centre'],
  ['Home or C', 'Reset view to capital'],
  ['Space', 'Pause / resume'],
  ['Escape', 'Cancel targeting, close the top layer, or clear selection (focus returns to the opener)'],
  ['Right-drag', 'Lasso-select own formations'],
  ['Shift/Ctrl-click', 'Add formation to selection (or use roster checkboxes)'],
  ['Right-click (in an order)', 'Cancel targeting'],
  ['Right-click unit / Shift+F10 / Menu key', 'Context menu: Inspect, Locate in roster, Orders, Pin report'],
  ['Shift-click (Move)', 'Add a waypoint'],
  ['F E R G I J Y M N V', 'Forces, Economy, Research, Diplomacy, Intelligence, Journal, Cities, Market, News, Score'],
  ['Tab / Shift+Tab', 'Move focus; every control is reachable by keyboard'],
];

export function HelpPanel() {
  const frame = useFrame()!;
  const sel = useStore(ui, (s) => s.selection);
  const v = frame.view;
  const cap = v.self.capitalCity ? MAP.cityByKey.get(v.self.capitalCity)?.name : null;
  const lessons: { title: string; text: string; act?: () => void; actLabel?: string }[] = [];
  if (!sel) lessons.push({ title: 'Select something', text: `Click ${cap ?? 'your capital'} on the map or use search. The inspector on the right always names who controls the object and which actions you can take.`, act: () => document.getElementById('map-search-input')?.focus(), actLabel: 'Focus search' });
  if (sel?.kind === 'city') lessons.push({ title: 'Cities', text: `${placeName(sel.node)} — open the city sheet for production and morale breakdowns, construction and mobilization. Occupied cities can build but not mobilize.`, act: () => openPanel('cities', { city: sel.key }), actLabel: 'Open city sheet' });
  if (sel?.kind === 'stack') lessons.push({ title: 'Moving a formation', text: 'Choose Move…, click a destination (Shift-click adds waypoints), review arrival time, terrain legs and any border consequence, then Confirm. Cancel leaves everything unchanged.', act: () => document.querySelector<HTMLElement>('[data-testid="action-move"]')?.focus(), actLabel: 'Focus Move' });
  if (sel?.kind === 'contact') lessons.push({ title: 'Uncertain contacts', text: 'A radar contact shows only domain, position and time. Visual contact may add owner and count; identification adds types. Buy a report in Intelligence for a dated snapshot.' });
  lessons.push({ title: 'Reading resources', text: 'Each resource shows spendable stock and net change per day. Focus or hover for gross output, upkeep, market reservations and the 24/72 h forecast. A red underline means stock ran out; amber means negative net.', act: () => document.querySelector<HTMLElement>('[data-testid="res-supplies"]')?.focus(), actLabel: 'Focus resources' });
  lessons.push({ title: 'Research and mobilization', text: 'Research unlocks blueprints and upgrades existing units. Mobilize eligible units in homeland or annexed cities with the required facilities.', act: () => openPanel('research'), actLabel: 'Open Research' });
  lessons.push({ title: 'Time', text: 'The clock starts paused. Use the speed buttons, advance one hour, or jump to the next significant event. Interruptions (war on you, capital change, campaign end) pause automatically.', act: () => document.getElementById('pause-btn')?.focus(), actLabel: 'Focus clock' });
  return (
    <div className="col" data-testid="help-panel">
      <h3>Advisor</h3>
      {lessons.map((l) => (
        <div key={l.title} className="card">
          <strong>{l.title}</strong>
          <p style={{ margin: '4px 0' }}>{l.text}</p>
          {l.act && (
            <button type="button" className="btn small" onClick={l.act}>
              {l.actLabel}
            </button>
          )}
        </div>
      ))}
      <div className="row">
        <button type="button" className="btn" onClick={() => ui.patch({ tutorialOpen: true, panel: null })}>
          Open the tutorial checklist
        </button>
        <button type="button" className="btn" onClick={() => ui.patch({ briefingOpen: true })}>
          Reopen briefing
        </button>
      </div>
      <h3>Keyboard and pointer</h3>
      <table className="data" data-testid="keyboard-chart">
        <tbody>
          {KEYS.map(([k, d]) => (
            <tr key={k}>
              <td style={{ fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{k}</td>
              <td>{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">Touch: drag to pan, pinch to zoom, tap to select; map buttons pan/zoom/recenter; lists offer every action without precise taps.</p>
    </div>
  );
}
