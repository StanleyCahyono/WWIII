/**
 * World Command icon set — original inline SVG artwork (no external assets, works offline).
 *
 * Stable API (shared by the HUD, the map chrome and the panels):
 *   <Icon name="fuel" size={20} />            one icon, 24×24 artboard scaled to `size`
 *   <UnitArt family="armor" size={120} />      large unit-class illustration for cards
 *   RESOURCE_ICON[resource], familyIcon(f)     lookups
 *
 * Two kinds of glyph:
 *  • line icons (UI, panels, actions) — stroke = currentColor, inherit the text colour;
 *  • filled icons (resources, unit classes) — tinted through CSS custom properties
 *    (`--ic-<name>`; defaults below, overridden by theme.css for light / monochrome themes).
 */
import React from 'react';
import type { Resource, UnitFamily } from '../engine/data-types';

export type ResourceIconName = 'supplies' | 'components' | 'fuel' | 'electronics' | 'rare' | 'manpower' | 'money';
export type UnitIconName =
  | 'unit-infantry'
  | 'unit-armor'
  | 'unit-support'
  | 'unit-air_defense'
  | 'unit-recon'
  | 'unit-helicopter'
  | 'unit-fighter'
  | 'unit-heavy'
  | 'unit-naval'
  | 'unit-submarine'
  | 'unit-missile_launcher'
  | 'unit-officer'
  | 'unit-deployable';
export type ActionIconName =
  | 'move'
  | 'attack'
  | 'patrol'
  | 'stop'
  | 'retreat'
  | 'embark'
  | 'disembark'
  | 'delay'
  | 'rebase'
  | 'split'
  | 'merge'
  | 'launch'
  | 'airmobile'
  | 'build'
  | 'mobilize'
  | 'inspect'
  | 'locate';
export type UiIconName =
  | 'map'
  | 'forces'
  | 'economy'
  | 'research'
  | 'diplomacy'
  | 'intel'
  | 'journal'
  | 'cities'
  | 'coalition'
  | 'news'
  | 'events'
  | 'market'
  | 'score'
  | 'help'
  | 'planning'
  | 'layers'
  | 'home'
  | 'plus'
  | 'minus'
  | 'target'
  | 'pause'
  | 'play'
  | 'step'
  | 'skip'
  | 'save'
  | 'roster'
  | 'close'
  | 'search'
  | 'legend'
  | 'menu'
  | 'fullscreen'
  | 'exit-fullscreen'
  | 'settings'
  | 'bell'
  | 'alert'
  | 'clock'
  | 'shield'
  | 'sword'
  | 'flag'
  | 'globe'
  | 'dice'
  | 'check'
  | 'back'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-up'
  | 'chevron-down'
  | 'star'
  | 'hp'
  | 'speed'
  | 'symbols'
  | 'city'
  | 'capital'
  | 'port';
export type IconName = ResourceIconName | UnitIconName | ActionIconName | UiIconName;

export const RESOURCE_ICON: Record<Resource, ResourceIconName> = {
  supplies: 'supplies',
  components: 'components',
  fuel: 'fuel',
  electronics: 'electronics',
  rare: 'rare',
  manpower: 'manpower',
  money: 'money',
};

export function familyIcon(f: UnitFamily | string | null | undefined): UnitIconName {
  const k = `unit-${f ?? 'infantry'}`;
  return (k in FILLED ? k : 'unit-infantry') as UnitIconName;
}

/* ───────── helpers ───────── */

const tint = (name: string, fallback: string): React.CSSProperties => ({ fill: `var(--ic-${name}, ${fallback})` });
const shade: React.CSSProperties = { fill: 'rgba(0,0,0,0.28)' };
const light: React.CSSProperties = { fill: 'rgba(255,255,255,0.32)' };

