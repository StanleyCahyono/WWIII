/**
 * Economy: production rates, upkeep, hourly accrual (exact daily totals via cumulative slicing),
 * forecasts and shortage breakdowns.
 *
 * Output rule (per day):
 *   city    = (base × (1 + Σ (productionMult − 1) × condition) × industrial_output_mult + flat produces
 *              + population-derived manpower/money) × moraleFactor × cityConditionFactor
 *   rural   = (deposit output + improvement produces + population manpower) × moraleFactor
 *   then × TERRITORY_FACTOR[status] applied EXACTLY ONCE (homeland 1, annexed .5, occupied .25).
 * Rebel-held / outside provinces produce nothing.
 */
import { RESOURCES, type CountryId, type Resource } from '../data-types';
import type { BuildingInstance, CityState, CountryState, GameState, ProvinceState, TerritoryStatus } from '../state';
import { add, addInto, mul, type ResM, subInto, toMilli, vecFromWhole, zero, valueAt } from '../fixed';
import { BLOCKADE, ESSENTIAL, MANPOWER_PER_SQRT_KPOP, MONEY_PER_SQRT_KPOP, RURAL_POP_FACTOR, MORALE, OCCUPATION_UPKEEP_PER_TIER, RURAL_DEPOSIT_OUTPUT, TERRITORY_FACTOR } from '../rules';
import { S } from '../scenario/registry';
import { chargePartial, credit } from './ledger';
import { hourOfDay } from '../time';
import { stacksOfOwner, stacksReadonly, utype } from './world';
import type { BuildingLevel } from '../data-types';
import { derived, peekDerived } from '../derived';
import { cmod } from './modifiers';

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

/**
 * Multiplier-type building effects (`*Mult`, catalog semantics: 1 = no change):
 * combined as 1 + Σ (value − 1) × condition/100.
 */
export function multEffect(state: GameState, list: BuildingInstance[], key: EffectKey): number {
  let s = 1;
  for (const b of list) {
    const d = buildingLevelDef(state, b);
    const v = d?.effects[key];
    if (typeof v === 'number') s += (v - 1) * (b.condition / 100);
  }
  return s;
}

/** Sublinear population yields (manpower/money per day) — see rules.POPULATION_YIELD. */
export function popManpower(popK: number): number {
  return Math.round(MANPOWER_PER_SQRT_KPOP * Math.sqrt(Math.max(0, popK)) * 1000) / 1000;
}
export function popMoney(popK: number): number {
  return Math.round(MONEY_PER_SQRT_KPOP * Math.sqrt(Math.max(0, popK)) * 1000) / 1000;
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
  const owner = state.provinces[city.node]?.owner ?? null;
  const mult = multEffect(state, city.buildings, 'productionMult') * cmod(state, owner, 'industrial_output_mult');
  const out = mul(base, mult);
  for (const b of city.buildings) {
    const d = buildingLevelDef(state, b);
    if (d?.effects.produces) addInto(out, mul(vecFromWhole(d.effects.produces), b.condition / 100));
    if (d?.effects.manpowerPerDay) out.manpower += Math.trunc(toMilli(d.effects.manpowerPerDay) * (b.condition / 100));
  }
  out.manpower += toMilli(popManpower(city.population));
  out.money += toMilli(popMoney(city.population));
  out.electronics = Math.trunc(out.electronics * cmod(state, owner, 'electronics_output_mult'));
  let f = moraleFactor(city.morale) * (0.25 + 0.75 * (city.condition / 100));
  // blockaded port (systems/blockade.ts): port trade and coastal shipping lost
  if (state.blockades?.[city.key]) f *= BLOCKADE.outputFactor;
  return mul(out, f);
}

