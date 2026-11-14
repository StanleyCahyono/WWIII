/**
 * Economy: production rates, upkeep, hourly accrual (exact daily totals via cumulative slicing),
 * forecasts and shortage breakdowns.
 *
 * Output rule (per day):
 *   city    = (base × (1 + Σ building productionMult × condition) + Σ building flat produces
 *              + population-derived manpower/money) × moraleFactor × cityConditionFactor
 *   rural   = (deposit output + improvement produces + population manpower) × moraleFactor
 *   then × TERRITORY_FACTOR[status] applied EXACTLY ONCE (homeland 1, annexed .5, occupied .25).
 * Rebel-held / outside provinces produce nothing.
 */
import { RESOURCES, type CountryId, type Resource } from '../data-types';
import type { BuildingInstance, CityState, CountryState, GameState, ProvinceState, TerritoryStatus } from '../state';
import { addInto, mul, type ResM, toMilli, vecFromWhole, zero, valueAt } from '../fixed';
import { ESSENTIAL, MANPOWER_PER_KPOP, MONEY_PER_KPOP, MORALE, OCCUPATION_UPKEEP_PER_TIER, RURAL_DEPOSIT_OUTPUT, TERRITORY_FACTOR } from '../rules';
import { S } from '../scenario/registry';
import { chargePartial, credit } from './ledger';
import { hourOfDay } from '../time';
import { utype } from './world';
import type { BuildingLevel } from '../data-types';

export function buildingLevelDef(state: GameState, b: BuildingInstance): BuildingLevel | null {
  const t = S(state).cat.buildings.get(b.type);
  if (!t) return null;
  let best: BuildingLevel | null = null;
  for (const l of t.levels) if (l.level <= b.level && (!best || l.level > best.level)) best = l;
  return best;
}

export type EffectKey = keyof BuildingLevel['effects'];
/** Sum of a numeric building effect over instances, weighted by condition (0..1) when `byCondition`. */
export function sumEffect(state: GameState, list: BuildingInstance[], key: EffectKey, byCondition = true): number {
  let s = 0;
  for (const b of list) {
    const d = buildingLevelDef(state, b);
    const v = d?.effects[key];
    if (typeof v === 'number') s += byCondition ? (v * b.condition) / 100 : v;
  }
  return s;
}

export function moraleFactor(morale: number): number {
  return MORALE.moraleFloorFactor + ((1 - MORALE.moraleFloorFactor) * Math.max(0, Math.min(100, morale))) / 100;
}

export function territoryFactor(status: TerritoryStatus): number {
  return TERRITORY_FACTOR[status];
}
/** Applies the territory factor (exactly once, at the end of the output pipeline). */
export function applyTerritoryFactor(v: ResM, status: TerritoryStatus): ResM {
  return mul(v, territoryFactor(status));
}

/** City output per day BEFORE the territory factor (milli). */
export function cityAdjustedOutput(state: GameState, city: CityState): ResM {
  const base = city.baseOutput;
  const mult = 1 + sumEffect(state, city.buildings, 'productionMult');
  const out = mul(base, mult);
  for (const b of city.buildings) {
    const d = buildingLevelDef(state, b);
    if (d?.effects.produces) addInto(out, mul(vecFromWhole(d.effects.produces), b.condition / 100));
    if (d?.effects.manpowerPerDay) out.manpower += Math.trunc(toMilli(d.effects.manpowerPerDay) * (b.condition / 100));
  }
  out.manpower += toMilli(city.population * MANPOWER_PER_KPOP);
  out.money += toMilli(city.population * MONEY_PER_KPOP);
  const f = moraleFactor(city.morale) * (0.25 + 0.75 * (city.condition / 100));
  return mul(out, f);
}

export function cityOutput(state: GameState, city: CityState): ResM {
  const p = state.provinces[city.node];
  if (!p || p.control !== 'country' || !p.owner) return zero();
  return applyTerritoryFactor(cityAdjustedOutput(state, city), p.status);
}