/** Gear outline (precomputed once; UI-only geometry). */
function gearPath(cx: number, cy: number, rOuter: number, rInner: number, teeth: number): string {
  const pts: string[] = [];
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    const seq: [number, number][] = [
      [a - step * 0.36, rInner],
      [a - step * 0.2, rOuter],
      [a + step * 0.2, rOuter],
      [a + step * 0.36, rInner],
    ];
    for (const [ang, r] of seq) pts.push(`${(cx + Math.cos(ang) * r).toFixed(2)} ${(cy + Math.sin(ang) * r).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}
const GEAR = gearPath(12, 12, 10, 7.6, 9);

/* ───────── filled icons: resources + unit classes ───────── */

const FILLED: Record<string, React.ReactNode> = {
  supplies: (
    <>
      <path d="M2.5 8.5 12 4l9.5 4.5v10L12 23l-9.5-4.5z" style={tint('supplies', '#c99d5b')} />
      <path d="M12 13v10l9.5-4.5v-10z" style={shade} />
      <path d="M2.5 8.5 12 13l9.5-4.5L12 4z" style={light} />
      <path d="M7 6.3l9.6 4.5v3.4l-2 1v-3.4L5 7.3z" style={{ fill: 'rgba(60,35,10,0.45)' }} />
    </>
  ),
  components: (
    <>
      <path d={GEAR} style={tint('components', '#a9bccf')} />
      <circle cx="12" cy="12" r="5" style={shade} />
      <circle cx="12" cy="12" r="2.6" style={tint('components', '#a9bccf')} />
    </>
  ),
  fuel: (
    <>
      <path d="M5 6.5 8 3.5h9.5L20 6v15.5H5z" style={tint('fuel', '#e5803e')} />
      <path d="M9 3.5h6v3H9z" style={shade} />
      <path d="M3 4h4.5v2.5H3z" style={tint('fuel', '#e5803e')} />
      <path d="M8.2 10.2 16.8 18.8M16.8 10.2 8.2 18.8" stroke="rgba(0,0,0,0.32)" strokeWidth="2" fill="none" />
      <path d="M5 6.5h15v2H5z" style={light} />
    </>
  ),
  electronics: (
    <>
      <path d="M8 2.5v3M12 2.5v3M16 2.5v3M8 18.5v3M12 18.5v3M16 18.5v3M2.5 8h3M2.5 12h3M2.5 16h3M18.5 8h3M18.5 12h3M18.5 16h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" opacity="0.75" />
      <rect x="5" y="5" width="14" height="14" rx="2" style={tint('electronics', '#36c1a0')} />
      <rect x="8.5" y="8.5" width="7" height="7" rx="1" style={shade} />
      <path d="M5 5h14v3H5z" style={light} />
    </>
  ),
  rare: (
    <>
      <path d="M12 1.8 19.5 8 12 22.2 4.5 8z" style={tint('rare', '#ad86f5')} />
      <path d="M12 1.8 19.5 8H12z" style={light} />
      <path d="M12 8h7.5L12 22.2z" style={shade} />
      <path d="M4.5 8 12 1.8V8z" style={{ fill: 'rgba(255,255,255,0.15)' }} />
    </>
  ),
  manpower: (
    <>
      <path d="M3.5 15.5C3.5 9 7.2 5 12 5s8.5 4 8.5 10.5z" style={tint('manpower', '#8fb35a')} />
      <path d="M12 5c4.8 0 8.5 4 8.5 10.5H15C15 9.5 13.8 6.5 12 5z" style={shade} />
      <path d="M1.5 15.5h21v2.6c0 .5-.4.9-.9.9H2.4c-.5 0-.9-.4-.9-.9z" style={tint('manpower', '#8fb35a')} />
      <path d="M1.5 17.2h21v.9c0 .5-.4.9-.9.9H2.4c-.5 0-.9-.4-.9-.9z" style={shade} />
      <path d="M7 9.5c1.2-2 2.8-3 4.5-3.3" stroke="rgba(255,255,255,0.4)" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </>
  ),
  money: (
    <>
      <rect x="1.5" y="6" width="21" height="12.5" rx="1.6" style={tint('money', '#d9bf4a')} />
      <rect x="3.6" y="8" width="16.8" height="8.5" rx="1" style={{ fill: 'none', stroke: 'rgba(0,0,0,0.3)', strokeWidth: 1 }} />
      <circle cx="12" cy="12.25" r="2.9" style={shade} />
      <path d="M12 10.6v3.3M11 11.3h1.6a.8.8 0 010 1.6h-1.2a.8.8 0 000 1.6H13" stroke="rgba(255,255,255,0.75)" strokeWidth="0.9" fill="none" strokeLinecap="round" />
    </>
  ),

  /* unit classes — side or plan silhouettes, tinted by --ic-unit (owner colour on cards) */
  'unit-infantry': (
    <g style={tint('unit', '#d7dee6')}>
      <circle cx="9.5" cy="4.6" r="2.4" />
      <path d="M6.6 3.9c.5-1.8 1.7-2.6 3-2.6 1.6 0 2.8 1 3 2.6z" style={shade} />
      <path d="M7 8h5.2l1.4 5.6-1.8.4-.6-2.4-.4 3.4.9 8H9.6l-.6-6-.6 6H6.3l.9-8L6.6 11l-.9 3.2-1.8-.5L5.4 9z" />
      <path d="m12.4 9.3 8.6-5 .6 1-8.6 5z" />
      <path d="m16.9 6.6.9 1.6-1 .6-.9-1.6z" />
    </g>
  ),
  'unit-armor': (
    <g style={tint('unit', '#d7dee6')}>
      <path d="M1.8 14.2h20.4l-2.3 3.6H4.1z" />
      <path d="M6.2 10.2h8.4l1.6 4H5z" />
      <path d="M15.4 11.4h7.2v1.3h-7.2z" />
      <path d="M8 8.7h3.4v1.5H8z" />
      <path d="M3.4 18.4h17.2a2.3 2.3 0 010 4.6H3.4a2.3 2.3 0 010-4.6z" style={shade} />
      <circle cx="5" cy="20.7" r="1.2" />
      <circle cx="9.3" cy="20.7" r="1.2" />
      <circle cx="13.6" cy="20.7" r="1.2" />
      <circle cx="18" cy="20.7" r="1.2" />
    </g>
  ),
  'unit-support': (
    <g style={tint('unit', '#d7dee6')}>
      <path d="m6.5 13.8 14-9.6 1.1 1.6-14 9.6z" />
      <path d="M4.5 12.8h7l1 4h-9z" />
      <path d="m3.5 16.4-2.6 4.3 1.3.8 3.1-4.4zM12 16.5l3.2 4 1.2-.9-2.8-4.1z" />
      <circle cx="8" cy="18.6" r="3.4" />
      <circle cx="8" cy="18.6" r="1.3" style={shade} />
    </g>
  ),
  'unit-air_defense': (
    <g style={tint('unit', '#d7dee6')}>
      <path d="M1.5 16h14.5v3.2H1.5zM16 13.2h3.6l2.9 3v3h-6.5z" />
      <circle cx="4.6" cy="20.3" r="1.7" />
      <circle cx="10" cy="20.3" r="1.7" />
      <circle cx="18.8" cy="20.3" r="1.7" />
      <path d="m3.2 14.2 9.2-9.7 1.6 1.5-9.2 9.7z" />
      <path d="m6.4 15.3 9.2-9.7 1.6 1.5-9.2 9.7z" />
      <path d="m12.4 4.5 2.3-1.6-.7 3.1zM15.6 5.6l2.3-1.6-.7 3.1z" style={shade} />
    </g>
  ),
  'unit-recon': (
    <g style={tint('unit', '#d7dee6')}>
      <path d="M2 13.5 5 9h8.5l3 4.5H22v4.3H2z" />
      <path d="M6 10.2h3.4v3H5z" style={light} />
      <path d="M10.3 10.2h2.7l2 3h-4.7z" style={light} />
      <path d="M14.2 3.2h1.2v6h-1.2z" />
      <circle cx="14.8" cy="3" r="1.3" />
      <circle cx="6.4" cy="18.4" r="2.6" />
      <circle cx="17.4" cy="18.4" r="2.6" />
      <circle cx="6.4" cy="18.4" r="1" style={shade} />
      <circle cx="17.4" cy="18.4" r="1" style={shade} />
    </g>
  ),
  'unit-helicopter': (
    <g style={tint('unit', '#d7dee6')}>
      <path d="M1.5 5.3h21v1.4h-21z" />
      <path d="M11.4 6.7h1.4v2.2h-1.4z" />
      <path d="M6.6 9h8.6c2.7 0 4.3 1.6 4.3 3.8 0 2.1-1.7 3.4-4.1 3.4H8.3c-2.6 0-3.9-1.5-3.9-3.4 0-2.2.8-3.8 2.2-3.8z" />
      <path d="M15.4 10.2c1.6.2 2.6 1.1 2.8 2.3h-2.8z" style={light} />
      <path d="M4.6 11.4H.8l-.3-2h1.2l1.3 1.1h1.6z" />
      <path d="M7.4 16.2h1.3l-.4 2h7.5l-.4-2h1.3l.4 2h2.1v1.3H4.5v-1.3h2.5z" />
    </g>
  ),
  'unit-fighter': (
    <g style={tint('unit', '#d7dee6')}>
      <path d="M12 1.2c.8 1 1.2 2.6 1.3 4.7l.2 3.6 8.5 6.4v2.3l-8.7-3.1-.4 4.4 3 2.3v1.6L12 22.2l-3.9 1.2v-1.6l3-2.3-.4-4.4-8.7 3.1v-2.3l8.5-6.4.2-3.6c.1-2.1.5-3.7 1.3-4.7z" />
      <path d="M12 3.4c.5.7.7 1.6.7 2.6h-1.4c0-1 .2-1.9.7-2.6z" style={shade} />
    </g>
  ),
  'unit-heavy': (
    <g style={tint('unit', '#d7dee6')}>
      <path d="M12 1.5c.9 0 1.4 1.3 1.4 3.3v3.6L23 13.6v2.2l-9.6-3.2-.3 5.8 3.6 2.4v1.6L12 21.3l-4.7 1.1v-1.6l3.6-2.4-.3-5.8L1 15.8v-2.2l9.6-5.2V4.8c0-2 .5-3.3 1.4-3.3z" />
      <path d="M5.3 12.3h1.8v2.2H5.3zM16.9 12.3h1.8v2.2h-1.8z" style={shade} />
    </g>
  ),
  'unit-naval': (
    <g style={tint('unit', '#d7dee6')}>
      <path d="M1 14.5h22l-3.4 5.3H4.2z" />
      <path d="M6.5 11h9v3.5h-9z" />
      <path d="M9 7.2h4.4V11H9z" />
      <path d="M10.6 2.8h1.2v4.4h-1.2zM8.7 4h5v1h-5z" />
      <path d="M15.5 12.2h5.2v1.1h-5.2zM2.6 12.6h3.9v1.1H2.6z" />
      <path d="M4.2 19.8 1 14.5h22l-.9 1.4H2.8l2.5 3.9z" style={shade} />
      <path d="M7.5 12h1.6v1.2H7.5zM10.2 12h1.6v1.2h-1.6zM12.9 12h1.6v1.2h-1.6z" style={light} />
    </g>
  ),
  'unit-submarine': (
    <g style={tint('unit', '#d7dee6')}>
      <path d="M2 14c0-2.2 3.8-3.6 10-3.6 5.4 0 9.6 1.3 10 3.6-.4 2.3-4.6 3.6-10 3.6-6.2 0-10-1.4-10-3.6z" />
      <path d="M9.2 6.5h4.4l.8 4.2H8.5z" />
      <path d="M10.8 3.5h.9v3h-.9z" />
      <path d="M2 14c0 2.2 3.8 3.6 10 3.6 5.4 0 9.6-1.3 10-3.6z" style={shade} />
      <path d="M22 11.2v5.6l-1.6-2.8z" />
    </g>
  ),
  'unit-missile_launcher': (
    <g style={tint('unit', '#d7dee6')}>
      <path d="M1.5 15.8h14v3.3h-14zM15.5 12.8h4l3 3.1v3.2h-7z" />
      <path d="M16.6 13.8h2.5l1.9 2h-4.4z" style={light} />
      <circle cx="4.4" cy="20.3" r="1.7" />
      <circle cx="9" cy="20.3" r="1.7" />
      <circle cx="18.8" cy="20.3" r="1.7" />
      <path d="M2.3 14.6 15.6 7.7l.9 1.8-13.3 6.9z" />
      <path d="m15.6 7.7 3.2-1-2.3 2.8z" />
      <path d="M2.3 14.6 4.6 13.4l.9 1.8-2.3 1.2z" style={shade} />
    </g>
  ),
  'unit-officer': (
    <g style={tint('unit', '#d7dee6')}>
      <path d="m12 1.8 2.4 5 5.4.7-4 3.8 1 5.4L12 14.1l-4.8 2.6 1-5.4-4-3.8 5.4-.7z" />
      <path d="M4 17.2 12 21l8-3.8v2.6L12 23.6l-8-3.8z" />
    </g>
  ),
  'unit-deployable': (
    <g style={tint('unit', '#d7dee6')}>
      <path d="M8.3 9.9 4.6 6.2l1.6-1.6 3.7 3.7zM15.7 9.9l3.7-3.7-1.6-1.6-3.7 3.7zM8.3 14.1l-3.7 3.7 1.6 1.6 3.7-3.7zM15.7 14.1l3.7 3.7-1.6 1.6-3.7-3.7z" />
      <rect x="8.2" y="8.2" width="7.6" height="7.6" rx="1.6" />
      <circle cx="12" cy="12" r="1.7" style={shade} />
      <ellipse cx="5.4" cy="5.4" rx="3.6" ry="1.1" />
      <ellipse cx="18.6" cy="5.4" rx="3.6" ry="1.1" />
      <ellipse cx="5.4" cy="18.6" rx="3.6" ry="1.1" />
      <ellipse cx="18.6" cy="18.6" rx="3.6" ry="1.1" />
    </g>
  ),
};

/* ───────── line icons ───────── */

const LINE: Record<string, React.ReactNode> = {
  map: <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14" />,
  forces: <path d="M12 3l8 3v6c0 4.5-3.4 7.8-8 9-4.6-1.2-8-4.5-8-9V6zM8.5 12.5l2.5 2.5 4.5-5" />,
  economy: <path d="M4 20V11M10 20V5M16 20v-6M22 20H2M3 9l6-4 6 5 6-6" />,
  research: <path d="M9 3h6M10 3v6l-5 9a2 2 0 002 3h10a2 2 0 002-3l-5-9V3M7.5 14h9" />,
  diplomacy: <path d="M3 12l4-4 5 3 5-3 4 4-9 7zM7 8V5M17 8V5M9.5 14.5l2 1.6M12 12.8l2 1.6" />,
  intel: <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z" />,
  journal: <path d="M5 3h12l2 2v16H5zM8 8h8M8 12h8M8 16h5" />,
  cities: <path d="M3 21V9l5-3v15M8 21V4l7 3v14M15 21V11l6 2v8M2 21h20M11 10h1M11 13h1M11 16h1" />,
  coalition: <path d="M8 11a3 3 0 100-6 3 3 0 000 6zM16 11a3 3 0 100-6 3 3 0 000 6zM2 20c0-3 3-5 6-5s6 2 6 5M12 20c0-3 2-5 4-5s6 2 6 5" />,
  news: <path d="M4 5h13v14H6a2 2 0 01-2-2zM17 8h3v9a2 2 0 01-2 2M7 9h7M7 12h7M7 15h4" />,
  events: <path d="M6 16V11a6 6 0 0112 0v5l2 2H4zM10 21h4" />,
  bell: <path d="M6 16V11a6 6 0 0112 0v5l2 2H4zM10 21h4" />,
  market: <path d="M3 10l2-6h14l2 6M4 10v10h16V10M3 10h18M9 20v-6h6v6" />,
  score: <path d="M6 4h12v4a6 6 0 01-12 0zM12 14v4M8 21h8M6 6H3a3 3 0 003 4M18 6h3a3 3 0 01-3 4" />,
  help: <path d="M12 21a9 9 0 100-18 9 9 0 000 18zM9.5 9a2.5 2.5 0 015 0c0 2-2.5 2-2.5 4M12 17h.01" />,
  planning: <path d="M4 20l4-1 11-11-3-3L5 16zM14 6l3 3" />,
  layers: <path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5" />,
  home: <path d="M3 11l9-8 9 8v10H3zM9 21v-6h6v6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  target: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M12 9a3 3 0 100 6 3 3 0 000-6z" />,
  pause: <path d="M8 5v14M16 5v14" strokeWidth="3" />,
  play: <path d="M7 4l13 8-13 8z" fill="currentColor" />,
  step: <path d="M5 4l10 8-10 8zM18 4v16" />,
  skip: <path d="M3 4l8 8-8 8zM12 4l8 8-8 8z" />,
  save: <path d="M5 3h11l3 3v15H5zM8 3v6h8V3M8 21v-7h8v7" />,
  roster: <path d="M4 6h16M4 12h16M4 18h10" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  search: <path d="M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-5-5" />,
  legend: <path d="M4 5h4v4H4zM4 15h4v4H4zM11 7h9M11 17h9" />,
  menu: <path d="M3 6h18M3 12h18M3 18h18" />,
  fullscreen: <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />,
  'exit-fullscreen': <path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
      <circle cx="12" cy="12" r="6.5" />
    </>
  ),
  alert: <path d="M12 3l10 18H2zM12 10v5M12 18h.01" />,
  clock: <path d="M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2" />,
  shield: <path d="M12 3l8 3v6c0 4.5-3.4 7.8-8 9-4.6-1.2-8-4.5-8-9V6z" />,
  sword: <path d="M14.5 3H21v6.5L10 20.5 3.5 14zM6.5 17l-3 3M5 12.5l6.5 6.5" />,
  flag: <path d="M5 21V4M5 4h11l-2 4 2 4H5" />,
  globe: <path d="M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z" />,
  dice: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <circle cx="8.2" cy="8.2" r="1.1" fill="currentColor" />
      <circle cx="15.8" cy="8.2" r="1.1" fill="currentColor" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" />
      <circle cx="8.2" cy="15.8" r="1.1" fill="currentColor" />
      <circle cx="15.8" cy="15.8" r="1.1" fill="currentColor" />
    </>
  ),
  check: <path d="M4 12.5l5 5L20 6.5" />,
  back: <path d="M10 5l-7 7 7 7M3 12h18" />,
  'chevron-left': <path d="M15 5l-7 7 7 7" />,
  'chevron-right': <path d="M9 5l7 7-7 7" />,
  'chevron-up': <path d="M5 15l7-7 7 7" />,
  'chevron-down': <path d="M5 9l7 7 7-7" />,
  star: <path d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z" />,
  hp: <path d="M12 20s-8-4.8-8-10.2A4.3 4.3 0 0112 7.6a4.3 4.3 0 018 2.2C20 15.2 12 20 12 20z" />,
  speed: <path d="M4 17a8 8 0 1116 0M12 17l4-6M2 17h3M19 17h3" />,
  symbols: <path d="M3 7h12v10H3zM3 7l12 10M15 7L3 17M18 9l3 3-3 3" />,
  city: <path d="M4 21V10l5-3v14M9 21V5h7v16M16 21v-9h4v9M2 21h20" />,
  capital: <path d="M12 3l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 15.3l-4.8 2.6.9-5.4-3.9-3.8 5.4-.8zM5 21h14" />,
  port: <path d="M12 3a2 2 0 100 4 2 2 0 000-4zM12 7v14M8 10h8M4 14c0 4 3.5 7 8 7s8-3 8-7M4 14l-1.5 1.5M20 14l1.5 1.5" />,

  /* actions */
  move: <path d="M4 18c3-6 7-9 13-10M13 4l5 4-4 5" />,
  attack: (
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2v6M12 16v6M2 12h6M16 12h6" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" />
    </>
  ),
  patrol: <path d="M20 12a8 8 0 11-3-6.2M20 4v5h-5" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="1.5" />,
  retreat: <path d="M20 18c-3-6-7-9-13-10M11 4L6 8l4 5" />,
  embark: <path d="M12 3v11M8 10l4 4 4-4M3 17c3 2 6 2 9 0s6-2 9 0M3 21c3 2 6 2 9 0s6-2 9 0" />,
  disembark: <path d="M12 14V3M8 7l4-4 4 4M3 17c3 2 6 2 9 0s6-2 9 0M3 21c3 2 6 2 9 0s6-2 9 0" />,
  delay: <path d="M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9" />,
  rebase: <path d="M3 15l7-1.5L14 4l2 1-2 8 6-1 1 2-17 4zM3 21h18" />,
  split: <path d="M12 21v-8M12 13L5 5M12 13l7-8M5 5v4M5 5h4M19 5v4M19 5h-4" />,
  merge: <path d="M12 3v8M12 11l-7 8M12 11l7 8M9 6l3-3 3 3" />,
  launch: <path d="M12 2c3 2.5 4 6 4 10l-1.5 4h-5L8 12c0-4 1-7.5 4-10zM9.5 16 7 21l3.5-2M14.5 16l2.5 5-3.5-2M12 9.5h.01" />,
  airmobile: <path d="M2 5h20M12 5v3M6 8h10c2.5 0 4 1.5 4 3.5S18.5 15 16 15H8c-2 0-3-1.3-3-3.5S5.5 8 6 8zM5 11H1M8 15l-1 3h10l-1-3" />,
  build: <path d="M3 21h18M5 21V11h14v10M9 21v-5h6v5M3 11l9-7 9 7" />,
  mobilize: <path d="M12 5v14M5 12h14M4 4h4M4 4v4M20 20h-4M20 20v-4" />,
  inspect: <path d="M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-5-5M11 8v6M8 11h6" />,
  locate: <path d="M12 21s7-6.2 7-11.5a7 7 0 00-14 0C5 14.8 12 21 12 21zM12 7a2.5 2.5 0 100 5 2.5 2.5 0 000-5z" />,
};

export function hasIcon(name: string): name is IconName {
  return name in FILLED || name in LINE;
}

/**
 * One icon. Decorative by default (`aria-hidden`); pass `title` to make it an image with a name.
 * Unknown names fall back to the help glyph rather than throwing (older call sites pass strings).
 */
export function Icon({ name, size = 18, title, className }: { name: IconName | (string & {}); size?: number; title?: string; className?: string }) {
  const filled = FILLED[name];
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true as const };
  if (filled)
    return (
      <svg className={`ico ico-fill${className ? ' ' + className : ''}`} width={size} height={size} viewBox="0 0 24 24" {...a11y} data-icon={name}>
        {filled}
      </svg>
    );
  return (
    <svg className={`ico${className ? ' ' + className : ''}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...a11y} data-icon={name}>
      {LINE[name] ?? LINE.help}
    </svg>
  );
}

/**
 * Large unit-class illustration for cards and dossiers: the class silhouette on a tinted plate
 * with a horizon line. `color` tints the silhouette (owner colour); decorative.
 */
export function UnitArt({ family, size = 112, color }: { family: UnitFamily | string | null | undefined; size?: number; color?: string }) {
  const name = familyIcon(family);
  const sea = family === 'naval' || family === 'submarine';
  const air = family === 'fighter' || family === 'heavy' || family === 'helicopter';
  return (
    <span className={`unit-art${sea ? ' sea' : air ? ' air' : ' land'}`} style={{ width: size, height: size * 0.72, ...(color ? ({ '--ic-unit': color } as React.CSSProperties) : {}) }} aria-hidden="true">
      <Icon name={name} size={Math.round(size * 0.62)} />
    </span>
  );
}
