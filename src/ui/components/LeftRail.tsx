import React, { useState } from 'react';
import { useStore } from '../state/store';
import { ui, openPanel, closePanel, type Panel } from '../state/ui';
import { Icon, useFrame } from './common';

const MAIN: { id: Panel | 'map'; label: string; icon: string; key?: string }[] = [
  { id: 'map', label: 'Map', icon: 'map' },
  { id: 'forces', label: 'Forces', icon: 'forces', key: 'F' },
  { id: 'economy', label: 'Economy', icon: 'economy', key: 'E' },
  { id: 'research', label: 'Research', icon: 'research', key: 'R' },
  { id: 'diplomacy', label: 'Diplomacy', icon: 'diplomacy', key: 'G' },
  { id: 'intel', label: 'Intelligence', icon: 'intel', key: 'I' },
  { id: 'journal', label: 'Journal', icon: 'journal', key: 'J' },
];
const MORE: { id: Panel; label: string; icon: string; key?: string }[] = [
  { id: 'cities', label: 'Cities', icon: 'cities', key: 'Y' },
  { id: 'coalition', label: 'Coalition', icon: 'coalition' },
  { id: 'news', label: 'News', icon: 'news', key: 'N' },
  { id: 'journal', label: 'Events', icon: 'events' },
  { id: 'market', label: 'Market', icon: 'market', key: 'M' },
  { id: 'planning', label: 'Planning', icon: 'planning' },
];

export function LeftRail() {
  const panel = useStore(ui, (s) => s.panel);
  const rosterOpen = useStore(ui, (s) => s.rosterOpen);
  const frame = useFrame();
  const pendingOffers = frame?.view.offers.filter((o) => o.status === 'pending' && o.to === frame.view.viewer).length ?? 0;
  const research = frame?.view.self.research.length ?? 0;
  return (
    <nav className="rail" aria-label="Destinations">
      {MAIN.map((d) => (
        <button
          key={d.label}
          type="button"
          aria-current={(d.id === 'map' ? panel === null : panel === d.id) ? 'page' : undefined}
          onClick={() => (d.id === 'map' ? closePanel() : openPanel(d.id))}
          title={d.key ? `${d.label} (${d.key})` : d.label}
          data-testid={`rail-${d.id}`}
        >
          <Icon name={d.icon} />
          {d.label}
          {d.id === 'diplomacy' && pendingOffers > 0 && <span className="count" aria-label={`${pendingOffers} offers awaiting your answer`}>{pendingOffers}</span>}
          {d.id === 'research' && research > 0 && <span className="count" aria-label={`${research} active research programs`}>{research}</span>}
        </button>
      ))}
      <div className="more" role="group" aria-label="More screens">
        {MORE.map((d) => (
          <button key={d.label} type="button" aria-current={panel === d.id && d.label !== 'Events' ? 'page' : undefined} onClick={() => openPanel(d.id)} title={d.key ? `${d.label} (${d.key})` : d.label} data-testid={`rail-${d.label.toLowerCase()}`}>
            <Icon name={d.icon} />
            {d.label}
          </button>
        ))}
        <button type="button" aria-pressed={rosterOpen} onClick={() => ui.patch({ rosterOpen: !rosterOpen })} title="Show or hide the roster">
          <Icon name="roster" />
          Roster
        </button>
      </div>
    </nav>
  );
}

export function MobileNav() {
  const [more, setMore] = useState(false);
  const all: { id: Panel; label: string }[] = [
    { id: 'forces', label: 'Forces' },
    { id: 'cities', label: 'Cities' },
    { id: 'research', label: 'Research' },
    { id: 'economy', label: 'Economy' },
    { id: 'diplomacy', label: 'Diplomacy' },
    { id: 'intel', label: 'Intel' },
    { id: 'journal', label: 'Journal' },
    { id: 'market', label: 'Market' },
    { id: 'coalition', label: 'Coalition' },
    { id: 'news', label: 'News' },
    { id: 'score', label: 'Score' },
    { id: 'planning', label: 'Planning' },
  ];
  const sel = useStore(ui, (s) => s.selection);
  if (sel) return null; // the bottom sheet takes this space
  return (
    <nav className="mobile-nav" aria-label="Destinations">
      {all.slice(0, more ? all.length : 4).map((d) => (
        <button key={d.id} type="button" className="btn" onClick={() => openPanel(d.id)} data-testid={`mnav-${d.id}`}>
          {d.label}
        </button>
      ))}
      <button type="button" className="btn" aria-expanded={more} onClick={() => setMore(!more)}>
        {more ? 'Less' : 'More…'}
      </button>
    </nav>
  );
}