export function provinceAdjustedOutput(state: GameState, p: ProvinceState): ResM {
  const node = S(state).map.data.nodes[p.node];
  const out = zero();
  if (node.deposit) {
    out[node.deposit] += toMilli(RURAL_DEPOSIT_OUTPUT);
    for (const b of p.buildings) {
      const t = S(state).cat.buildings.get(b.type);
      const d = buildingLevelDef(state, b);
      if (!t || !d) continue;
      if (d.effects.produces) addInto(out, mul(vecFromWhole(d.effects.produces), b.condition / 100));
      if (d.effects.productionMult && t.needsDeposit) out[node.deposit] += Math.trunc(toMilli(RURAL_DEPOSIT_OUTPUT) * d.effects.productionMult * (b.condition / 100));
    }
  } else {
    for (const b of p.buildings) {
      const t = S(state).cat.buildings.get(b.type);
      const d = buildingLevelDef(state, b);
      if (!t || !d || t.needsDeposit) continue; // deposit improvements produce nothing without a deposit
      if (d.effects.produces) addInto(out, mul(vecFromWhole(d.effects.produces), b.condition / 100));
    }
  }
  out.manpower += toMilli(p.population * MANPOWER_PER_KPOP);
  return mul(out, moraleFactor(p.morale));
}
export function provinceOutput(state: GameState, p: ProvinceState): ResM {
  if (p.control !== 'country' || !p.owner) return zero();
  return applyTerritoryFactor(provinceAdjustedOutput(state, p), p.status);
}

export interface CountryRates {
  production: ResM;
  upkeepUnits: ResM;
  upkeepBuildings: ResM;
  occupation: ResM;
  consumption: ResM;
  net: ResM;
}

/** Per-day rates for all countries in one pass. */
export function allRates(state: GameState): Record<CountryId, CountryRates> {
  const out: Record<CountryId, CountryRates> = {};
  for (const c of state.countryOrder) out[c] = { production: zero(), upkeepUnits: zero(), upkeepBuildings: zero(), occupation: zero(), consumption: zero(), net: zero() };
  const occ = vecFromWhole(OCCUPATION_UPKEEP_PER_TIER);
  const bUp = (list: BuildingInstance[], acc: ResM) => {
    for (const b of list) {
      const d = buildingLevelDef(state, b);
      if (d?.upkeepPerDay) addInto(acc, vecFromWhole(d.upkeepPerDay));
    }
  };
  for (const p of state.provinces) {
    if (!p || !p.owner || p.control !== 'country') continue;
    const r = out[p.owner];
    if (!r) continue;
    addInto(r.production, provinceOutput(state, p));
    bUp(p.buildings, r.upkeepBuildings);
  }
  for (const k of Object.keys(state.cities)) {
    const city = state.cities[k];
    const p = state.provinces[city.node];
    if (!p || !p.owner || p.control !== 'country') continue;
    const r = out[p.owner];
    if (!r) continue;
    addInto(r.production, cityOutput(state, city));
    bUp(city.buildings, r.upkeepBuildings);
    if (p.status === 'occupied') addInto(r.occupation, mul(occ, city.tier));
  }
  const upCache = new Map<string, ResM>();
  for (const id of Object.keys(state.stacks)) {
    const s = state.stacks[id];
    const r = out[s.owner];
    if (!r) continue;
    for (const u of s.units) {
      let v = upCache.get(u.type);
      if (!v) {
        v = vecFromWhole(utype(state, u.type).upkeepPerDay);
        upCache.set(u.type, v);
      }
      addInto(r.upkeepUnits, v);
    }
  }
  for (const c of state.countryOrder) {
    const r = out[c];
    addInto(r.consumption, r.upkeepUnits);
    addInto(r.consumption, r.upkeepBuildings);
    addInto(r.consumption, r.occupation);
    for (const res of RESOURCES) r.net[res] = r.production[res] - r.consumption[res];
  }
  return out;
}

function slice(rate: number, h: number): number {
  return Math.trunc((rate * (h + 1)) / 24) - Math.trunc((rate * h) / 24);
}
function sliceVec(v: ResM, h: number): ResM {
  const o = zero();
  for (const r of RESOURCES) o[r] = slice(v[r], h);
  return o;
}

