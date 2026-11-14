/**
 * Panel-only artwork (original inline SVG, offline): building glyphs, morale faces, the lock and
 * info marks, and the unit-class tab definitions shared by the city window and the research tree.
 * Resource and unit-class glyphs come from the shared `../icons` module.
 */
import React from 'react';
import { Icon, familyIcon } from '../icons';
import type { UnitType } from '../../engine/data-types';

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const BUILDING: Record<string, React.ReactNode> = {
  arms_industry: <path d="M3 21V11l5 3V11l5 3V8l4-2v15M3 21h18M17 6V3h3v18M7 18h2M12 18h2" />,
  recruiting_office: <path d="M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M18.5 8v6M15.5 11h6" />,
  army_base: <path d="M4 21V9M4 9l7-5 7 5M4 9h14v12M20 21H2M8 21v-5h6v5M11 4V1.5l3.5 1-3.5 1" />,
  air_base: <path d="M2 21h20M6 21l2-6h8l2 6M12 3l1.6 4.4L20 9v1.6l-6.4-1L12.8 13l2 1v1.2L12 14.6l-2.8.6V14l2-1-.8-3.4L4 10.6V9l6.4-1.6z" />,
  naval_base: <path d="M12 3a2 2 0 100 4 2 2 0 000-4zM12 7v13M8.5 10.5h7M4 14c0 4 3.6 6.5 8 6.5s8-2.5 8-6.5M4 14l-1.6 1.6M20 14l1.6 1.6" />,
  bunker: <path d="M2 20h20M4 20v-5a8 8 0 0116 0v5M8.5 14.5h7M9 20v-3h6v3" />,
  hospital: <path d="M4 21V5h16v16M2 21h20M10 8h4v3h3v4h-3v3h-4v-3H7v-4h3z" />,
  radar_station: <path d="M5 13a7 7 0 0110-6.3L6.7 15A7 7 0 015 13zM10.8 10.2l5.2-5.2M16 5h.01M9 15l-2 6h10l-2-6M13.5 9.5a4 4 0 012 3" />,
  research_lab: <path d="M9 3h6M10 3v6l-5 9a2 2 0 002 3h10a2 2 0 002-3l-5-9V3M7.5 14h9" />,
  logistics_hub: <path d="M2 7h11v9H2zM13 10h4l3 3v3h-7M5.5 19a1.8 1.8 0 100-3.6 1.8 1.8 0 000 3.6zM16.5 19a1.8 1.8 0 100-3.6 1.8 1.8 0 000 3.6zM5 10h5" />,
  maintenance_depot: <path d="M14.7 6.3a4 4 0 00-5.2 5.2L3 18l3 3 6.5-6.5a4 4 0 005.2-5.2l-2.5 2.5-2.5-.5-.5-2.5z" />,
  missile_complex: <path d="M12 2c3 2.5 4 6 4 10l-1.5 4h-5L8 12c0-4 1-7.5 4-10zM9.5 16L7 21l3.5-2M14.5 16l2.5 5-3.5-2M2 21h20" />,
};

/** Line glyph for a building type (falls back to a generic block). */
export function BuildingIcon({ id, size = 18, title }: { id: string; size?: number; title?: string }) {
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true as const };
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" {...stroke} {...a11y}>
      {BUILDING[id] ?? <path d="M4 21V8l8-5 8 5v13H4zM9 21v-6h6v6" />}
    </svg>
  );
}

/** Morale face: smile ≥ 66, level 33–65, frown < 33 (the shape carries the meaning without colour). */
export function MoraleFace({ value, size = 20 }: { value: number; size?: number }) {
  const mood = value >= 66 ? 'good' : value >= 33 ? 'fair' : 'poor';
  const mouth = mood === 'good' ? 'M8 14.5c2.2 2.4 5.8 2.4 8 0' : mood === 'fair' ? 'M8.5 15.5h7' : 'M8 17c2.2-2.4 5.8-2.4 8 0';
  return (
    <svg className={`ico p-face p-face-${mood}`} width={size} height={size} viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <circle cx="12" cy="12" r="9.2" />
      <path d="M9 9.6h.01M15 9.6h.01" strokeWidth={2.6} />
      <path d={mouth} />
    </svg>
  );
}

export function LockIcon({ size = 12 }: { size?: number }) {
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <path d="M6 11h12v10H6zM8.5 11V8a3.5 3.5 0 017 0v3" />
    </svg>
  );
}

export function InfoIcon({ size = 16 }: { size?: number }) {
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5h.01" strokeWidth={2.2} />
    </svg>
  );
}

export function RallyIcon({ size = 16 }: { size?: number }) {
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <path d="M6 21V3M6 4h11l-2.5 4L17 12H6M3 21h6" />
    </svg>
  );
}

