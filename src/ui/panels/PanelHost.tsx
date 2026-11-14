import React, { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { ui, closePanel, backPanel, type Panel } from '../state/ui';
import { CitiesPanel } from './Cities';
import { ResearchPanel } from './Research';
import { ForcesPanel, UnitDossier } from './Forces';
import { EconomyPanel, MarketPanel } from './Economy';
import { DiplomacyPanel, CoalitionPanel } from './Diplomacy';
import { IntelPanel } from './Intel';
import { JournalPanel, NewsPanel } from './Journal';
import { ScorePanel, EndPanel, CampaignPanel } from './Score';
import { HelpPanel } from './Help';
import { PlanningPanel } from '../components/Planning';

const TITLES: Record<Panel, string> = {
  forces: 'Forces',
  economy: 'Economy',
  research: 'Research',
  diplomacy: 'Diplomacy',
  intel: 'Intelligence',
  journal: 'Journal & events',
  cities: 'Cities',
  coalition: 'Coalition',
  news: 'World newspaper',
  market: 'Market',
  score: 'Score & standings',
  planning: 'Planning layer',
  dossier: 'Unit dossier',
  help: 'Advisor & help',
  campaign: 'Campaign information',
  end: 'Campaign results',
};
const WIDE = new Set<Panel>(['research', 'cities', 'diplomacy', 'market', 'economy', 'journal', 'news', 'end', 'forces']);

export function PanelHost() {
  const panel = useStore(ui, (s) => s.panel)!;
  const arg = useStore(ui, (s) => s.panelArg);
  const hasBack = useStore(ui, (s) => s.panelStack.length > 0);
  const ref = useRef<HTMLDivElement>(null);
  const scrolls = useRef(new Map<string, number>());
  useEffect(() => {
    // focus the panel heading for screen readers / keyboard users; restore scroll position
    const el = ref.current;
    el?.querySelector<HTMLElement>('h2')?.focus();
    const c = el?.querySelector<HTMLElement>('.content');
    if (c) c.scrollTop = scrolls.current.get(panel) ?? 0;
    return () => {
      if (c) scrolls.current.set(panel, c.scrollTop);
    };
  }, [panel]);
  let body: React.ReactNode;
  switch (panel) {
    case 'cities':
      body = <CitiesPanel arg={arg as { city?: string; tab?: string; node?: number } | null} />;
      break;
    case 'research':
      body = <ResearchPanel />;
      break;
    case 'forces':
      body = <ForcesPanel />;
      break;
    case 'dossier':
      body = <UnitDossier arg={arg as { unit: string; stack?: string }} />;
      break;
    case 'economy':
      body = <EconomyPanel />;
      break;
    case 'market':
      body = <MarketPanel resource={(arg as string) ?? null} />;
      break;
    case 'diplomacy':
      body = <DiplomacyPanel arg={arg as { country?: string } | null} />;
      break;
    case 'coalition':
      body = <CoalitionPanel />;
      break;
    case 'intel':
      body = <IntelPanel arg={arg as { node?: number | null } | null} />;
      break;
    case 'journal':
      body = <JournalPanel />;
      break;
    case 'news':
      body = <NewsPanel />;
      break;
    case 'score':
      body = <ScorePanel />;
      break;
    case 'end':
      body = <EndPanel />;
      break;
    case 'campaign':
      body = <CampaignPanel />;
      break;
    case 'help':
      body = <HelpPanel />;
      break;
    case 'planning':
      body = <PlanningPanel />;
      break;
  }
  return (
    <section className={`drawer${WIDE.has(panel) ? ' wide' : ''}`} role="dialog" aria-modal="false" aria-labelledby="panel-title" ref={ref} data-testid={`panel-${panel}`} onKeyDown={(e) => {
      if (e.key === 'Escape' && !(e.target as HTMLElement).closest('.modal')) {
        e.stopPropagation();
        closePanel();
      }
    }}>
      <header>
        {hasBack && (
          <button type="button" className="btn small" onClick={backPanel} aria-label="Back to previous screen">
            ← Back
          </button>
        )}
        <h2 id="panel-title" tabIndex={-1}>
          {TITLES[panel]}
        </h2>
        <div className="grow" />
        <button type="button" className="btn" onClick={closePanel} aria-label="Close and return to map" data-testid="panel-close">
          ✕ Back to map
        </button>
      </header>
      <div className="content">{body}</div>
    </section>
  );
}
