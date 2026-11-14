/**
 * Readiness, supply condition, replacements (HP regeneration) and maintenance (refit).
 *  - supply: 'supplied' on own/coalition/passage territory (or in a friendly port); 'limited'
 *    at sea or within 2 hops of friendly territory; 'out' otherwise.
 *  - Daily: supplied & idle +READINESS_RECOVERY_PER_DAY; out −READINESS_LOSS_OUT_OF_SUPPLY_PER_DAY;
 *    essential shortage −READINESS_LOSS_SHORTAGE_PER_DAY.
 *  - HP regen daily in supplied friendly nodes: HP_REGEN_PER_DAY × max (+ hpRecoveryPerDay
 *    facilities). Refit stacks (occupying maintenance slots, capped by national capacity, oldest
 *    stacks first) regen REFIT_HP_REGEN_PER_DAY and gain REFIT_READINESS_PER_DAY but fight at
 *    REFIT_STRENGTH_MULT.
 */
import type { CountryId } from '../data-types';
import type { GameState, Stack } from '../state';
import {
  BASE_MAINTENANCE_SLOTS,
  ESSENTIAL,
  HP_REGEN_PER_DAY,
  READINESS_LOSS_OUT_OF_SUPPLY_PER_DAY,
  READINESS_LOSS_SHORTAGE_PER_DAY,
  READINESS_RECOVERY_PER_DAY,
  READY_THRESHOLD,
  REFIT_HP_REGEN_PER_DAY,
  REFIT_READINESS_PER_DAY,
} from '../rules';
import { S } from '../scenario/registry';
import { hopDistances } from './mapindex';
import { cmpId, isFriendlyTerritory, utype, sortedStacks, stacksReadonly, stacksOfOwner } from './world';
import { sumEffect } from './economy';
import { unitCost } from './production';
import { valueAt } from '../fixed';
import { derived } from '../derived';
import { cmod } from './modifiers';

export interface LiftBreakdown {
  base: number;
  buildings: number;
  units: number;
  total: number;
}
/**
 * Abstract lift capacity = profile/tech lift (CountryState.lift) + Σ building liftCapacity in owned
 * cities/provinces (scaled by condition) + Σ liftCapacity of fielded units. Computed on demand, so
 * construction, destruction and unit losses are reflected immediately.
 */
export function liftBreakdown(state: GameState, c: CountryId): LiftBreakdown {
  const all = derived(state, '@liftAll', () => {
    const bld = new Map<CountryId, number>();
    const un = new Map<CountryId, number>();
    for (const k of Object.keys(state.cities)) {
      const city = state.cities[k];
      const o = state.provinces[city.node]?.owner;
      if (o && city.buildings.length) bld.set(o, (bld.get(o) ?? 0) + sumEffect(state, city.buildings, 'liftCapacity'));
    }
    for (const p of state.provinces) if (p && p.owner && p.buildings.length) bld.set(p.owner, (bld.get(p.owner) ?? 0) + sumEffect(state, p.buildings, 'liftCapacity'));
    for (const s of stacksReadonly(state)) for (const u of s.units) {
      const l = u.hp > 0 ? utype(state, u.type).liftCapacity ?? 0 : 0;
      if (l) un.set(s.owner, (un.get(s.owner) ?? 0) + l);
    }
    return { bld, un };
  });
  const base = state.countries[c]?.lift ?? 0;
  const buildings = Math.round((all.bld.get(c) ?? 0) * 100) / 100;
  const units = all.un.get(c) ?? 0;
  return { base, buildings, units, total: Math.round((base + buildings + units) * 100) / 100 };
}

export function maintenanceCapacity(state: GameState, c: CountryId): number {
  return derived(state, `~maint:${c}`, () => computeMaintenance(state, c));
}
function computeMaintenance(state: GameState, c: CountryId): number {
  let s = state.countries[c].maintenanceSlots + BASE_MAINTENANCE_SLOTS;
  for (const k of Object.keys(state.cities)) {
    const city = state.cities[k];
    if (state.provinces[city.node]?.owner === c) s += sumEffect(state, city.buildings, 'maintenanceSlots', false);
  }
  return Math.floor(s);
}

export function supplyOf(state: GameState, s: Stack, friendlyNear?: Map<number, number> | (() => Map<number, number>)): Stack['supply'] {
  const m = S(state).map;
  const node = s.pos.kind === 'node' ? s.pos.node : s.pos.kind === 'edge' ? s.pos.to : null;
  if (s.moveClass === 'air') return 'supplied';
  if (node === null) return 'limited';
  if (m.isLand[node]) {
    if (isFriendlyTerritory(state, s.owner, state.provinces[node]?.owner ?? null)) return 'supplied';
    const near = typeof friendlyNear === 'function' ? friendlyNear() : friendlyNear;
    if (near && (near.get(node) ?? 99) <= 2) return 'limited';
    return 'out';
  }
  return 'limited';
}

