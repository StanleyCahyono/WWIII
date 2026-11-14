/**
 * Valuation helpers: unit combat power from the public catalog, resource vectors at the published
 * reference prices, and strength estimates for OBSERVED contacts only (possibly stale).
 */
import type { Resource, ResVec, UnitType } from '../engine/data-types';
import type { Catalog } from '../engine/scenario/types';
import type { ContactView, StackView } from '../engine/view/country-view';

export interface CatIndex {
  units: Map<string, UnitType>;
  price: Record<string, number>;
  /** Mean level-1 ground power of capture-capable units (prior for unidentified contacts). */
  avgGround: number;
  avgAny: number;
  /** Mean level-1 naval power of surface/subsurface combatants (prior for unidentified ships). */
  avgNaval: number;
  /** The catalog marks carrier-qualified aircraft explicitly (`carrierCapable`): only those embark. */
  carrierFlag: boolean;
  techById: Map<string, Catalog['techs'][number]>;
  buildingById: Map<string, Catalog['buildings'][number]>;
  missileById: Map<string, Catalog['missiles'][number]>;
}
const cache = new WeakMap<Catalog, CatIndex>();

export function catIndex(cat: Catalog): CatIndex {
  const c = cache.get(cat);
  if (c) return c;
  const units = new Map(cat.units.map((u) => [u.id, u]));
  const price: Record<string, number> = { money: 1 };
  for (const r of cat.resources) price[r.id] = r.referencePrice;
  const ground = cat.units.filter((u) => u.capture && u.domain === 'land');
  const avgGround = ground.length ? ground.reduce((a, u) => a + groundPower(u, 1), 0) / ground.length : 50;
  const all = cat.units.filter((u) => u.domain === 'land');
  const avgAny = all.length ? all.reduce((a, u) => a + groundPower(u, 1), 0) / all.length : 50;
  const ships = cat.units.filter((u) => (u.domain === 'sea' || u.domain === 'subsurface') && !u.carries);
  const avgNaval = ships.length ? ships.reduce((a, u) => a + navalPower(u, 1), 0) / ships.length : 50;
  const ix: CatIndex = {
    units,
    price,
    avgGround,
    avgAny,
    avgNaval,
    carrierFlag: cat.units.some((u) => u.carrierCapable === true),
    techById: new Map(cat.techs.map((t) => [t.id, t])),
    buildingById: new Map(cat.buildings.map((b) => [b.id, b])),
    missileById: new Map(cat.missiles.map((m) => [m.id, m])),
  };
  cache.set(cat, ix);
  return ix;
}

function lv(u: UnitType, level: number) {
  return u.levels.find((l) => l.level === level) ?? u.levels[Math.min(u.levels.length, Math.max(1, level)) - 1] ?? u.levels[0];
}

/** Ground combat power of one unit (attack/defense vs land target classes × HP). */
export function groundPower(u: UnitType, level: number, hpFrac = 1): number {
  const s = lv(u, level);
  if (!s) return 0;
  const atk = ((s.attack.unarmored ?? 0) + (s.attack.armored ?? 0)) / 2;
  const def = ((s.defense.unarmored ?? 0) + (s.defense.armored ?? 0)) / 2;
  return Math.max(0.1, s.hp * hpFrac * (atk + def) * 0.5 + (s.rangeKm > 0 ? atk * s.hp * 0.25 : 0));
}
export function airPower(u: UnitType, level: number, hpFrac = 1): number {
  const s = lv(u, level);
  if (!s) return 0;
  return s.hp * hpFrac * (((s.attack.airplane ?? 0) + (s.attack.helicopter ?? 0)) / 2 + (s.defense.airplane ?? 0) * 0.5);
}
export function navalPower(u: UnitType, level: number, hpFrac = 1): number {
  const s = lv(u, level);
  if (!s) return 0;
  return s.hp * hpFrac * ((s.attack.ship ?? 0) + (s.defense.ship ?? 0) + (s.attack.submarine ?? 0) * 0.5) * 0.5;
}

export function resValue(ix: CatIndex, v: ResVec | Partial<Record<Resource, number>>, milli = false): number {
  let s = 0;
  for (const k of Object.keys(v) as Resource[]) s += ((v[k] ?? 0) / (milli ? 1000 : 1)) * (ix.price[k] ?? 1);
  return s;
}

