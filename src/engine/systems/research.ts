/**
 * Research: slots, day gates, prerequisites, doctrine overrides, costs, completion effects.
 *
 * Slots = RESEARCH_BASE_SLOTS + Σ researchSlots of buildings in owned homeland/annexed cities.
 * Duration = hours × doctrine hoursMult ÷ ((1 + Σ (researchSpeedMult − 1)) × research_speed_mult).
 * Cancel refund = floor(cost × remaining fraction × RESEARCH_CANCEL_REFUND_FACTOR), quoted exactly.
 * UPGRADE RULE: completing a `unitLevel` tech raises every existing unit of that type owned by the
 * country to the new level (HP scaled proportionally) and all future mobilizations use it.
 * Applied once, from the single scheduled completion event.
 */
import type { CountryId, TechId, TechNode } from '../data-types';
import type { GameState } from '../state';
import { RESEARCH_BASE_SLOTS, RESEARCH_CANCEL_REFUND_FACTOR } from '../rules';
import { S, unitStats } from '../scenario/registry';
import { geq, mul, type ResM, shortfall, vecFromWhole } from '../fixed';
import { charge, credit } from './ledger';
import { schedule, unschedule } from './queue';
import { awardXp, emit, toAll } from './events';
import { sumEffect, multEffect, bumpEconomyCountry } from './economy';
import { applyModifier, cmod } from './modifiers';
import { dayOf } from '../time';
import { derived } from '../derived';
import { territoryOf } from './world';

export type TechStatus =
  | 'completed'
  | 'busy'
  | 'available'
  | 'time_locked'
  | 'prerequisite_locked'
  | 'facility_locked'
  | 'doctrine_unavailable'
  | 'unaffordable'
  | 'slots_full';

export interface TechStatusInfo {
  tech: TechId;
  status: TechStatus;
  reason: string;
  cost: ResM;
  durationMin: number;
  dayAvailable: number;
  missingPrereqs: TechId[];
  shortfall: Partial<ResM>;
  progress: number;
  endsAt: number | null;
}

function ownedResearchCities(state: GameState, c: CountryId) {
  return territoryOf(state, c).cities.map((k) => state.cities[k]).filter((ci) => state.provinces[ci.node]?.status !== 'occupied');
}
export function researchSlots(state: GameState, c: CountryId): number {
  return derived(state, `~rslots:${c}`, () => computeResearchSlots(state, c));
}
function computeResearchSlots(state: GameState, c: CountryId): number {
  let s = 0;
  for (const ci of ownedResearchCities(state, c)) s += sumEffect(state, ci.buildings, 'researchSlots', false);
  return RESEARCH_BASE_SLOTS + Math.floor(s);
}
export function researchSpeed(state: GameState, c: CountryId): number {
  return derived(state, `~rspeed:${c}`, () => computeResearchSpeed(state, c));
}
function computeResearchSpeed(state: GameState, c: CountryId): number {
  let s = 1;
  for (const ci of ownedResearchCities(state, c)) s += multEffect(state, ci.buildings, 'researchSpeedMult') - 1;
  return s * cmod(state, c, 'research_speed_mult');
}
export function labLevel(state: GameState, c: CountryId): number {
  let s = 0;
  for (const ci of ownedResearchCities(state, c)) for (const b of ci.buildings) {
    const t = S(state).cat.buildings.get(b.type);
    if (t && t.levels.some((l) => (l.effects.researchSlots ?? 0) > 0 || (l.effects.researchSpeedMult ?? 0) > 0)) s += b.level;
  }
  return s;
}

export function techTerms(state: GameState, c: CountryId, t: TechNode): { cost: ResM; durationMin: number; dayAvailable: number; unavailable: boolean } {
  const d = t.doctrine?.[state.countries[c].doctrine];
  const cost = mul(vecFromWhole(t.cost), d?.costMult ?? 1);
  const durationMin = Math.max(1, Math.round((t.hours * 60 * (d?.hoursMult ?? 1)) / researchSpeed(state, c)));
  return { cost, durationMin, dayAvailable: d?.dayAvailable ?? t.dayAvailable, unavailable: !!d?.unavailable };
}