export function readinessDay(state: GameState): void {
  const m = S(state).map;
  const near = new Map<CountryId, Map<number, number>>();
  const friendlyNodes = (c: CountryId) => {
    let d = near.get(c);
    if (!d) {
      // isFriendlyTerritory depends only on (c, owner): evaluate it once per owner
      const fr = new Map<CountryId | null, boolean>();
      const friendly = (o: CountryId | null) => {
        let v = fr.get(o);
        if (v === undefined) {
          v = isFriendlyTerritory(state, c, o);
          fr.set(o, v);
        }
        return v;
      };
      const src = state.provinces.filter((p) => p && friendly(p.owner)).map((p) => p!.node);
      d = hopDistances(m, src, 2, () => true);
      near.set(c, d);
    }
    return d;
  };
  const used = new Map<CountryId, number>();
  for (const s of sortedStacks(state)) {
    const sup = supplyOf(state, s, s.moveClass === 'ground' ? () => friendlyNodes(s.owner) : undefined);
    s.supply = sup;
    const shortage = (state.countries[s.owner]?.shortages ?? []).some((r) => ESSENTIAL.includes(r));
    let refitOk = false;
    if (s.refit) {
      const cap = maintenanceCapacity(state, s.owner);
      const u = used.get(s.owner) ?? 0;
      if (u + s.units.length <= cap && sup === 'supplied') {
        refitOk = true;
        used.set(s.owner, u + s.units.length);
      }
    }
    const idle = !s.order;
    const node = s.pos.kind === 'node' ? s.pos.node : null;
    let facilityRegen = 0;
    if (node !== null) {
      const p = state.provinces[node];
      if (p && p.owner === s.owner) {
        facilityRegen += sumEffect(state, p.buildings, 'hpRecoveryPerDay');
        const ck = m.cityByNode.get(node);
        if (ck && state.cities[ck]) facilityRegen += sumEffect(state, state.cities[ck].buildings, 'hpRecoveryPerDay');
      }
    }
    for (const u of s.units) {
      let dr = 0;
      if (sup === 'supplied' && idle) dr += READINESS_RECOVERY_PER_DAY;
      if (refitOk) dr += REFIT_READINESS_PER_DAY * cmod(state, s.owner, 'refit_speed_mult');
      if (sup === 'out') dr -= READINESS_LOSS_OUT_OF_SUPPLY_PER_DAY;
      if (shortage) dr -= READINESS_LOSS_SHORTAGE_PER_DAY;
      u.readiness = Math.max(0, Math.min(100, u.readiness + dr));
      if (sup === 'supplied' && (s.lastCombatAt === null || state.clock.tick - s.lastCombatAt > 360)) {
        let frac = (refitOk ? REFIT_HP_REGEN_PER_DAY : HP_REGEN_PER_DAY) + facilityRegen / 100; // facility hpRecoveryPerDay is % of max HP
        if (s.moveClass === 'naval') frac *= cmod(state, s.owner, 'naval_hp_regen_mult');
        u.hp = Math.min(u.maxHp, u.hp + Math.round(u.maxHp * frac));
      }
    }
  }
}

export interface ForceSummary {
  fielded: number;
  ready: number;
  committed: number;
  inRefit: number;
  units: number;
  stacks: number;
  maintenanceUsed: number;
  maintenanceCapacity: number;
  byDomain: Record<string, { units: number; fielded: number; ready: number }>;
}

/** Fielded vs ready vs committed strength (replacement value × HP fraction). */
export function forceSummary(state: GameState, c: CountryId): ForceSummary {
  return derived(state, `@force:${c}`, () => computeForce(state, c, stacksOfOwner(state, c).filter((s) => state.stacks[s.id] === s)));
}

function computeForce(state: GameState, c: CountryId, stacks: Stack[]): ForceSummary {
  const prices = S(state).cat.prices;
  const out: ForceSummary = { fielded: 0, ready: 0, committed: 0, inRefit: 0, units: 0, stacks: 0, maintenanceUsed: 0, maintenanceCapacity: maintenanceCapacity(state, c), byDomain: {} };
  const valCache = new Map<string, number>();
  for (const s of stacks) {
    out.stacks++;
    const committed = !!s.order || !!s.engagement || (s.air !== null && s.air.state !== 'landed' && s.air.state !== 'refueling');
    for (const u of s.units) {
      const t = utype(state, u.type);
      let base = valCache.get(u.type);
      if (base === undefined) {
        base = valueAt(unitCost(state, c, t), prices);
        valCache.set(u.type, base);
      }
      const v = base * (u.hp / u.maxHp);
      out.units++;
      out.fielded += v;
      const isReady = u.readiness >= READY_THRESHOLD && !s.refit && u.hp / u.maxHp >= 0.5;
      if (isReady) out.ready += v;
      if (committed) out.committed += v;
      if (s.refit) { out.inRefit += v; out.maintenanceUsed++; }
      const d = (out.byDomain[t.domain] ??= { units: 0, fielded: 0, ready: 0 });
      d.units++;
      d.fielded += v;
      if (isReady) d.ready += v;
    }
  }
  out.fielded = Math.round(out.fielded);
  out.ready = Math.round(out.ready);
  out.committed = Math.round(out.committed);
  out.inRefit = Math.round(out.inRefit);
  return out;
}