export function GearIcon({ size = 16 }: { size?: number }) {
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M5.5 18.5l1.8-1.8M16.7 7.3l1.8-1.8" />
      <circle cx="12" cy="12" r="6.6" />
    </svg>
  );
}

/** Tier pips: a small skyline whose height grows with the city tier (1–5). */
export function TierBadge({ tier, capital, port }: { tier: number; capital?: boolean; port?: boolean }) {
  const bars = [0, 1, 2, 3, 4];
  return (
    <span className="p-tier" title={`Tier ${tier}${capital ? ', capital' : ''}${port ? ', port' : ''}`}>
      <svg width="30" height="22" viewBox="0 0 30 22" aria-hidden="true">
        {bars.map((i) => (
          <rect key={i} x={1 + i * 6} y={20 - (4 + i * 3.6)} width={4.4} height={4 + i * 3.6} rx={0.8} className={i < tier ? 'on' : 'off'} />
        ))}
      </svg>
      <span className="p-tier-n">T{tier}</span>
      {capital && <span className="p-tier-mark" aria-hidden="true"><Icon name="capital" size={12} /></span>}
      {port && <span className="p-tier-mark" aria-hidden="true"><Icon name="port" size={12} /></span>}
    </span>
  );
}

// ───────── unit classes (tabs in the city window and research tree) ─────────

export type UnitClass = 'infantry' | 'armor' | 'support' | 'air_defense' | 'helicopter' | 'fighter' | 'heavy' | 'naval' | 'submarine' | 'missiles' | 'special';

export const UNIT_CLASSES: { key: UnitClass; label: string; short: string; icon: string }[] = [
  { key: 'infantry', label: 'Infantry', short: 'Infantry', icon: familyIcon('infantry') },
  { key: 'armor', label: 'Armour & scouts', short: 'Armour', icon: familyIcon('armor') },
  { key: 'support', label: 'Artillery & support', short: 'Artillery', icon: familyIcon('support') },
  { key: 'air_defense', label: 'Air defence', short: 'Air def.', icon: familyIcon('air_defense') },
  { key: 'helicopter', label: 'Helicopters', short: 'Helos', icon: familyIcon('helicopter') },
  { key: 'fighter', label: 'Fighters & drones', short: 'Fighters', icon: familyIcon('fighter') },
  { key: 'heavy', label: 'Bombers & heavy air', short: 'Heavy air', icon: familyIcon('heavy') },
  { key: 'naval', label: 'Surface ships', short: 'Ships', icon: familyIcon('naval') },
  { key: 'submarine', label: 'Submarines', short: 'Subs', icon: familyIcon('submarine') },
  { key: 'missiles', label: 'Missiles & strategic', short: 'Missiles', icon: familyIcon('missile_launcher') },
  { key: 'special', label: 'Officers & special', short: 'Officers', icon: familyIcon('officer') },
];

/** Which class tab a unit type belongs to (recon splits by domain: radar vehicle vs. aircraft). */
export function unitClassOf(u: Pick<UnitType, 'family' | 'domain'> | undefined): UnitClass {
  switch (u?.family) {
    case 'infantry':
      return 'infantry';
    case 'armor':
      return 'armor';
    case 'support':
      return 'support';
    case 'recon':
      return u.domain === 'air' ? 'heavy' : 'support';
    case 'air_defense':
      return 'air_defense';
    case 'helicopter':
      return 'helicopter';
    case 'fighter':
      return 'fighter';
    case 'heavy':
      return 'heavy';
    case 'naval':
      return 'naval';
    case 'submarine':
      return 'submarine';
    case 'missile_launcher':
      return 'missiles';
    default:
      return 'special';
  }
}

/** Unit illustration: the class silhouette on a tinted plate (land / air / sea backdrop). */
export function UnitPlate({ family, size = 56 }: { family: string | undefined; size?: number }) {
  const sea = family === 'naval' || family === 'submarine';
  const air = family === 'fighter' || family === 'heavy' || family === 'helicopter';
  return (
    <span className={`p-plate ${sea ? 'sea' : air ? 'air' : 'land'}`} style={{ width: size, height: Math.round(size * 0.74) }} aria-hidden="true">
      <Icon name={familyIcon(family)} size={Math.round(size * 0.66)} />
    </span>
  );
}

export function BuildingPlate({ id, size = 56 }: { id: string; size?: number }) {
  return (
    <span className="p-plate bld" style={{ width: size, height: Math.round(size * 0.74) }} aria-hidden="true">
      <BuildingIcon id={id} size={Math.round(size * 0.5)} />
    </span>
  );
}