export function stackGroundPower(ix: CatIndex, s: Pick<StackView, 'units'>): number {
  let p = 0;
  for (const u of s.units) {
    const t = ix.units.get(u.type);
    if (!t || t.domain !== 'land') continue;
    p += groundPower(t, u.level, u.maxHp > 0 ? u.hp / u.maxHp : 1) * (0.5 + 0.5 * (u.readiness / 100));
  }
  return p;
}
export function stackAirPower(ix: CatIndex, s: Pick<StackView, 'units'>): number {
  let p = 0;
  for (const u of s.units) {
    const t = ix.units.get(u.type);
    if (t) p += airPower(t, u.level, u.maxHp > 0 ? u.hp / u.maxHp : 1);
  }
  return p;
}
export function canCapture(ix: CatIndex, s: Pick<StackView, 'units'>): boolean {
  return s.units.some((u) => ix.units.get(u.type)?.capture);
}

/**
 * Ground strength estimate of an observed contact. Unknown composition falls back to priors;
 * stale observations keep their last value with an age discount (the enemy may have moved).
 */
export function contactStrength(ix: CatIndex, c: ContactView): number {
  if (c.domain !== 'land' && c.domain !== 'unknown' && c.domain !== undefined) return 0;
  let p: number;
  if (c.units && c.units.length) {
    p = 0;
    for (const u of c.units) {
      const t = ix.units.get(u.type);
      p += t ? groundPower(t, 1, Math.max(0.1, (u.hpPct ?? 100) / 100)) : ix.avgGround;
    }
  } else if (typeof c.count === 'number') p = c.count * ix.avgGround;
  else p = 3 * ix.avgGround;
  const ageH = c.ageMin / 60;
  const f = ageH <= 2 ? 1 : ageH <= 12 ? 0.85 : 0.6;
  return p * f;
}

export function stackNavalPower(ix: CatIndex, s: Pick<StackView, 'units'>): number {
  let p = 0;
  for (const u of s.units) {
    const t = ix.units.get(u.type);
    if (!t || (t.domain !== 'sea' && t.domain !== 'subsurface')) continue;
    p += navalPower(t, u.level, u.maxHp > 0 ? u.hp / u.maxHp : 1);
  }
  return p;
}

/** Naval strength estimate of an observed contact (sea/subsurface), priors when composition is unknown. */
export function contactNavalStrength(ix: CatIndex, c: ContactView): number {
  if (c.domain !== 'sea' && c.domain !== 'subsurface') return 0;
  let p: number;
  if (c.units && c.units.length) {
    p = 0;
    for (const u of c.units) {
      const t = ix.units.get(u.type);
      p += t ? navalPower(t, 1, Math.max(0.1, (u.hpPct ?? 100) / 100)) : ix.avgNaval;
    }
  } else if (typeof c.count === 'number') p = c.count * ix.avgNaval;
  else p = 2 * ix.avgNaval;
  const ageH = c.ageMin / 60;
  return p * (ageH <= 2 ? 1 : ageH <= 12 ? 0.85 : 0.6);
}

/** Carrier deck capacity of a stack (sum of `carries.slots` of living carrier units) and accepted families. */
export function carrierDeck(ix: CatIndex, s: Pick<StackView, 'units'>): { slots: number; families: string[] } {
  let slots = 0;
  const fam = new Set<string>();
  for (const u of s.units) {
    const t = ix.units.get(u.type);
    if (!t?.carries || u.hp <= 0) continue;
    slots += t.carries.slots;
    for (const f of t.carries.families) fam.add(f);
  }
  return { slots, families: [...fam].sort() };
}

/**
 * Whether every unit of an air stack may embark on a carrier with these families. When the catalog
 * marks carrier-qualified aircraft (`carrierCapable`), only those embark; otherwise the family rule applies.
 */
export function carrierEligible(ix: CatIndex, s: Pick<StackView, 'units'>, families: string[]): boolean {
  if (!s.units.length) return false;
  return s.units.every((u) => {
    const t = ix.units.get(u.type);
    if (!t || t.domain !== 'air' || !families.includes(t.family)) return false;
    return ix.carrierFlag ? t.carrierCapable === true : true;
  });
}
