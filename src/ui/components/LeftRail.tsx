import React, { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { ui, openPanel, type Panel } from '../state/ui';
import { NationBadge, useFrame } from './common';
import { Icon, type IconName } from '../icons';
import { ClockButton, useVictory } from './TopBar';
import { getHost } from '../sim/host';
import { SPEED_BASE } from '../sim/protocol';

/**
 * Desktop HUD, left side of the map:
 *  • the nation card (badge + name, DAY / TIME, victory progress, quick actions), and
 *  • collapsible side tabs for the remaining destinations and the roster.
 * Every destination keeps its `rail-<panel>` test id and a visible label (spec: labelled destinations).
 */

type Dest = { id: Panel; label: string; short: string; icon: IconName; key?: string };

const QUICK: Dest[] = [
  { id: 'news', label: 'News', short: 'News', icon: 'news', key: 'N' },
  { id: 'research', label: 'Research', short: 'Research', icon: 'research', key: 'R' },
  { id: 'diplomacy', label: 'Diplomacy', short: 'Diplomacy', icon: 'diplomacy', key: 'G' },
  { id: 'coalition', label: 'Coalition', short: 'Coalition', icon: 'coalition' },
  { id: 'journal', label: 'Journal', short: 'Events', icon: 'bell', key: 'J' },
];

const TABS: Dest[] = [
  { id: 'forces', label: 'Forces', short: 'Forces', icon: 'forces', key: 'F' },
  { id: 'cities', label: 'Cities', short: 'Cities', icon: 'cities', key: 'Y' },
  { id: 'economy', label: 'Economy', short: 'Economy', icon: 'economy', key: 'E' },
  { id: 'intel', label: 'Intelligence', short: 'Intel', icon: 'intel', key: 'I' },
  { id: 'planning', label: 'Planning', short: 'Plans', icon: 'planning' },
];

function useUnreadEvents(): number {
  const frame = useFrame();
  const panel = useStore(ui, (s) => s.panel);
  const tick = frame?.view.tick ?? 0;
  const [seenTick, setSeenTick] = useState<number | null>(null);
  useEffect(() => {
    if (seenTick === null && frame) setSeenTick(frame.view.tick);
  }, [frame, seenTick]);
  useEffect(() => {
    if (panel === 'journal') setSeenTick(tick);
  }, [panel, tick]);
  if (!frame || seenTick === null) return 0;
  return frame.view.journal.filter((e) => !e.routine && e.at > seenTick).length;
}

export function CountryCard() {
  const frame = useFrame()!;
  const panel = useStore(ui, (s) => s.panel);
  const v = frame.view;
  const c = frame.clock;
  const { shown, target, coalition } = useVictory();
  const pct = target ? Math.max(0, Math.min(100, (shown / target) * 100)) : 0;
  const pendingOffers = v.offers.filter((o) => o.status === 'pending' && o.to === v.viewer).length;
  const research = v.self.research.length;
  const unread = useUnreadEvents();
  const realPerHour = !c.paused && c.speed ? 60 / (c.speed * SPEED_BASE) : null;
  void getHost;
  const badge = (d: Dest) =>
    d.id === 'diplomacy' && pendingOffers > 0 ? (
      <span className="qa-badge" aria-label={`${pendingOffers} offers awaiting your answer`}>{pendingOffers}</span>
    ) : d.id === 'research' && research > 0 ? (
      <span className="qa-badge info" aria-label={`${research} active research programs`}>{research}</span>
    ) : d.id === 'journal' && unread > 0 ? (
      <span className="qa-badge" aria-label={`${unread} new events`}>{unread > 99 ? '99+' : unread}</span>
    ) : null;
  return (
    <section className="hud-card" aria-label="Nation status">
      <button type="button" className="hc-nation" onClick={() => openPanel('campaign')} aria-label={`${v.self.name} — campaign information`} data-testid="nation-chip" title="Campaign information">
        <NationBadge id={v.viewer} size={44} />
        <span className="hc-name-wrap">
          <span className="hc-name">{v.self.name}</span>
          <span className="hc-sub">{v.viewer} · {coalition ? 'Coalition' : 'Solo'} campaign</span>
        </span>
      </button>
      <div className="hc-time">
        <ClockButton big />
        <span className={`hc-state${c.paused ? ' paused' : ''}`}>{c.paused ? 'Paused' : realPerHour ? `${c.speed}× · 1 h ≈ ${realPerHour < 1 ? '<1' : Math.round(realPerHour)} s` : 'Running'}</span>
      </div>
      <button type="button" className="hc-victory" onClick={() => openPanel('score')} aria-label={`Score ${shown} of ${target} victory points — open standings`} data-testid="score-button" title="Standings (V)">
        <span className="hc-vrow">
          <span className="hc-vlbl">Victory progress</span>
          <span className="hc-vnum">
            <strong>{shown}</strong> / {target}
          </span>
        </span>
        <span className="hc-vbar" aria-hidden>
          <span style={{ width: `${pct}%` }} />
        </span>
      </button>
      <nav className="quick-actions" aria-label="Quick actions">
        {QUICK.map((d) => (
          <button key={d.id} type="button" className="qa" aria-current={panel === d.id ? 'page' : undefined} onClick={() => openPanel(d.id)} title={d.key ? `${d.label} (${d.key})` : d.label} data-testid={`rail-${d.id}`}>
            <Icon name={d.icon} size={22} />
            <span className="qa-lbl">{d.short}</span>
            {badge(d)}
          </button>
        ))}
      </nav>
    </section>
  );
}

export function SideTabs() {
  const panel = useStore(ui, (s) => s.panel);
  const rosterOpen = useStore(ui, (s) => s.rosterOpen);
  return (
    <nav className="side-tabs" aria-label="Destinations">
      {TABS.map((d) => (
        <button key={d.id} type="button" className="stab" aria-current={panel === d.id ? 'page' : undefined} onClick={() => openPanel(d.id)} title={d.key ? `${d.label} (${d.key})` : d.label} data-testid={`rail-${d.id}`}>
          <Icon name={d.icon} size={16} />
          <span className="stab-lbl">{d.short}</span>
        </button>
      ))}
      <button type="button" className="stab" aria-pressed={rosterOpen} onClick={() => ui.patch({ rosterOpen: !rosterOpen })} title="Show or hide the roster">
        <Icon name="roster" size={16} />
        <span className="stab-lbl">Roster</span>
      </button>
    </nav>
  );
}

/** Kept for compatibility: the desktop left HUD (nation card + side tabs). */
export function LeftRail() {
  return (
    <>
      <CountryCard />
      <SideTabs />
    </>
  );
}

const MOBILE_ICON: Partial<Record<Panel, IconName>> = {
  roster: 'roster',
  forces: 'forces',
  cities: 'cities',
  research: 'research',
  economy: 'economy',
  diplomacy: 'diplomacy',
  intel: 'intel',
  journal: 'bell',
  market: 'market',
  coalition: 'coalition',
  news: 'news',
  score: 'score',
  planning: 'planning',
};

export function MobileNav() {
  const [more, setMore] = useState(false);
  const all: { id: Panel; label: string }[] = [
    { id: 'roster', label: 'Roster' },
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
  const mode = useStore(ui, (s) => s.mode);
  // Stays visible under the inspector sheet (selection survives opening another screen); hidden
  // only while a targeting/drawing mode owns the bottom of the screen.
  if (mode.kind !== 'idle') return null;
  return (
    <nav className={`mobile-nav${more ? ' more' : ''}`} aria-label="Destinations">
      {all.slice(0, more ? all.length : 4).map((d) => (
        <button key={d.id} type="button" className="mnav" onClick={() => openPanel(d.id)} data-testid={`mnav-${d.id}`}>
          <Icon name={MOBILE_ICON[d.id] ?? 'menu'} size={18} />
          <span>{d.label}</span>
        </button>
      ))}
      <button type="button" className="mnav" aria-expanded={more} onClick={() => setMore(!more)}>
        <Icon name={more ? 'chevron-down' : 'menu'} size={18} />
        <span>{more ? 'Less' : 'More…'}</span>
      </button>
    </nav>
  );
}