export function techStatus(state: GameState, c: CountryId, techId: TechId): TechStatusInfo {
  const st = S(state);
  const t = st.cat.techs.get(techId);
  const cs = state.countries[c];
  if (!t) return { tech: techId, status: 'prerequisite_locked', reason: 'Unknown technology.', cost: vecFromWhole({}), durationMin: 0, dayAvailable: 0, missingPrereqs: [], shortfall: {}, progress: 0, endsAt: null };
  const terms = techTerms(state, c, t);
  const base = { tech: techId, cost: terms.cost, durationMin: terms.durationMin, dayAvailable: terms.dayAvailable, missingPrereqs: [] as TechId[], shortfall: {} as Partial<ResM>, progress: 0, endsAt: null as number | null };
  if (cs.techs[techId]) return { ...base, status: 'completed', reason: 'Completed.', progress: 1 };
  const act = cs.research.find((r) => r.tech === techId);
  if (act) return { ...base, status: 'busy', reason: 'In progress.', progress: Math.min(1, (state.clock.tick - act.startedAt) / Math.max(1, act.endsAt - act.startedAt)), endsAt: act.endsAt };
  if (terms.unavailable) return { ...base, status: 'doctrine_unavailable', reason: `Not available to ${cs.doctrine} doctrine.` };
  const missing = t.prereqs.filter((p) => !cs.techs[p]);
  if (missing.length) return { ...base, missingPrereqs: missing, status: 'prerequisite_locked', reason: `Requires ${missing.map((m) => st.cat.techs.get(m)?.name ?? m).join(', ')}.` };
  const day = dayOf(state.clock.tick);
  if (day < terms.dayAvailable) return { ...base, status: 'time_locked', reason: `Available from day ${terms.dayAvailable} (now day ${day}).` };
  if (t.requiresLabLevel && labLevel(state, c) < t.requiresLabLevel) return { ...base, status: 'facility_locked', reason: `Requires national research facility level ${t.requiresLabLevel} (have ${labLevel(state, c)}).` };
  if (cs.research.length >= researchSlots(state, c)) return { ...base, status: 'slots_full', reason: `All ${researchSlots(state, c)} research slots are busy.` };
  if (!geq(cs.stock, terms.cost)) return { ...base, status: 'unaffordable', reason: 'Insufficient resources.', shortfall: shortfall(cs.stock, terms.cost) };
  return { ...base, status: 'available', reason: 'Ready to start.' };
}

export function startResearchInternal(state: GameState, c: CountryId, techId: TechId): boolean {
  const info = techStatus(state, c, techId);
  if (info.status !== 'available') return false;
  if (!charge(state, c, 'research', info.cost)) return false;
  const now = state.clock.tick;
  state.countries[c].research.push({ tech: techId, startedAt: now, endsAt: now + info.durationMin, cost: info.cost, durationMin: info.durationMin });
  schedule(state, now + info.durationMin, 'research_done', techId, c);
  return true;
}

export function researchRefund(state: GameState, c: CountryId, techId: TechId): ResM | null {
  const r = state.countries[c].research.find((x) => x.tech === techId);
  if (!r) return null;
  const prog = Math.min(1, Math.max(0, (state.clock.tick - r.startedAt) / Math.max(1, r.endsAt - r.startedAt)));
  return mul(r.cost, (1 - prog) * RESEARCH_CANCEL_REFUND_FACTOR);
}

export function cancelResearchInternal(state: GameState, c: CountryId, techId: TechId): ResM | null {
  const refund = researchRefund(state, c, techId);
  if (!refund) return null;
  const cs = state.countries[c];
  cs.research = cs.research.filter((x) => x.tech !== techId);
  state.queue = state.queue.filter((e) => !(e.kind === 'research_done' && e.ref === techId && e.country === c));
  credit(state, c, 'refund', refund);
  return refund;
}

