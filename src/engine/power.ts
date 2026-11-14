/**
 * Opening power index ("The U.S. starts first overall").
 * Computed from ACTUAL start assets at creation (before treaties/random events) and persisted.
 *   industrial  25 % — one day's net production (production − ordinary upkeep) valued at the
 *                      published reference prices (negative clamps to 0)
 *   formations  25 % — Σ unit replacement value (catalog price × reference prices) × readiness
 *   research    20 % — Σ reference value of completed techs + funded throughput
 *                      (slots × speed × horizon × researchSlotValuePerDay)
 *   mobility    20 % — lift × liftValue + maintenance capacity × maintenanceSlotValue +
 *                      manpower replenishment per day × horizon × value (own assets only)
 *   resilience  10 % — mean coverage of essential inputs over resilienceDays, capped at 1
 * Each raw dimension is divided by the highest NON-reference (non-U.S.) value, weighted, summed,
 * and all composites are rescaled so the highest non-reference composite = 100. A zero
 * normalization denominator is a configuration error. No hidden multipliers.
 */
import type { CountryId } from './data-types';
import type { GameState, OpeningPowerDims, OpeningPowerResult } from './state';
import { ESSENTIAL, OPENING_POWER, RESEARCH_BASE_SLOTS } from './rules';
import { S } from './scenario/registry';
import { allRates } from './systems/economy';
import { researchSlots, researchSpeed } from './systems/research';
import { maintenanceCapacity } from './systems/readiness';
import { unitCost } from './systems/production';
import { utype } from './systems/world';
import { valueAt, vecFromWhole } from './fixed';

export class OpeningPowerConfigError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'OpeningPowerConfigError';
  }
}

export const REFERENCE_COUNTRY = 'USA';

export function rawDimensions(state: GameState): Record<CountryId, OpeningPowerDims> {
  const st = S(state);
  const prices = st.cat.prices;
  const rates = allRates(state);
  const out: Record<CountryId, OpeningPowerDims> = {};
  for (const c of state.countryOrder) {
    const cs = state.countries[c];
    const r = rates[c];
    const industrial = Math.max(0, valueAt(r.net, prices));
    let formations = 0;
    for (const s of Object.values(state.stacks)) {
      if (s.owner !== c) continue;
      for (const u of s.units) formations += valueAt(unitCost(state, c, utype(state, u.type)), prices) * (u.readiness / 100) * (u.hp / u.maxHp);
    }
    let techValue = 0;
    for (const t of Object.keys(cs.techs)) {
      const tn = st.cat.techs.get(t);
      if (tn) techValue += valueAt(vecFromWhole(tn.cost), prices);
    }
    const research = techValue + researchSlots(state, c) * researchSpeed(state, c) * OPENING_POWER.researchHorizonDays * OPENING_POWER.researchSlotValuePerDay;
    const mobility = cs.lift * OPENING_POWER.liftValue + maintenanceCapacity(state, c) * OPENING_POWER.maintenanceSlotValue + (Math.max(0, r.production.manpower) / 1000) * OPENING_POWER.mobilityHorizonDays * OPENING_POWER.replenishmentValuePerManpower;
    let cov = 0;
    for (const res of ESSENTIAL) {
      const need = r.consumption[res] * OPENING_POWER.resilienceDays;
      const have = cs.stock[res] + Math.max(0, r.production[res]) * OPENING_POWER.resilienceDays;
      cov += need <= 0 ? 1 : Math.min(OPENING_POWER.resilienceCap, have / need);
    }
    const resilience = Math.min(OPENING_POWER.resilienceCap, cov / ESSENTIAL.length);
    out[c] = { industrial: r2(industrial), formations: r2(formations), research: r2(research), mobility: r2(mobility), resilience: r2(resilience) };
  }
  return out;
}
function r2(x: number): number {
  return Math.round(x * 100) / 100;
}

export function computeOpeningPower(state: GameState, reference: CountryId = REFERENCE_COUNTRY): OpeningPowerResult {
  const raw = rawDimensions(state);
  const dims = Object.keys(OPENING_POWER.weights) as (keyof OpeningPowerDims)[];
  const others = state.countryOrder.filter((c) => c !== reference);
  const pool = others.length ? others : state.countryOrder;
  const norm = {} as OpeningPowerDims;
  for (const d of dims) {
    const mx = Math.max(...pool.map((c) => raw[c][d]));
    if (!(mx > 0)) throw new OpeningPowerConfigError(`Opening power: dimension "${d}" has a zero normalization denominator (no non-reference country has any ${d}).`);
    norm[d] = mx;
  }
  const comp: Record<CountryId, number> = {};
  for (const c of state.countryOrder) {
    let s = 0;
    for (const d of dims) s += OPENING_POWER.weights[d] * (raw[c][d] / norm[d]);
    comp[c] = s;
  }
  const maxOther = Math.max(...pool.map((c) => comp[c]));
  if (!(maxOther > 0)) throw new OpeningPowerConfigError('Opening power: highest non-reference composite is zero.');
  const rescale = 100 / maxOther;
  const composite: Record<CountryId, number> = {};
  for (const c of state.countryOrder) composite[c] = Math.round(comp[c] * rescale * 100) / 100;
  const rank = [...state.countryOrder].sort((a, b) => composite[b] - composite[a] || (a < b ? -1 : 1));
  const leader = rank[0];
  const rivals = rank.filter((c) => c !== reference);
  return {
    computedAt: 'creation',
    weights: { ...OPENING_POWER.weights },
    constants: {
      researchHorizonDays: OPENING_POWER.researchHorizonDays,
      researchSlotValuePerDay: OPENING_POWER.researchSlotValuePerDay,
      mobilityHorizonDays: OPENING_POWER.mobilityHorizonDays,
      liftValue: OPENING_POWER.liftValue,
      maintenanceSlotValue: OPENING_POWER.maintenanceSlotValue,
      replenishmentValuePerManpower: OPENING_POWER.replenishmentValuePerManpower,
      resilienceDays: OPENING_POWER.resilienceDays,
      resilienceCap: OPENING_POWER.resilienceCap,
      researchBaseSlots: RESEARCH_BASE_SLOTS,
    },
    normalization: norm,
    raw,
    composite,
    rank,
    rescale,
    leader,
    nearestRival: state.countryOrder.includes(reference) ? rivals[0] ?? null : rank[1] ?? null,
    referenceCountry: reference,
  };
}
