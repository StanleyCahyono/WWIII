/**
 * One shared formatter for building-level effect keys (catalog `BuildingLevel.effects`), so no
 * screen shows raw keys such as `productionMult: 1.1`.
 */
import { RESOURCE_LABEL } from './data/static';
import { num } from './format';
import type { Resource } from '../engine/data-types';

const NAMES: Record<string, string> = {
  productionMult: 'production',
  produces: 'flat output',
  manpowerPerDay: 'manpower/day',
  recruitSpeedMult: 'recruiting speed',
  defenseMult: 'defense',
  populationShield: 'population shelter',
  hpRecoveryPerDay: 'HP recovery/day',
  moraleDelta: 'morale',
  radarKm: 'radar range',
  radarSensitivity: 'radar sensitivity',
  airSlots: 'air slots',
  navalSlots: 'naval slots',
  researchSlots: 'research slots',
  researchSpeedMult: 'research speed',
  speedMult: 'movement speed',
  maintenanceSlots: 'maintenance slots',
  liftCapacity: 'lift capacity',
  missileSlots: 'missile slots',
};

const SLOT: Record<string, [string, string]> = {
  airSlots: ['air slot', 'air slots'],
  navalSlots: ['naval slot', 'naval slots'],
  researchSlots: ['research slot', 'research slots'],
  maintenanceSlots: ['maintenance slot', 'maintenance slots'],
  missileSlots: ['missile slot', 'missile slots'],
};

const signed = (n: number) => (n < 0 ? `−${num(Math.abs(n))}` : `+${num(n)}`);
const pctOf = (mult: number) => {
  const p = Math.round((mult - 1) * 100);
  return p < 0 ? `−${Math.abs(p)}%` : `+${p}%`;
};

/** Plain name of an effect key ("navalSlots" → "naval slots"); unknown keys are split into words. */
export function effectName(key: string): string {
  return NAMES[key] ?? key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

/** One effect as plain text, or null when it has no effect (a ×1 multiplier, a zero). */
export function effectText(key: string, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (key === 'produces' && typeof value === 'object') {
    const parts = Object.entries(value as Record<string, number>).filter(([, v]) => v).map(([r, v]) => `${num(v)} ${(RESOURCE_LABEL[r as Resource] ?? r).toLowerCase()}`);
    return parts.length ? `produces ${parts.join(', ')} per day` : null;
  }
  if (typeof value !== 'number') return `${effectName(key)}: ${String(value)}`;
  if (!value) return null;
  if (key.endsWith('Mult')) return value === 1 ? null : `${pctOf(value)} ${effectName(key)}`;
  if (SLOT[key]) return `${num(value)} ${SLOT[key][value === 1 ? 0 : 1]}`;
  switch (key) {
    case 'manpowerPerDay':
      return `${signed(value)} manpower/day`;
    case 'hpRecoveryPerDay':
      return `${signed(value)} HP recovery/day`;
    case 'moraleDelta':
      return `${signed(value)} morale`;
    case 'populationShield':
      return `${Math.round(value * 100)}% of population sheltered`;
    case 'radarKm':
      return `${num(value)} km radar range`;
    case 'radarSensitivity':
      return `radar sensitivity ${num(value)}`;
    case 'liftCapacity':
      return `${signed(value)} lift capacity`;
    default:
      return `${effectName(key)} ${num(value)}`;
  }
}

/** All effects of a building level, joined for a compact list ("+10% production · 9 naval slots"). */
export function effectsText(effects: Record<string, unknown> | null | undefined, sep = ' · '): string {
  return Object.entries(effects ?? {})
    .map(([k, v]) => effectText(k, v))
    .filter((x): x is string => !!x)
    .join(sep);
}
