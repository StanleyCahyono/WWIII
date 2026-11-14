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
import { derived } from '../derived';

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

const cityCache = new WeakMap<CityState, { k: string; out: ResM }>();
export function cityOutput(state: GameState, city: CityState): ResM {
  const p = state.provinces[city.node];
  if (!p || p.control !== 'country' || !p.owner) return zero();
  let k = `${p.owner}|${p.status}|${p.changedAt}|${city.morale}|${city.condition}|${city.population}`;
  for (const b of city.buildings) k += `|${b.type}:${b.level}:${b.condition}`;
  const c = cityCache.get(city);
  if (c && c.k === k) return c.out;
  const out = applyTerritoryFactor(cityAdjustedOutput(state, city), p.status);
  cityCache.set(city, { k, out });
  return out;
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
const provCache = new WeakMap<ProvinceState, { sig: number; owner: string | null; bl: number; out: ResM }>();
const STATUS_CODE: Record<string, number> = { homeland: 1, annexed: 2, occupied: 3 };
export function provinceOutput(state: GameState, p: ProvinceState): ResM {
  if (p.control !== 'country' || !p.owner) return zero();
  let bsig = 0;
  for (const b of p.buildings) bsig += b.level * 1000 + b.condition + b.type.length * 7;
  const sig = p.changedAt * 1e7 + p.morale * 1e4 + STATUS_CODE[p.status] * 1e3 + p.population;
  const c = provCache.get(p);
  if (c && c.sig === sig && c.owner === p.owner && c.bl === bsig) return c.out;
  const out = applyTerritoryFactor(provinceAdjustedOutput(state, p), p.status);
  provCache.set(p, { sig, owner: p.owner, bl: bsig, out });
  return out;
}

export interface CountryRates {
  production: ResM;
  upkeepUnits: ResM;
  upkeepBuildings: ResM;
  occupation: ResM;
  consumption: ResM;
  net: ResM;
}

/** Per-day rates for all countries (memoized until the next step/command). */
export function allRates(state: GameState): Record<CountryId, CountryRates> {
  return derived(state, '~rates', () => computeRates(state));
}

/** Per-day rates for all countries in one pass (uncached). */
/** Territory-derived part of the rates (production, building upkeep, occupation upkeep). */
interface StaticRates {
  production: ResM;
  upkeepBuildings: ResM;
  occupation: ResM;
}
const staticRatesCache = new WeakMap<GameState, { ev: number; fp: number; provs: object; cities: object; m: Record<CountryId, StaticRates> }>();
/** Cheap structural fingerprint of everything that feeds territory output (guards missed bumps). */
function econFingerprint(state: GameState): number {
  let h = 0;
  for (const k in state.cities) {
    const c = state.cities[k];
    h = (h * 31 + c.morale * 7 + c.condition * 13 + Math.round(c.population) + c.buildings.length * 101) | 0;
    for (const b of c.buildings) h = (h * 17 + b.level * 3 + b.condition + b.type.length) | 0;
  }
  for (const p of state.provinces) {
    if (!p) continue;
    h = (h * 31 + p.changedAt + p.morale + p.buildings.length * 101 + (p.status === 'homeland' ? 1 : p.status === 'annexed' ? 2 : 3)) | 0;
    for (const b of p.buildings) h = (h * 17 + b.level * 3 + b.condition) | 0;
  }
  return h;
}
/**
 * Bump whenever anything feeding city/province output or building upkeep changes (ownership,
 * status, buildings, condition, morale, population). Day changes bump it too.
 */
export function bumpEconomy(state: GameState): void {
  state.ids.econv = (state.ids.econv ?? 0) + 1;
}
function staticRates(state: GameState): Record<CountryId, StaticRates> {
  const ev = state.ids.econv ?? 0;
  const fp = econFingerprint(state);
  const c = staticRatesCache.get(state);
  if (c && c.ev === ev && c.fp === fp && c.provs === state.provinces && c.cities === state.cities) return c.m;
  const m: Record<CountryId, StaticRates> = {};
  for (const cc of state.countryOrder) m[cc] = { production: zero(), upkeepBuildings: zero(), occupation: zero() };
  const occ = vecFromWhole(OCCUPATION_UPKEEP_PER_TIER);
  const bUp = (list: BuildingInstance[], acc: ResM) => {
    for (const b of list) {
      const d = buildingLevelDef(state, b);
      if (d?.upkeepPerDay) addInto(acc, vecFromWhole(d.upkeepPerDay));
    }
  };
  for (const p of state.provinces) {
    if (!p || !p.owner || p.control !== 'country') continue;
    const r = m[p.owner];
    if (!r) continue;
    addInto(r.production, provinceOutput(state, p));
    if (p.buildings.length) bUp(p.buildings, r.upkeepBuildings);
  }
  for (const k of Object.keys(state.cities)) {
    const city = state.cities[k];
    const p = state.provinces[city.node];
    if (!p || !p.owner || p.control !== 'country') continue;
    const r = m[p.owner];
    if (!r) continue;
    addInto(r.production, cityOutput(state, city));
    bUp(city.buildings, r.upkeepBuildings);
    if (p.status === 'occupied') addInto(r.occupation, mul(occ, city.tier));
  }
  staticRatesCache.set(state, { ev, fp, provs: state.provinces, cities: state.cities, m });
  return m;
}

/** Per-day rates for all countries (territory part cached by the economy version; units summed). */
export function computeRates(state: GameState): Record<CountryId, CountryRates> {
  const st = staticRates(state);
  const out: Record<CountryId, CountryRates> = {};
  for (const c of state.countryOrder) {
    const x = st[c];
    out[c] = { production: { ...x.production }, upkeepUnits: zero(), upkeepBuildings: { ...x.upkeepBuildings }, occupation: { ...x.occupation }, consumption: zero(), net: zero() };
  }
  // unit upkeep: per-stack vector cached until the roster changes
  for (const id of Object.keys(state.stacks)) {
    const s = state.stacks[id];
    const r = out[s.owner];
    if (r) addInto(r.upkeepUnits, stackUpkeep(state, s));
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

const upkeepCache = new WeakMap<object, { units: object; len: number; v: ResM }>();
function stackUpkeep(state: GameState, st: { units: { type: string }[] }): ResM {
  const c = upkeepCache.get(st);
  if (c && c.units === st.units && c.len === st.units.length) return c.v;
  const v = zero();
  for (const u of st.units) addInto(v, vecFromWhole(utype(state, u.type).upkeepPerDay));
  upkeepCache.set(st, { units: st.units, len: st.units.length, v });
  return v;
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
  const rates = computeRates(state);
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