/** Apply a technology's effects (completion or starting tech). Idempotent per tech. */
export function grantTech(state: GameState, c: CountryId, techId: TechId, lineage: 'domestic' | 'licensed' | 'common', silentUpgrade = false): boolean {
  const cs = state.countries[c];
  if (cs.techs[techId]) return false;
  const st = S(state);
  const t = st.cat.techs.get(techId);
  cs.techs[techId] = { at: state.clock.tick, lineage };
  if (!t) return true;
  const e = t.effects;
  for (const u of e.unlockUnit ?? []) cs.unitLevels[u] = Math.max(cs.unitLevels[u] ?? 0, 1);
  for (const ul of e.unitLevel ?? []) {
    const prev = cs.unitLevels[ul.unit] ?? 1;
    if (ul.level > prev) {
      cs.unitLevels[ul.unit] = ul.level;
      state.ids.techv = (state.ids.techv ?? 0) + 1;
      const ut = st.cat.units.get(ul.unit);
      if (ut) {
        const ns = unitStats(ut, ul.level);
        const newMax = Math.round(ns.hp * 100);
        for (const id of Object.keys(state.stacks)) {
          const s = state.stacks[id];
          if (s.owner !== c) continue;
          for (const u of s.units) {
            if (u.type !== ul.unit || u.level >= ul.level) continue;
            u.hp = Math.max(1, Math.round((u.hp * newMax) / u.maxHp));
            u.maxHp = newMax;
            u.level = ul.level;
          }
        }
      }
    }
  }
  for (const mid of e.unlockMissile ?? []) cs.missiles[mid] ??= { maturity: 'prototype', ready: 0, expended: 0, produced: 0, launched: 0 };
  if (e.missileProgram) {
    const mt = st.cat.missiles.get(e.missileProgram.missile);
    const inv = (cs.missiles[e.missileProgram.missile] ??= { maturity: 'prototype', ready: 0, expended: 0, produced: 0, launched: 0 });
    if (e.missileProgram.stage === 'qualified' || (mt && !mt.qualifyTech)) {
      if (inv.maturity === 'prototype') inv.maturity = 'qualified';
    }
  }
  // also handle catalogs that only reference techs from the missile side
  for (const mt of st.cat.missiles.values()) {
    if (mt.blueprintTech === techId) {
      const inv = (cs.missiles[mt.id] ??= { maturity: 'prototype', ready: 0, expended: 0, produced: 0, launched: 0 });
      if (!mt.qualifyTech && inv.maturity === 'prototype') inv.maturity = 'qualified';
    }
    if (mt.qualifyTech === techId && cs.techs[mt.blueprintTech]) {
      const inv = (cs.missiles[mt.id] ??= { maturity: 'prototype', ready: 0, expended: 0, produced: 0, launched: 0 });
      if (inv.maturity === 'prototype') inv.maturity = 'qualified';
    }
  }
  for (const mo of e.modifiers ?? []) applyModifier(cs.modifiers, mo.key, mo.value);
  if (e.modifiers?.length) bumpEconomyCountry(state, c);
  if (e.liftCapacity) cs.lift += e.liftCapacity;
  if (e.maintenanceSlots) cs.maintenanceSlots += e.maintenanceSlots;
  void silentUpgrade;
  return true;
}

export function completeResearch(state: GameState, c: CountryId, techId: TechId): void {
  const cs = state.countries[c];
  const r = cs.research.find((x) => x.tech === techId);
  if (!r || r.endsAt > state.clock.tick) return; // cancelled or not due — never completes twice
  cs.research = cs.research.filter((x) => x.tech !== techId);
  grantTech(state, c, techId, 'domestic');
  const t = S(state).cat.techs.get(techId);
  const ev = emit(state, { kind: 'research_concluded', category: 'research', routine: true, private: toAll([c], `Research concluded: ${t?.name ?? techId}.`, { tech: techId }) });
  awardXp(state, c, ev.id, 'research');
}

export { unschedule };