const cityCache = new WeakMap<CityState, { o: string; st: string; ch: number; mo: number; co: number; po: number; im: number; em: number; bs: number; bk: boolean; out: ResM }>();
export function cityOutput(state: GameState, city: CityState): ResM {
  const p = state.provinces[city.node];
  if (!p || p.control !== 'country' || !p.owner) return zero();
  const im = cmod(state, p.owner, 'industrial_output_mult');
  const em = cmod(state, p.owner, 'electronics_output_mult');
  let bs = city.buildings.length;
  for (const b of city.buildings) bs = (bs * 31 + b.level * 131 + b.condition * 7 + b.type.length) | 0;
  const bk = !!state.blockades?.[city.key];
  const c = cityCache.get(city);
  if (c && c.o === p.owner && c.st === p.status && c.ch === p.changedAt && c.mo === city.morale && c.co === city.condition && c.po === city.population && c.im === im && c.em === em && c.bs === bs && c.bk === bk) return c.out;
  const out = applyTerritoryFactor(cityAdjustedOutput(state, city), p.status);
  cityCache.set(city, { o: p.owner, st: p.status, ch: p.changedAt, mo: city.morale, co: city.condition, po: city.population, im, em, bs, bk, out });
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
      if (d.effects.productionMult && t.needsDeposit) out[node.deposit] += Math.trunc(toMilli(RURAL_DEPOSIT_OUTPUT) * (d.effects.productionMult - 1) * (b.condition / 100));
    }
  } else {
    for (const b of p.buildings) {
      const t = S(state).cat.buildings.get(b.type);
      const d = buildingLevelDef(state, b);
      if (!t || !d || t.needsDeposit) continue; // deposit improvements produce nothing without a deposit
      if (d.effects.produces) addInto(out, mul(vecFromWhole(d.effects.produces), b.condition / 100));
    }
  }
  if (node.deposit) out[node.deposit] = Math.trunc(out[node.deposit] * cmod(state, p.owner, 'rural_output_mult'));
  out.electronics = Math.trunc(out.electronics * cmod(state, p.owner, 'electronics_output_mult'));
  out.manpower += toMilli(popManpower(p.population) * RURAL_POP_FACTOR);
  return mul(out, moraleFactor(p.morale));
}
const provCache = new WeakMap<ProvinceState, { sig: number; owner: string | null; bl: number; out: ResM }>();
const STATUS_CODE: Record<string, number> = { homeland: 1, annexed: 2, occupied: 3 };
export function provinceOutput(state: GameState, p: ProvinceState): ResM {
  if (p.control !== 'country' || !p.owner) return zero();
  let bsig = 0;
  for (const b of p.buildings) bsig += b.level * 1000 + b.condition + b.type.length * 7;
  const sig = p.changedAt * 1e7 + p.morale * 1e4 + STATUS_CODE[p.status] * 1e3 + p.population + cmod(state, p.owner, 'rural_output_mult') * 1e-3 + cmod(state, p.owner, 'electronics_output_mult') * 1e-6;
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
interface NodeContrib {
  owner: CountryId;
  prod: ResM;
  bup: ResM;
  occ: ResM;
}
interface StaticCache {
  ev: number;
  fp: number;
  provs: object;
  cities: object;
  m: Record<CountryId, StaticRates>;
  contrib: Map<number, NodeContrib>;
}
const staticRatesCache = new WeakMap<GameState, StaticCache>();
/** Nodes whose territory output changed since the last aggregation ('all' = full recompute). */
const econDirty = new WeakMap<GameState, Set<number> | 'all'>();
/** Cheap structural fingerprint of everything that feeds territory output (guards missed bumps). */
const cityListCache = new WeakMap<object, { n: number; list: CityState[] }>();
/** Cities as an array (cached per `state.cities` object; the key set is fixed after creation). */
function cityList(state: GameState): CityState[] {
  let e = cityListCache.get(state.cities);
  if (!e) {
    const list = Object.keys(state.cities).map((k) => state.cities[k]);
    e = { n: list.length, list };
    cityListCache.set(state.cities, e);
  }
  return e.list;
}
function econFingerprint(state: GameState): number {
  let h = 0;
  for (const c of cityList(state)) {
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
 * Announce a change to anything feeding territory output or building upkeep (ownership, status,
 * buildings, condition, morale, population, national output modifiers). Pass the node to update
 * only that location's contribution; omit it for a full recompute (day change, modifiers).
 */
/** Journal of economy bumps (node, or -1 = everything) for consumers that refresh per location. */
const econJournal = new WeakMap<GameState, { v: number; node: number }[]>();
function journalEcon(state: GameState, node: number): void {
  let j = econJournal.get(state);
  if (!j) {
    j = [];
    econJournal.set(state, j);
  }
  j.push({ v: state.ids.econv ?? 0, node });
  if (j.length > 20000) j.splice(0, j.length - 10000);
}
/**
 * Nodes announced by bumpEconomy after economy version `since`: a set of nodes, 'all' (a global
 * bump), or null when the (non-serialized) journal cannot tell.
 */
export function econChangesSince(state: GameState, since: number): Set<number> | 'all' | null {
  const now = state.ids.econv ?? 0;
  if (now === since) return new Set();
  const j = econJournal.get(state);
  if (!j || !j.length || j[0].v > since + 1 || j[j.length - 1].v !== now) return null;
  const out = new Set<number>();
  for (let i = j.length - 1; i >= 0 && j[i].v > since; i--) {
    if (j[i].node < 0) return 'all';
    out.add(j[i].node);
  }
  return out;
}
export function bumpEconomy(state: GameState, node?: number): void {
  state.ids.econv = (state.ids.econv ?? 0) + 1;
  journalEcon(state, node ?? -1);
  const d = econDirty.get(state);
  if (node === undefined || d === 'all') econDirty.set(state, 'all');
  else if (d) d.add(node);
  else econDirty.set(state, new Set([node]));
}
/**
 * A change confined to one country's national output modifiers (research completion): only the
 * locations it owns are re-derived (same result as a full recompute; the modifiers only enter the
 * owner's city/province output).
 */
export function bumpEconomyCountry(state: GameState, c: CountryId): void {
  state.ids.econv = (state.ids.econv ?? 0) + 1;
  for (const p of state.provinces) if (p && p.owner === c) journalEcon(state, p.node);
  let d = econDirty.get(state);
  if (d === 'all') return;
  if (!d) {
    d = new Set();
    econDirty.set(state, d);
  }
  for (const p of state.provinces) if (p && p.owner === c) d.add(p.node);
}
const upkeepVecCache = new WeakMap<object, ResM>();
/** Building-level upkeep as a milli vector (memoized per catalog level object; never mutate). */
function levelUpkeep(d: BuildingLevel): ResM | null {
  if (!d.upkeepPerDay) return null;
  let v = upkeepVecCache.get(d);
  if (!v) {
    v = vecFromWhole(d.upkeepPerDay);
    upkeepVecCache.set(d, v);
  }
  return v;
}
function nodeContrib(state: GameState, node: number, occ: ResM): NodeContrib | null {
  const p = state.provinces[node];
  if (!p || !p.owner || p.control !== 'country') return null;
  const c: NodeContrib = { owner: p.owner, prod: zero(), bup: zero(), occ: zero() };
  addInto(c.prod, provinceOutput(state, p));
  for (const b of p.buildings) {
    const d = buildingLevelDef(state, b);
    const u = d && levelUpkeep(d);
    if (u) addInto(c.bup, u);
  }
  const ck = S(state).map.cityByNode.get(node);
  const city = ck ? state.cities[ck] : undefined;
  if (city) {
    addInto(c.prod, cityOutput(state, city));
    for (const b of city.buildings) {
      const d = buildingLevelDef(state, b);
      const u = d && levelUpkeep(d);
      if (u) addInto(c.bup, u);
    }
    if (p.status === 'occupied') addInto(c.occ, mul(occ, city.tier));
  }
  return c;
}
function staticRates(state: GameState): Record<CountryId, StaticRates> {
  const ev = state.ids.econv ?? 0;
  const fp = econFingerprint(state);
  const c = staticRatesCache.get(state);
  if (c && c.ev === ev && c.fp === fp && c.provs === state.provinces && c.cities === state.cities) return c.m;
  const occ = vecFromWhole(OCCUPATION_UPKEEP_PER_TIER);
  const dirty = econDirty.get(state);
  econDirty.delete(state);
  // incremental when few locations changed (a large batch, e.g. day change, is cheaper as a full pass)
  if (c && c.provs === state.provinces && c.cities === state.cities && dirty && dirty !== 'all' && c.ev !== ev && dirty.size * 2 < c.contrib.size) {
    // incremental: re-derive only the announced locations
    for (const node of [...dirty].sort((a, b) => a - b)) {
      const old = c.contrib.get(node);
      if (old && c.m[old.owner]) {
        subInto(c.m[old.owner].production, old.prod);
        subInto(c.m[old.owner].upkeepBuildings, old.bup);
        subInto(c.m[old.owner].occupation, old.occ);
      }
      const nw = nodeContrib(state, node, occ);
      if (nw && c.m[nw.owner]) {
        addInto(c.m[nw.owner].production, nw.prod);
        addInto(c.m[nw.owner].upkeepBuildings, nw.bup);
        addInto(c.m[nw.owner].occupation, nw.occ);
        c.contrib.set(node, nw);
      } else c.contrib.delete(node);
    }
    c.ev = ev;
    c.fp = fp; // re-deriving contributions does not mutate state
    return c.m;
  }
  const m: Record<CountryId, StaticRates> = {};
  for (const cc of state.countryOrder) m[cc] = { production: zero(), upkeepBuildings: zero(), occupation: zero() };
  const contrib = new Map<number, NodeContrib>();
  for (const p of state.provinces) {
    if (!p) continue;
    const nc = nodeContrib(state, p.node, occ);
    if (!nc || !m[nc.owner]) continue;
    contrib.set(p.node, nc);
    addInto(m[nc.owner].production, nc.prod);
    addInto(m[nc.owner].upkeepBuildings, nc.bup);
    addInto(m[nc.owner].occupation, nc.occ);
  }
  staticRatesCache.set(state, { ev, fp, provs: state.provinces, cities: state.cities, m, contrib });
  return m;
}

/**
 * Per-day rates of ONE country, memoized per step: identical to `allRates(state)[c]` (same static
 * territory part, the same per-stack upkeep vectors summed over its stacks — integer sums, so the
 * order is irrelevant) without summing every stack of the world. Used by the views.
 */
export function countryRates(state: GameState, c: CountryId): CountryRates {
  return derived(state, `~rate:${c}`, () => {
    const all = peekDerived<Record<CountryId, CountryRates>>(state, '~rates');
    if (all) return all[c];
    const x = derived(state, '~staticRates', () => staticRates(state))[c];
    const r: CountryRates = x
      ? { production: { ...x.production }, upkeepUnits: zero(), upkeepBuildings: { ...x.upkeepBuildings }, occupation: { ...x.occupation }, consumption: zero(), net: zero() }
      : { production: zero(), upkeepUnits: zero(), upkeepBuildings: zero(), occupation: zero(), consumption: zero(), net: zero() };
    for (const s of stacksOfOwner(state, c)) if (state.stacks[s.id] === s) addInto(r.upkeepUnits, stackUpkeep(state, s));
    const fm = cmod(state, c, 'fuel_upkeep_mult');
    if (fm !== 1) r.upkeepUnits.fuel = Math.trunc(r.upkeepUnits.fuel * fm);
    addInto(r.consumption, r.upkeepUnits);
    addInto(r.consumption, r.upkeepBuildings);
    addInto(r.consumption, r.occupation);
    for (const res of RESOURCES) r.net[res] = r.production[res] - r.consumption[res];
    return r;
  });
}

/** Per-day rates for all countries (territory part cached by the economy version; units summed). */
export function computeRates(state: GameState): Record<CountryId, CountryRates> {
  const st = staticRates(state);
  const out: Record<CountryId, CountryRates> = {};
  for (const c of state.countryOrder) {
    const x = st[c];
    out[c] = { production: { ...x.production }, upkeepUnits: zero(), upkeepBuildings: { ...x.upkeepBuildings }, occupation: { ...x.occupation }, consumption: zero(), net: zero() };
  }
  // unit upkeep: per-stack vector cached until the roster changes (summation order is irrelevant: integers)
  for (const s of stacksReadonly(state)) {
    const r = out[s.owner];
    if (r) addInto(r.upkeepUnits, stackUpkeep(state, s));
  }
  for (const c of state.countryOrder) {
    const r = out[c];
    const fm = cmod(state, c, 'fuel_upkeep_mult');
    if (fm !== 1) r.upkeepUnits.fuel = Math.trunc(r.upkeepUnits.fuel * fm);
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
  return { supplies: slice(v.supplies, h), components: slice(v.components, h), electronics: slice(v.electronics, h), fuel: slice(v.fuel, h), rare: slice(v.rare, h), manpower: slice(v.manpower, h), money: slice(v.money, h) };
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
  let essShort: Set<CountryId> | null = null;
  for (const c of state.countryOrder) if (state.countries[c].shortages.some((x) => ESSENTIAL.includes(x))) (essShort ??= new Set()).add(c);
  if (essShort) for (const city of cityList(state)) {
    const o = state.provinces[city.node]?.owner;
    if (!o) { city.shortage = false; continue; }
    if (essShort.has(o)) city.shortage = true;
  }
}
function addVec(a: ResM, b: ResM): ResM {
  return add(a, b);
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
  const r = countryRates(state, c);
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