/** Hourly accrual (called on whole game hours). Production first, then upkeep (partial if short). */
export function economyHour(state: GameState): void {
  const h = (hourOfDay(state.clock.tick) + 23) % 24;
  const rates = allRates(state);
  for (const c of state.countryOrder) {
    const cs = state.countries[c];
    if (!cs.alive) continue;
    const r = rates[c];
    credit(state, c, 'production', sliceVec(r.production, h));
    const unpaidU = chargePartial(state, c, 'upkeep', sliceVec(addVec(r.upkeepUnits, r.upkeepBuildings), h));
    const unpaidO = chargePartial(state, c, 'occupation', sliceVec(r.occupation, h));
    const short: Resource[] = [];
    for (const res of RESOURCES) if (unpaidU[res] > 0 || unpaidO[res] > 0) short.push(res);
    cs.shortages = short;
  }
  // city shortage flags (essential inputs) feed morale at day change
  for (const k of Object.keys(state.cities)) {
    const city = state.cities[k];
    const o = state.provinces[city.node]?.owner;
    if (!o) { city.shortage = false; continue; }
    const sh = state.countries[o]?.shortages ?? [];
    if (sh.some((x) => ESSENTIAL.includes(x))) city.shortage = true;
  }
}
function addVec(a: ResM, b: ResM): ResM {
  const o = zero();
  for (const r of RESOURCES) o[r] = a[r] + b[r];
  return o;
}

export function industrialValue(state: GameState, c: CountryId, rates?: Record<CountryId, CountryRates>): number {
  const r = (rates ?? allRates(state))[c];
  if (!r) return 0;
  return valueAt(r.net, S(state).cat.prices);
}

export interface ResourceSummary {
  resource: Resource;
  stock: number;
  reserved: number;
  onHand: number;
  spendable: number;
  committedJobs: number;
  grossPerDay: number;
  consumptionPerDay: number;
  netPerDay: number;
  forecast24h: number;
  forecast72h: number;
  hoursToDepletion: number | null;
  insufficientStock: boolean;
  negativeNet: boolean;
}

export function resourceSummary(state: GameState, c: CountryId): ResourceSummary[] {
  const cs = state.countries[c];
  const r = allRates(state)[c];
  const committed = zero();
  for (const j of cs.jobs) addInto(committed, j.cost);
  return RESOURCES.map((res) => {
    const net = r.net[res];
    const stock = cs.stock[res];
    const f24 = stock + Math.trunc(net);
    const f72 = stock + Math.trunc(net * 3);
    return {
      resource: res,
      stock,
      reserved: cs.escrow[res],
      onHand: stock + cs.escrow[res],
      spendable: stock,
      committedJobs: committed[res],
      grossPerDay: r.production[res],
      consumptionPerDay: r.consumption[res],
      netPerDay: net,
      forecast24h: Math.max(0, f24),
      forecast72h: Math.max(0, f72),
      hoursToDepletion: net < 0 ? Math.floor((stock / -net) * 24) : null,
      insufficientStock: stock <= 0 && r.consumption[res] > 0,
      negativeNet: net < 0,
    };
  });
}

export interface CityShortageRow {
  city: string;
  name: string;
  produces: number;
  localUpkeep: number;
  net: number;
  jobsUsing: string[];
}
/** City-by-city breakdown for one resource: output vs upkeep of buildings and forces stationed there. */
export function shortageBreakdown(state: GameState, c: CountryId, res: Resource): CityShortageRow[] {
  const rows: CityShortageRow[] = [];
  const cs = state.countries[c];
  for (const k of Object.keys(state.cities).sort()) {
    const city = state.cities[k];
    if (state.provinces[city.node]?.owner !== c) continue;
    const produces = cityOutput(state, city)[res];
    let up = 0;
    for (const b of city.buildings) {
      const d = buildingLevelDef(state, b);
      if (d?.upkeepPerDay?.[res]) up += toMilli(d.upkeepPerDay[res] as number);
    }
    for (const id of Object.keys(state.stacks)) {
      const s = state.stacks[id];
      if (s.owner !== c || s.pos.kind !== 'node' || s.pos.node !== city.node) continue;
      for (const u of s.units) up += toMilli(utype(state, u.type).upkeepPerDay[res] ?? 0);
    }
    rows.push({ city: k, name: city.name, produces, localUpkeep: up, net: produces - up, jobsUsing: cs.jobs.filter((j) => j.city === k && j.cost[res] > 0).map((j) => j.id) });
  }
  return rows.sort((a, b) => a.net - b.net || (a.city < b.city ? -1 : 1));
}

export function onHand(cs: CountryState): ResM {
  const o = zero();
  for (const r of RESOURCES) o[r] = cs.stock[r] + cs.escrow[r];
  return o;
}
